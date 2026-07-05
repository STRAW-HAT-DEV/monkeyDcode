import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { Message, ModelRef } from "@monkeydcode/llm"
import { readFile } from "fs/promises"
import { relative } from "path"
import { join } from "path"
import { fileURLToPath } from "url"
import { $ } from "bun"
import * as Pipeline from "@monkeydcode/consistency/verification/pipeline"
import * as Capability from "@monkeydcode/consistency/model-capability/detector"
import { initSessionContext } from "@monkeydcode/context/session-init"
import * as PlanAgent from "./plan-agent.ts"
import * as BuildAgent from "./build-agent.ts"
import * as Enhancer from "./prompt-enhancer.ts"
import * as Scaffold from "./scaffold.ts"
import * as ReviewAgent from "./review-agent.ts"
import * as BugFix from "./sub-agents/bugfix.ts"
import * as Feature from "./sub-agents/feature.ts"
import * as Refactor from "./sub-agents/refactor.ts"
import * as Debug from "./sub-agents/debug.ts"
import * as Status from "./status.ts"
import * as WorkingMemory from "./working-memory.ts"
import * as Changes from "./changes.ts"
import * as RepoMap from "./repo-map.ts"

const PROMPTS = join(fileURLToPath(import.meta.url), "../prompts")

type Category = "bug_fix" | "feature" | "refactor" | "debug" | "chat" | "general"

let contextInitialized = false

export function handle(
    message: string,
    model: ModelRef,
    modelId: string,
    history: Message[] = [],
): Effect.Effect<string, unknown> {
    return Effect.gen(function* () {
        yield* WorkingMemory.setGoal(message)
        Status.emit({ agent: "luffy", action: "Classifying request..." })

        const category = yield* classify(message, model, history)

        // Fast path: conversational input never touches the build/verify/review pipeline.
        // History gives the agent memory of what it did in earlier turns.
        if (category === "chat") {
            Status.emit({ agent: "luffy", action: "Replying..." })
            const reply = yield* chatReply(message, model, history)
            Status.emit({ agent: "idle", action: "Done" })
            return reply
        }

        // Every other branch used to receive only the bare `message`, with no
        // access to `history` at all — so a follow-up like "change the hero
        // image" that got classified as an edit (not "chat") ran completely
        // blind to what was built in earlier turns. Fold recent history into
        // the task text so it reaches the enhancer/scaffold/planner/sub-agents
        // without having to thread a `history` param through all of them.
        const augmentedMessage = message + formatHistoryContext(history)

        // Reset the per-task write tracker so we can report exactly what changed.
        Changes.reset()

        if (!contextInitialized) {
            yield* initSessionContext(process.cwd())
            contextInitialized = true
        }

        switch (category) {
            case "bug_fix":
                Status.emit({ agent: "zoro", action: "Hunting the bug..." })
                yield* BugFix.fix({ error: augmentedMessage }, model, modelId)
                break

            case "feature": {
                const scaffolded = yield* tryScaffold(augmentedMessage, model, modelId)
                if (!scaffolded.handled) {
                    Status.emit({ agent: "nami", action: "Charting feature plan..." })
                    yield* Feature.build(scaffolded.task, model, modelId)
                }
                break
            }

            case "refactor": {
                const target = extractTarget(message)
                Status.emit({ agent: "sanji", action: `Refactoring ${target}...` })
                yield* Refactor.refactor(target, augmentedMessage, model, modelId)
                break
            }

            case "debug":
                Status.emit({ agent: "usopp", action: "Testing hypotheses..." })
                yield* Debug.debug(augmentedMessage, model, modelId)
                break

            default: {
                const scaffolded = yield* tryScaffold(augmentedMessage, model, modelId)
                if (!scaffolded.handled) {
                    Status.emit({ agent: "luffy", action: "Creating plan..." })
                    const plan = yield* PlanAgent.plan(scaffolded.task, model, modelId)
                    Status.emit({
                        agent: "franky",
                        action: `Executing ${plan.steps.length} steps (level ${plan.decompositionLevel})...`,
                        plan,
                        progress: { current: 0, total: plan.steps.length },
                    })
                    yield* BuildAgent.executePlan(plan, model, modelId)
                }
            }
        }

        // Source of truth for "did anything change": files actually written this
        // task. Works in non-git folders and detects brand-new untracked files —
        // unlike `git diff`, which silently shows nothing in both cases.
        const changed = Changes.take()
        if (changed.length === 0) {
            Status.emit({ agent: "idle", action: "Done" })
            return `Done (${category}). No file changes were produced.`
        }
        // The next plan() call in this session should see files this task just
        // created/modified, not a repo map cached from before the task ran.
        RepoMap.invalidate(process.cwd())

        const fileList = formatFileList(changed)

        // Verify just the files we touched (faster + more relevant than whole-repo).
        Status.emit({ agent: "robin", action: `Verifying ${changed.length} changed file(s)...` })
        const fullVerify = yield* Effect.tryPromise(() => Pipeline.run(changed, process.cwd()))
        if (!fullVerify.passed) {
            Status.emit({
                agent: "franky",
                action: `Fixing verification failures (${fullVerify.stage})...`,
            })
            yield* BuildAgent.executePlan({
                steps: [{
                    description: `Fix verification failures:\n${Pipeline.formatErrors(fullVerify)}`,
                    targetFiles: changed.slice(0, 5),
                    changeType: "modify",
                    dependencies: [],
                    verificationCriteria: "Full verification pipeline passes",
                }],
                decompositionLevel: 1,
            }, model, modelId)
        }

        // Actor-Critic review needs a git diff for context; skip cleanly when the
        // project isn't a git repo (common for fresh scaffolds in empty folders).
        const diff = yield* Effect.tryPromise(() => getDiff())
        if (diff === "No diff available") {
            Status.emit({ agent: "idle", action: "Done" })
            return `Done (${category}). Created/updated ${changed.length} file(s):\n${fileList}`
        }

        Status.emit({ agent: "robin", action: "Running Actor-Critic review...", diff })
        const issues = yield* ReviewAgent.review(model)

        const criticalOrHigh = issues.filter(
            i => i.severity === "critical" || i.severity === "high",
        )

        if (criticalOrHigh.length > 0) {
            Status.emit({
                agent: "franky",
                action: `Fixing ${criticalOrHigh.length} critical/high issue(s)...`,
            })
            const fixSteps = criticalOrHigh.map(i => ({
                description: `Fix ${i.severity} issue: ${i.message}${i.suggestion ? `\n\nSuggested fix: ${i.suggestion}` : ""}`,
                targetFiles: [i.file].filter(Boolean),
                changeType: "modify" as const,
                dependencies: [],
                verificationCriteria: `Issue resolved: ${i.message}`,
            }))

            yield* BuildAgent.executePlan(
                { steps: fixSteps, decompositionLevel: 1 },
                model,
                modelId,
            )
        }

        Status.emit({ agent: "idle", action: "Done" })
        const reviewed = criticalOrHigh.length > 0
            ? `Fixed ${criticalOrHigh.length} critical/high review issue(s).`
            : "Review passed clean."
        return `Done (${category}). ${reviewed}\nCreated/updated ${changed.length} file(s):\n${fileList}`
    })
}

function formatFileList(files: string[]): string {
    const root = process.cwd()
    return files
        .map(f => {
            const rel = relative(root, f)
            return `  • ${rel && !rel.startsWith("..") ? rel : f}`
        })
        .join("\n")
}

interface ScaffoldOutcome {
    /** True when a deterministic scaffold was built and executed. */
    handled: boolean
    /** Capability-enhanced task spec, used by the planner when not handled. */
    task: string
}

/**
 * Enhance the request into a precise spec, then — for task types with a known
 * single-artifact shape (e.g. a web page) — build it directly via a tight
 * scaffold instead of the generic planner. Returns the enhanced task so callers
 * can fall back to planning when no scaffold applies.
 */
function tryScaffold(
    message: string,
    model: ModelRef,
    modelId: string,
): Effect.Effect<ScaffoldOutcome, unknown> {
    return Effect.gen(function* () {
        const level = yield* Capability.detect(model)
        const spec = Enhancer.enhance({ rawTask: message, capabilityLevel: level })
        const scaffold = Scaffold.scaffoldFor(spec, process.cwd())

        if (!scaffold) return { handled: false, task: spec.task }

        const plan = Scaffold.toPlan(scaffold, level)
        Status.emit({
            agent: "franky",
            action: `Scaffolding ${spec.taskType.replace("_", " ")} (${plan.steps.length} file(s))...`,
            plan,
            progress: { current: 0, total: plan.steps.length },
        })
        yield* BuildAgent.executePlan(plan, model, modelId)
        return { handled: true, task: spec.task }
    })
}

/** Plain-text rendering of a Message's content, whether it's a bare string or
 *  a ContentPart array (tool calls/results/images render as a type tag). */
function messageText(m: Message): string {
    return typeof m.content === "string"
        ? m.content
        : m.content.map(p => (p.type === "text" ? p.text : `[${p.type}]`)).join(" ")
}

/** Condense recent turns into a short block so execution branches (bug_fix,
 *  feature, refactor, debug, generic plan) know what earlier turns already
 *  built, without needing a `history` parameter threaded through every
 *  sub-agent and the scaffold/enhancer/planner chain. */
function formatHistoryContext(history: Message[]): string {
    if (history.length === 0) return ""
    const recent = history.slice(-10)
    const lines = recent.map(m => `${m.role}: ${messageText(m).slice(0, 1000)}`)
    return (
        "\n\n## Recent Conversation\n" +
        "You may have already created or changed files described below in an earlier " +
        "turn — treat this as an iterative change to that work, not a fresh start, " +
        "unless the request clearly describes something new.\n" +
        lines.join("\n")
    )
}

function chatReply(
    message: string,
    model: ModelRef,
    history: Message[] = [],
): Effect.Effect<string, unknown> {
    return Effect.gen(function* () {
        // Keep the tail of the conversation so the agent remembers what it just did.
        const recent = history.slice(-20)
        const response = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [
                    {
                        role: "system",
                        content:
                            "You are monkeyDcode, a friendly coding agent. Answer concisely. " +
                            "Use the prior conversation to remember files you created or changed " +
                            "and how to run them. If the user wants you to change code, tell them " +
                            "to describe the task (e.g. \"fix the bug in auth.ts\").",
                    },
                    ...recent,
                    { role: "user", content: message },
                ],
            }),
        )
        return response.text.trim()
    })
}

// Deterministic pre-pass: a greeting or a literal stack trace never needs an
// LLM round-trip to classify, and — more importantly — a weak model asked to
// classify "hi" or a traceback occasionally gets it wrong, which for a
// traceback means it skips straight to the history-blind build path instead
// of "debug". Rules can't misroute the unambiguous cases; only ambiguous
// messages reach the model at all.
const GREETING_PATTERN = /^\s*(hi|hello|hey|yo|sup|thanks|thank you|good (morning|afternoon|evening))[\s!.,]*$/i
const STACK_TRACE_PATTERN = /at .+?:\d+:\d+\)?|Traceback \(most recent call last\)|File "[^"]+", line \d+|\bin <module>\b/

function deterministicClassify(message: string): Category | null {
    const trimmed = message.trim()
    if (trimmed.length === 0) return "chat"
    if (GREETING_PATTERN.test(trimmed)) return "chat"
    if (STACK_TRACE_PATTERN.test(message)) return "debug"
    return null
}

function classify(message: string, model: ModelRef, history: Message[] = []): Effect.Effect<Category, unknown> {
    return Effect.gen(function* () {
        const deterministic = deterministicClassify(message)
        if (deterministic) return deterministic

        const template = yield* Effect.tryPromise(() =>
            readFile(join(PROMPTS, "classify.txt"), "utf-8"),
        )
        // "now make the hero bigger" is unclassifiable in isolation — recent
        // turns are what tell the model this is a follow-up edit, not a
        // standalone ambiguous request.
        const historyBlock = history.length > 0
            ? history.slice(-2).map(m => `${m.role}: ${messageText(m).slice(0, 300)}`).join("\n")
            : "(none — this is the first message in the conversation)"
        const response = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{
                    role: "user",
                    content: template.replace("{MESSAGE}", message).replace("{HISTORY}", historyBlock),
                }],
            }),
        )
        const raw = response.text.trim().toLowerCase()
        const valid: Category[] = ["bug_fix", "feature", "refactor", "debug", "chat", "general"]
        return valid.find(c => raw.includes(c)) ?? "chat"
    })
}

function extractTarget(message: string): string {
    const match = message.match(/(?:refactor|clean up|restructure)\s+([^\s,]+)/i)
    return match?.[1] ?? process.cwd()
}

async function getDiff(): Promise<string> {
    const r = await $`git diff HEAD`.quiet().nothrow()
    const staged = await $`git diff --cached HEAD`.quiet().nothrow()
    return (r.stdout.toString() + staged.stdout.toString()).trim() || "No diff available"
}
