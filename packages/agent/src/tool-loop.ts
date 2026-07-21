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
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import { validateAssets, formatReport } from "@monkeydcode/consistency/verification/assets"
import * as BrowserCheck from "@monkeydcode/consistency/verification/browser-check"
import { execSandboxed } from "@monkeydcode/core/util/sandbox"
import type { McpManager, QualifiedTool } from "@monkeydcode/mcp"
import type { Ruleset } from "@monkeydcode/core/permission"
import { checkPermission } from "./permissions.ts"
import { isConfigured as isWebSearchConfigured, search as webSearch, formatResults as formatSearchResults, type WebSearchConfig } from "./web-search.ts"

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
    /** Configured MCP servers this session may call (GAPS.md Part 2, C1) —
     *  omitted or empty when the user has configured none, in which case the
     *  MCP action is not even advertised in the menu. Still a closed menu:
     *  the SERVERS come from user config (mcp-context.ts), never from model
     *  text; the model only picks a tool NAME already present in `mcpManager.tools`. */
    mcpManager?: McpManager
    /** Empty/omitted = every RUN command and MCP tool is allowed (unconfigured
     *  behavior, unchanged from before this existed). See permissions.ts. */
    permissionRules?: Ruleset
    /** Web search (GAPS.md Part 1, gap #6) — omitted unless the user has
     *  configured a provider; SEARCH isn't even advertised in the menu otherwise. */
    webSearchConfig?: WebSearchConfig
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
    | { kind: "mcp"; qualifiedName: string; argsJson: string }
    | { kind: "search"; query: string }
    | { kind: "answer" }

// ─── Action vocabulary shown to the model ──────────────────────────────────
// A function, not a module-level const: it reads RUN_COMMANDS, which is
// declared further down the file, and must be evaluated lazily (on first
// call, after the whole module has initialized) rather than at module-eval
// time, or it would hit the `const` temporal dead zone.

function mcpMenuLines(mcpTools: QualifiedTool[]): string {
    if (mcpTools.length === 0) return ""
    const list = mcpTools
        .slice(0, 30) // keep the menu bounded even with several servers configured
        .map(t => `    - ${t.qualifiedName}${t.description ? `: ${t.description}` : ""}`)
        .join("\n")
    return `\n  MCP <server>.<tool> {"arg": "value"}  — call a connected external tool; JSON args on the SAME line
  Available MCP tools:\n${list}\n`
}

function searchMenuLine(webSearchEnabled: boolean): string {
    return webSearchEnabled ? "  SEARCH <query>           — search the web for current information\n" : ""
}

function actionMenu(maxIterations: number, mcpTools: QualifiedTool[], webSearchEnabled: boolean): string {
    return `You may investigate before answering. On each turn, respond with EXACTLY ONE line — either an action or your final answer:

  READ <path>              — show the current contents of a file (relative to the project root)
  GREP <pattern> [IN <path>] — search the project for a regex pattern, optionally scoped to a subpath
  RUN <name>                — run a known diagnostic; <name> is one of: ${Object.keys(RUN_COMMANDS).join(", ")}
${searchMenuLine(webSearchEnabled)}${mcpMenuLines(mcpTools)}
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
    const mcpTools = options.mcpManager?.tools ?? []
    const permissionRules = options.permissionRules ?? []
    const webSearchEnabled = options.webSearchConfig ? isWebSearchConfigured(options.webSearchConfig) : false
    return Effect.gen(function* () {
        const transcriptEntries: string[] = []

        for (let i = 0; i < maxIterations; i++) {
            const prompt = buildTurnPrompt(basePrompt, transcriptEntries, maxIterations, mcpTools, webSearchEnabled)
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

            const observation = yield* Effect.promise(() =>
                execute(action, options.projectRoot, options.mcpManager, permissionRules, options.webSearchConfig),
            )
            transcriptEntries.push(
                `### Turn ${i + 1}: ${describeAction(action)}\n${truncate(observation, MAX_OBSERVATION_CHARS)}`,
            )
        }

        // Iteration cap reached without an answer — force one, with everything
        // gathered so far. Never leave the caller with no result.
        const finalPrompt = `${buildTurnPrompt(basePrompt, transcriptEntries, maxIterations, mcpTools, webSearchEnabled)}\n\nYou have used all investigation turns. Answer now — no more actions.`
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

function buildTurnPrompt(
    basePrompt: string,
    transcriptEntries: string[],
    maxIterations: number,
    mcpTools: QualifiedTool[],
    webSearchEnabled: boolean,
): string {
    const transcript = transcriptEntries.length > 0
        ? `\n\n## Investigation so far\n${transcriptEntries.join("\n\n")}`
        : ""
    return `${actionMenu(maxIterations, mcpTools, webSearchEnabled)}\n\n## Task\n${basePrompt}${transcript}`
}

function describeAction(action: ParsedAction): string {
    switch (action.kind) {
        case "read": return `READ ${action.path}`
        case "grep": return `GREP ${action.pattern}${action.scope ? ` IN ${action.scope}` : ""}`
        case "run": return `RUN ${action.name}`
        case "mcp": return `MCP ${action.qualifiedName}`
        case "search": return `SEARCH ${action.query}`
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

    // Server id has no dots (config key); tool name may. Args are optional
    // text on the same line — captured permissively (not required to look
    // like balanced JSON) so genuinely malformed args still route to
    // executeMcp's JSON.parse error instead of silently falling through to
    // "answer" (which would make a garbled tool call look like a real,
    // confusing final answer).
    m = /^MCP\s+([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)(?:\s+(.+))?$/i.exec(firstLine)
    if (m) return { kind: "mcp", qualifiedName: `${m[1]}.${m[2]}`, argsJson: m[3] ?? "{}" }

    m = /^SEARCH\s+(.+)$/i.exec(firstLine)
    if (m) return { kind: "search", query: m[1]!.trim() }

    return { kind: "answer" }
}

// ─── Execution ──────────────────────────────────────────────────────────────

function execute(
    action: ParsedAction,
    projectRoot: string,
    mcpManager: McpManager | undefined,
    permissionRules: Ruleset,
    webSearchConfig: WebSearchConfig | undefined,
): Promise<string> {
    switch (action.kind) {
        case "read": return executeRead(projectRoot, action.path)
        case "grep": return executeGrep(projectRoot, action.pattern, action.scope)
        case "run": return executeRun(projectRoot, action.name, permissionRules)
        case "mcp": return executeMcp(action.qualifiedName, action.argsJson, mcpManager, permissionRules)
        case "search": return executeSearch(action.query, webSearchConfig, permissionRules)
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

// Diagnostics run through execSandboxed (packages/core/util/sandbox.ts):
// env-allowlisted always, wrapped in bwrap/sandbox-exec with network disabled
// when a sandboxer is available (Linux/macOS) — a read-only investigation
// command has no legitimate need for network access. On Windows, or when no
// sandboxer is installed, this degrades to env-allowlisting only (see that
// module's header for why true OS sandboxing isn't available there).
const RUN_COMMANDS: Record<string, RunCommand> = {
    typecheck: {
        description: "run the project's typecheck script",
        exec: async root => {
            if (isMonorepoRoot(root)) {
                return "REFUSED: this would typecheck the entire monorepo, not just the relevant package. Scope the task to a specific file/package first."
            }
            return withTimeout(
                (async () => {
                    const r = await execSandboxed(["bun", "run", "typecheck"], { cwd: root })
                    return (r.stdout + r.stderr) || `(no output, exit ${r.exitCode})`
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
                    const r = await execSandboxed(["bun", "test"], { cwd: root })
                    return (r.stdout + r.stderr) || `(no output, exit ${r.exitCode})`
                })(),
                RUN_TIMEOUT_MS,
                "test",
            )
        },
    },
    "git-diff": {
        description: "show uncommitted changes",
        exec: async root => {
            const r = await execSandboxed(["git", "diff", "HEAD"], { cwd: root })
            return r.stdout || "(no changes)"
        },
    },
    "git-status": {
        description: "show working tree status",
        exec: async root => {
            const r = await execSandboxed(["git", "status", "--short"], { cwd: root })
            return r.stdout || "(clean)"
        },
    },
    "check-assets": {
        // Extracts every image/link/stylesheet reference from the project's own
        // HTML/CSS/Markdown and reports which ones are DEAD (remote URL 4xx/5xx,
        // or a local file that doesn't exist). This is how the model discovers a
        // broken <img src> — a bug class no `bun test` can surface. Parameterless
        // by design: the URLs come from the user's files, never from model text,
        // so it adds a capability without opening an injection/SSRF surface.
        description: "validate that referenced images, links, and stylesheets actually resolve",
        exec: async root => {
            const files = await findAssetBearingFiles(root)
            if (files.length === 0) return "No HTML/CSS/Markdown files found to check."
            const results = await validateAssets(files, root)
            return formatReport(results)
        },
    },
    "check-render": {
        // Complements check-assets with an actual headless-browser render of
        // the project's HTML entry point — catches what a regex scan can't:
        // a JS-injected broken <img>, a redirect, a CORS failure. Optional
        // (Playwright must be installed) and reports that plainly rather
        // than erroring, so it's always safe for the model to try.
        description: "render the project's HTML entry point in a headless browser and report failed resource loads / console errors",
        exec: async root => {
            if (!(await BrowserCheck.isAvailable())) {
                return "Playwright isn't installed, so a real browser render isn't available. " +
                    "(bun add playwright && bunx playwright install chromium to enable.) " +
                    "Falling back: RUN check-assets for a static reference check instead."
            }
            const htmlFiles = await findAssetBearingFiles(root)
            const entry = htmlFiles.find(f => /\.html?$/i.test(f))
            if (!entry) return "No HTML file found to render."
            const result = await BrowserCheck.checkPage(`file://${resolve(root, entry).replace(/\\/g, "/")}`)
            if (!result) return `Render of ${entry} failed or timed out.`
            if (result.failedRequests.length === 0 && result.consoleErrors.length === 0) {
                return `${entry} rendered cleanly — no failed requests, no console errors.`
            }
            const failed = result.failedRequests
                .map(r => `  DEAD: ${r.url}${r.status ? ` (${r.status})` : ""}${r.failure ? ` — ${r.failure}` : ""}`)
                .join("\n")
            const consoleErrs = result.consoleErrors.map(c => `  WARN (console): ${c.text}`).join("\n")
            return [failed, consoleErrs].filter(Boolean).join("\n")
        },
    },
}

const ASSET_FILE_EXT = new Set(["html", "htm", "css", "md", "markdown", "svg"])

/** Find asset-reference-bearing files under the project root (bounded, ignoring
 *  the usual noise dirs) so `check-assets` can run without a model-supplied path. */
async function findAssetBearingFiles(root: string): Promise<string[]> {
    const glob = new Bun.Glob("**/*")
    const files: string[] = []
    for await (const rel of glob.scan({ cwd: root, dot: false })) {
        if (IGNORED_DIR_SEGMENTS.some(seg => rel.includes(`${seg}/`) || rel.includes(`${seg}\\`))) continue
        const ext = rel.split(".").pop()?.toLowerCase() ?? ""
        if (ASSET_FILE_EXT.has(ext)) files.push(rel)
        if (files.length >= 200) break
    }
    return files
}

async function executeRun(root: string, name: string, permissionRules: Ruleset): Promise<string> {
    const command = RUN_COMMANDS[name]
    if (!command) {
        return `ERROR: unknown RUN target "${name}". Available: ${Object.keys(RUN_COMMANDS).join(", ")}`
    }
    const permission = checkPermission(permissionRules, "run", name)
    if (!permission.allowed) return `REFUSED: ${permission.reason}`
    try {
        const output = await command.exec(root)
        return truncate(output, MAX_OBSERVATION_CHARS)
    } catch (e) {
        return `ERROR running ${name}: ${String(e)}`
    }
}

// ─── MCP: closed-server, schema-checked tool calls ─────────────────────────
// The SERVER set is a closed menu exactly like RUN_COMMANDS — it comes from
// the user's mdc-config.toml (see mcp-context.ts), never from model text.
// What's new here is that the model supplies structured JSON *arguments* to
// an external tool, which RUN's parameterless commands never allowed. Three
// gates before anything reaches a real process: (1) the qualified name must
// already be in the tool list handed to this session — an unlisted name is
// rejected with no call attempted; (2) the JSON must parse; (3) it must pass
// a shallow structural check against the tool's own declared input schema
// (required fields present, declared types match) — catching the common
// malformed-args case before spending a round trip on it.

const MAX_MCP_TIMEOUT_MS = 30_000

/** Not a full JSON-Schema validator (no $ref/oneOf/pattern support) — a
 *  deliberately shallow required/type check. Good enough to reject an
 *  obviously wrong call; the server is still the ground truth for anything
 *  more nuanced, exactly as it would be for a hand-written client. */
function validateArgsShallow(schema: QualifiedTool["inputSchema"], args: unknown): string | null {
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
        return "arguments must be a JSON object"
    }
    const s = schema as { required?: string[]; properties?: Record<string, { type?: string }> } | undefined
    const record = args as Record<string, unknown>

    for (const key of s?.required ?? []) {
        if (!(key in record)) return `missing required argument "${key}"`
    }
    for (const [key, value] of Object.entries(record)) {
        const expected = s?.properties?.[key]?.type
        if (!expected) continue
        const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value
        const typeMap: Record<string, string[]> = {
            string: ["string"],
            number: ["number"],
            integer: ["number"],
            boolean: ["boolean"],
            object: ["object"],
            array: ["array"],
            null: ["null"],
        }
        const allowed = typeMap[expected]
        if (allowed && !allowed.includes(actual)) {
            return `argument "${key}" should be ${expected}, got ${actual}`
        }
    }
    return null
}

async function executeMcp(
    qualifiedName: string,
    argsJson: string,
    mcpManager: McpManager | undefined,
    permissionRules: Ruleset,
): Promise<string> {
    if (!mcpManager || mcpManager.tools.length === 0) {
        return "ERROR: no MCP servers are configured for this session."
    }
    const tool = mcpManager.tools.find(t => t.qualifiedName === qualifiedName)
    if (!tool) {
        const available = mcpManager.tools.map(t => t.qualifiedName).join(", ") || "(none)"
        return `ERROR: unknown MCP tool "${qualifiedName}". Available: ${available}`
    }

    const permission = checkPermission(permissionRules, "mcp", qualifiedName)
    if (!permission.allowed) return `REFUSED: ${permission.reason}`

    let args: unknown
    try {
        args = JSON.parse(argsJson)
    } catch {
        return `ERROR: could not parse arguments as JSON: ${argsJson.slice(0, 200)}`
    }

    const validationError = validateArgsShallow(tool.inputSchema, args)
    if (validationError) return `ERROR: invalid arguments for ${qualifiedName} — ${validationError}`

    try {
        const output = await mcpManager.callTool(
            tool.server,
            tool.name,
            args as Record<string, unknown>,
            MAX_MCP_TIMEOUT_MS,
        )
        return truncate(output, MAX_OBSERVATION_CHARS)
    } catch (e) {
        return `ERROR calling ${qualifiedName}: ${e instanceof Error ? e.message : String(e)}`
    }
}

// ─── Web search: config-gated, permission-gated ────────────────────────────
// Unlike RUN/MCP, the "destination" here (Brave's API) is fixed by the
// provider check inside web-search.ts's search(), not by anything the model
// supplies — the model only ever controls the query text, the same
// trust boundary GREP already has for its regex pattern.

async function executeSearch(
    query: string,
    config: WebSearchConfig | undefined,
    permissionRules: Ruleset,
): Promise<string> {
    if (!config || !isWebSearchConfigured(config)) {
        return "ERROR: web search is not configured for this session."
    }
    const permission = checkPermission(permissionRules, "search", "web")
    if (!permission.allowed) return `REFUSED: ${permission.reason}`

    try {
        const results = await webSearch(query, config)
        return truncate(formatSearchResults(results), MAX_OBSERVATION_CHARS)
    } catch (e) {
        return `ERROR searching: ${e instanceof Error ? e.message : String(e)}`
    }
}

function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + "\n… (truncated)" : text
}
