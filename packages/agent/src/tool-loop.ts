/**
 * Bounded tool loop — ROADMAP.md §3 Plan B.
 *
 * The orchestrator's build path used to be pure one-shot generation: build a
 * prompt, get one completion, write it out. The model never got to look at
 * anything before answering. This gives it real, grounded reconnaissance
 * (read a file, search the repo, run a known-safe diagnostic) before it
 * generates — the mechanism that lets an agent beat raw prompting instead of
 * just adding constraints on top of the same blind completion.
 *
 * Scoped deliberately narrow and safe:
 *  - READ/GREP are confined to the project root (no path traversal out).
 *  - RUN is a closed menu of pre-defined, parameterless diagnostics — the
 *    model selects an action BY NAME, never supplies a shell string. This is
 *    not a general command executor; it cannot be turned into one by prompt
 *    injection, because there is no code path that takes model-authored text
 *    and hands it to a shell.
 *  - Bounded iteration count; a model that ignores the action protocol and
 *    answers directly on turn 1 works exactly as before (zero regression).
 *
 * This is intentionally NOT the full engine tool registry (Plan A in the
 * roadmap) — that registry is a genuine internal implementation detail of
 * @monkeydcode/engine (only session/runner, session/mdc-bridge, and
 * tool/verify-mdc are exported; package.json "exports" blocks deeper
 * subpaths at the runtime level), and wiring the orchestrator through the
 * full Effect session/runtime/permission stack is a real architectural
 * migration, not a same-session change. Plan B stands on its own: it already
 * gives the model the one thing one-shot generation structurally cannot —
 * the ability to look before it writes.
 */
import { Effect } from "effect"
import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { isAbsolute, relative, resolve } from "path"
import { $ } from "bun"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"

const MAX_ITERATIONS = 6
const MAX_READ_CHARS = 8_000
const MAX_GREP_MATCHES = 40
const MAX_GREP_FILES_SCANNED = 2_000
const MAX_OBSERVATION_CHARS = 4_000
const IGNORED_DIR_SEGMENTS = ["node_modules", ".git", "dist", "build", ".monkeydcode"]

export interface ToolLoopOptions {
    model: ModelRef
    projectRoot: string
    maxIterations?: number
}

export interface ToolLoopResult {
    /** Final model text — either after an explicit ANSWER or forced finalization. */
    finalText: string
    /** Rendered Action/Observation history, "" if no actions were taken (model
     *  answered directly on the first turn — the common case for trivial tasks). */
    transcript: string
    iterations: number
}

type ParsedAction =
    | { kind: "read"; path: string }
    | { kind: "grep"; pattern: string; scope?: string }
    | { kind: "run"; name: string }
    | { kind: "answer" }

// ─── Action vocabulary shown to the model ──────────────────────────────────
// A function, not a module-level const: it reads RUN_COMMANDS, which is
// declared further down the file, and must be evaluated lazily (on first
// call, after the whole module has initialized) rather than at module-eval
// time, or it would hit the `const` temporal dead zone.

function actionMenu(maxIterations: number): string {
    return `You may investigate before answering. On each turn, respond with EXACTLY ONE line — either an action or your final answer:

  READ <path>              — show the current contents of a file (relative to the project root)
  GREP <pattern> [IN <path>] — search the project for a regex pattern, optionally scoped to a subpath
  RUN <name>                — run a known diagnostic; <name> is one of: ${Object.keys(RUN_COMMANDS).join(", ")}

When you have enough information, stop investigating and produce your final answer directly
(no action keyword) in the exact output format requested by the task.

You have at most ${maxIterations} investigation turns before you must answer.`
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Run the bounded investigate-then-answer loop. `basePrompt` is the full task
 * prompt (already includes whatever context/output-format instructions the
 * caller assembled) — the action menu is layered on top, not baked into it,
 * so callers don't need to know about the loop protocol.
 */
export function run(basePrompt: string, options: ToolLoopOptions): Effect.Effect<ToolLoopResult, unknown> {
    const maxIterations = options.maxIterations ?? MAX_ITERATIONS
    return Effect.gen(function* () {
        const transcriptEntries: string[] = []

        for (let i = 0; i < maxIterations; i++) {
            const prompt = buildTurnPrompt(basePrompt, transcriptEntries, maxIterations)
            const response = yield* Effect.promise(() =>
                LLM.generateAsync({ model: options.model, messages: [{ role: "user", content: prompt }] }),
            )

            const action = parseAction(response.text)
            if (action.kind === "answer") {
                return {
                    finalText: response.text,
                    transcript: transcriptEntries.join("\n"),
                    iterations: i,
                }
            }

            const observation = yield* Effect.promise(() => execute(action, options.projectRoot))
            transcriptEntries.push(
                `### Turn ${i + 1}: ${describeAction(action)}\n${truncate(observation, MAX_OBSERVATION_CHARS)}`,
            )
        }

        // Iteration cap reached without an answer — force one, with everything
        // gathered so far. Never leave the caller with no result.
        const finalPrompt = `${buildTurnPrompt(basePrompt, transcriptEntries, maxIterations)}\n\nYou have used all investigation turns. Answer now — no more actions.`
        const finalResponse = yield* Effect.promise(() =>
            LLM.generateAsync({ model: options.model, messages: [{ role: "user", content: finalPrompt }] }),
        )
        return {
            finalText: finalResponse.text,
            transcript: transcriptEntries.join("\n"),
            iterations: maxIterations,
        }
    })
}

function buildTurnPrompt(basePrompt: string, transcriptEntries: string[], maxIterations: number): string {
    const transcript = transcriptEntries.length > 0
        ? `\n\n## Investigation so far\n${transcriptEntries.join("\n\n")}`
        : ""
    return `${actionMenu(maxIterations)}\n\n## Task\n${basePrompt}${transcript}`
}

function describeAction(action: ParsedAction): string {
    switch (action.kind) {
        case "read": return `READ ${action.path}`
        case "grep": return `GREP ${action.pattern}${action.scope ? ` IN ${action.scope}` : ""}`
        case "run": return `RUN ${action.name}`
        case "answer": return "ANSWER"
    }
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/** Weak models that ignore the protocol and answer directly fall through to
 *  "answer" naturally — this is a feature, not an error case: zero regression
 *  from the old one-shot behavior when a model doesn't engage with the loop. */
function parseAction(text: string): ParsedAction {
    const firstLine = text.trim().split("\n")[0]?.trim() ?? ""

    let m = /^READ\s+(.+)$/i.exec(firstLine)
    if (m) return { kind: "read", path: m[1]!.trim() }

    m = /^GREP\s+(.+?)(?:\s+IN\s+(.+))?$/i.exec(firstLine)
    if (m) return { kind: "grep", pattern: m[1]!.trim(), scope: m[2]?.trim() }

    m = /^RUN\s+(\S+)$/i.exec(firstLine)
    if (m) return { kind: "run", name: m[1]!.trim().toLowerCase() }

    return { kind: "answer" }
}

// ─── Execution ──────────────────────────────────────────────────────────────

function execute(action: ParsedAction, projectRoot: string): Promise<string> {
    switch (action.kind) {
        case "read": return executeRead(projectRoot, action.path)
        case "grep": return executeGrep(projectRoot, action.pattern, action.scope)
        case "run": return executeRun(projectRoot, action.name)
        case "answer": return Promise.resolve("")
    }
}

/** Resolve a model-supplied path against the project root, refusing anything
 *  that escapes it (absolute paths elsewhere, `..` traversal). Returns null
 *  when the path is unsafe. */
function resolveSafePath(root: string, requested: string): string | null {
    const rootResolved = resolve(root)
    const resolved = resolve(rootResolved, requested)
    const rel = relative(rootResolved, resolved)
    if (rel.startsWith("..") || isAbsolute(rel)) return null
    return resolved
}

async function executeRead(root: string, path: string): Promise<string> {
    const safe = resolveSafePath(root, path)
    if (!safe) return `ERROR: "${path}" is outside the project root — refusing to read.`
    if (!existsSync(safe)) return `ERROR: ${path} does not exist.`

    try {
        const stat = statSync(safe)
        if (stat.isDirectory()) {
            const entries = readdirSync(safe)
                .filter(e => !IGNORED_DIR_SEGMENTS.includes(e))
                .slice(0, 100)
            return `${path} is a directory:\n${entries.join("\n")}`
        }
        const content = readFileSync(safe, "utf-8")
        return truncate(content, MAX_READ_CHARS)
    } catch (e) {
        return `ERROR reading ${path}: ${String(e)}`
    }
}

async function executeGrep(root: string, pattern: string, scope?: string): Promise<string> {
    let regex: RegExp
    try {
        regex = new RegExp(pattern, "i")
    } catch {
        return `ERROR: invalid pattern "${pattern}"`
    }

    const searchRoot = scope ? resolveSafePath(root, scope) : resolve(root)
    if (!searchRoot) return `ERROR: "${scope}" is outside the project root.`
    if (!existsSync(searchRoot)) return `ERROR: scope path "${scope}" does not exist.`

    const glob = new Bun.Glob("**/*")
    const matches: string[] = []
    let filesScanned = 0

    for await (const rel of glob.scan({ cwd: searchRoot, dot: false })) {
        if (IGNORED_DIR_SEGMENTS.some(seg => rel.includes(`${seg}/`) || rel.includes(`${seg}\\`))) continue
        if (++filesScanned > MAX_GREP_FILES_SCANNED) break

        const full = resolve(searchRoot, rel)
        try {
            const stat = statSync(full)
            if (!stat.isFile() || stat.size > 500_000) continue
            const content = readFileSync(full, "utf-8")
            const lines = content.split("\n")
            for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i]!)) {
                    matches.push(`${relative(root, full).replace(/\\/g, "/")}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`)
                    if (matches.length >= MAX_GREP_MATCHES) break
                }
            }
        } catch {
            continue
        }
        if (matches.length >= MAX_GREP_MATCHES) break
    }

    return matches.length > 0
        ? matches.join("\n")
        : `No matches for "${pattern}"${scope ? ` in ${scope}` : ""}`
}

// ─── RUN: closed menu, no arbitrary command execution ──────────────────────
// The model selects a NAME from this fixed table; nothing it writes is ever
// interpolated into a shell command. Extending this table is the only way to
// add capability, which is the point — Open/Closed without opening an
// injection surface.

interface RunCommand {
    description: string
    exec: (root: string) => Promise<string>
}

/** Refuses to treat a monorepo root (has a "workspaces" field) as a leaf
 *  package. Running `bun test`/`bun run typecheck` with no path scoping there
 *  re-runs EVERY package's suite — including whatever is already executing
 *  the request (a real, previously-reproduced recursion hazard: see
 *  stage-selector.ts). Callers should pass the nearest package root, but this
 *  is the last line of defense if they don't. */
function isMonorepoRoot(root: string): boolean {
    try {
        const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"))
        return pkg.workspaces !== undefined
    } catch {
        return false
    }
}

const RUN_TIMEOUT_MS = 60_000

function withTimeout(promise: Promise<string>, ms: number, label: string): Promise<string> {
    return Promise.race([
        promise,
        new Promise<string>(fulfil => setTimeout(() => fulfil(`TIMED OUT after ${ms}ms running ${label}`), ms)),
    ])
}

const RUN_COMMANDS: Record<string, RunCommand> = {
    typecheck: {
        description: "run the project's typecheck script",
        exec: async root => {
            if (isMonorepoRoot(root)) {
                return "REFUSED: this would typecheck the entire monorepo, not just the relevant package. Scope the task to a specific file/package first."
            }
            return withTimeout(
                (async () => {
                    const r = await $`bun run typecheck`.cwd(root).quiet().nothrow()
                    return (r.stdout.toString() + r.stderr.toString()) || `(no output, exit ${r.exitCode})`
                })(),
                RUN_TIMEOUT_MS,
                "typecheck",
            )
        },
    },
    test: {
        description: "run the project's test script",
        exec: async root => {
            if (isMonorepoRoot(root)) {
                return "REFUSED: this would run the ENTIRE monorepo's test suite, including whatever is currently executing this request. Scope the task to a specific file/package first."
            }
            return withTimeout(
                (async () => {
                    const r = await $`bun test`.cwd(root).quiet().nothrow()
                    return (r.stdout.toString() + r.stderr.toString()) || `(no output, exit ${r.exitCode})`
                })(),
                RUN_TIMEOUT_MS,
                "test",
            )
        },
    },
    "git-diff": {
        description: "show uncommitted changes",
        exec: async root => {
            const r = await $`git diff HEAD`.cwd(root).quiet().nothrow()
            return r.stdout.toString() || "(no changes)"
        },
    },
    "git-status": {
        description: "show working tree status",
        exec: async root => {
            const r = await $`git status --short`.cwd(root).quiet().nothrow()
            return r.stdout.toString() || "(clean)"
        },
    },
}

async function executeRun(root: string, name: string): Promise<string> {
    const command = RUN_COMMANDS[name]
    if (!command) {
        return `ERROR: unknown RUN target "${name}". Available: ${Object.keys(RUN_COMMANDS).join(", ")}`
    }
    try {
        const output = await command.exec(root)
        return truncate(output, MAX_OBSERVATION_CHARS)
    } catch (e) {
        return `ERROR running ${name}: ${String(e)}`
    }
}

function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + "\n… (truncated)" : text
}
