import { createInterface } from "readline"
import { Effect, Cause } from "effect"
import { Runner } from "@monkeydcode/engine/session/runner"
import { initEngineSession, logUserToEngine, logAssistantToEngine, processWithEngine } from "./engine-session.ts"
import { handle as orchestrate } from "@monkeydcode/agent/orchestrator"
import { subscribe as subscribeStatus } from "@monkeydcode/agent/status"
import { runModelSetupWizard } from "@monkeydcode/core/model-setup"
import { loadTuiConfig } from "./config.ts"
import { parseArgv, printHelp, runDoctor, printShellInit, VERSION } from "./cli.ts"
import { CREW, STATUS } from "./crew.ts"
import {
    R, BOLD, DIM, YELLOW, CYAN,
    printHeader, printCrewRoster, printInteractiveHelp,
    printStatus, clearStatusLine, printUser, printAssistant, printError,
} from "./banner.ts"

const echoMode = process.env.MDCODE_ECHO === "1"
const cli = parseArgv(process.argv.slice(2))

switch (cli.mode) {
    case "help":
        printHelp()
        process.exit(0)
        break
    case "version":
        console.log(`monkeyDcode v${VERSION}`)
        process.exit(0)
        break
    case "doctor": {
        const code = await runDoctor()
        process.exit(code)
        break
    }
    case "setup":
        await runModelSetupWizard()
        process.exit(0)
        break
    case "shell-init":
        printShellInit(cli.shell)
        process.exit(0)
        break
}

const { model, modelId } = await loadTuiConfig()
const runnerSession = Runner.createSession(process.cwd())
const engineSession = await initEngineSession(process.cwd())

/**
 * Drill through wrapper errors (Effect's UnknownException, AggregateError, and
 * `cause` chains) to the root error that actually explains the failure.
 */
function rootCause(e: unknown): unknown {
    let current = e
    const seen = new Set<unknown>()
    while (current && typeof current === "object" && !seen.has(current)) {
        seen.add(current)
        const c = current as { error?: unknown; cause?: unknown; errors?: unknown[] }
        const next =
            c.error ??
            c.cause ??
            (Array.isArray(c.errors) ? c.errors[0] : undefined)
        if (next === undefined || next === current) break
        current = next
    }
    return current
}

/** Add an actionable hint for common, recoverable failure modes. */
function friendlyError(err: string): string {
    if (/ECONNRESET|socket connection was closed|HTTP 500/i.test(err)) {
        return `${err}\n  → The local model server dropped the connection (it likely ran out of memory on a large generation). ` +
            `Restart it (\`ollama serve\`), try a smaller/simpler task, or use a stronger model via /setup.`
    }
    if (/ECONNREFUSED|Unable to connect|network error/i.test(err)) {
        return `${err}\n  → Can't reach the model server. Is it running? Start it with \`ollama serve\`, or check /model.`
    }
    if (/\[timeout\]|timed out/i.test(err)) {
        return `${err}\n  → The model was too slow. Try a smaller model, a simpler task, or raise MDCODE_LLM_TIMEOUT_MS.`
    }
    if (/\[rate_limited\]|HTTP 429|rate limit/i.test(err)) {
        return `${err}\n  → Hit the provider's rate limit (free tiers are small). It auto-retries, but for big tasks ` +
            `try a smaller request, wait a minute, or upgrade your plan / use a different provider via /setup.`
    }
    return err
}

/** Human-readable message for the deepest meaningful error. */
function describeError(e: unknown): string {
    const root = rootCause(e)
    const code = (root as { code?: string })?.code
    if (root instanceof Error) return code ? `[${code}] ${root.message}` : root.message
    if (typeof root === "string") return root
    return String(root)
}

/**
 * Run the orchestrator and surface the *real* underlying error instead of
 * Effect's generic "An error occurred in Effect.tryPromise" wrapper.
 */
async function orchestrateToReply(text: string): Promise<string> {
    // Prior turns (the current user message is already logged, so drop the tail)
    // give the agent memory of what it built earlier in this session.
    const history = Runner.getHistory(runnerSession.id).slice(0, -1)
    const exit = await Effect.runPromiseExit(orchestrate(text, model, modelId, history))
    if (exit._tag === "Success") return exit.value
    throw new Error(describeError(Cause.squash(exit.cause)))
}

// ─── One-shot mode (mdc "do something") ───────────────────────────────────────
if (cli.mode === "oneshot" && cli.task) {
    Runner.logMessage(runnerSession.id, "user", cli.task)
    await logUserToEngine(process.cwd(), engineSession.id, cli.task, model)
    const reply = echoMode
        ? await processWithEngine(process.cwd(), engineSession.id, cli.task, model)
        : await orchestrateToReply(cli.task)
    Runner.logMessage(runnerSession.id, "assistant", reply)
    await logAssistantToEngine(process.cwd(), engineSession.id, reply)
    console.log(reply)
    process.exit(0)
}

// ─── Interactive Straw Hat UI ─────────────────────────────────────────────────
printHeader(model, runnerSession.id)
printStatus(STATUS.idle)
process.stdout.write("\n\n")

const rl = createInterface({ input: process.stdin, output: process.stdout })

let closed = false
let busy = false
rl.on("close", () => {
    if (closed) return
    closed = true
    if (!busy) process.exit(0)
})

async function runTask(text: string): Promise<void> {
    busy = true
    printUser(text)
    printStatus(STATUS.classify)

    // Live crew status: show which agent is working and what it's doing.
    const unsubscribe = subscribeStatus((s) => {
        if (s.agent === "idle") return
        printStatus(`${s.agent}: ${s.action}`)
    })

    try {
        Runner.logMessage(runnerSession.id, "user", text)
        await logUserToEngine(process.cwd(), engineSession.id, text, model)

        const reply = echoMode
            ? await processWithEngine(process.cwd(), engineSession.id, text, model)
            : await orchestrateToReply(text)

        clearStatusLine()
        printAssistant()
        console.log(`  ${reply}\n`)
        console.log(`  ${DIM}${STATUS.done}${R}`)

        Runner.logMessage(runnerSession.id, "assistant", reply)
        await logAssistantToEngine(process.cwd(), engineSession.id, reply)
    } catch (e) {
        clearStatusLine()
        printError(friendlyError(e instanceof Error ? e.message : String(e)))
    } finally {
        unsubscribe()
        busy = false
        if (closed) process.exit(0)
    }
}

function prompt(): void {
    if (closed) return
    rl.question(`${CYAN}>${R} `, async (raw: string) => {
        const text = raw.trim()
        if (!text) { prompt(); return }

        switch (text) {
            case "/exit":
            case "/quit":
                console.log(`\n${YELLOW}${BOLD}  🏴‍☠️  ${CREW.luffy.tagline}${R}`)
                console.log(`${DIM}  Until next time, Nakama.${R}\n`)
                rl.close()
                process.exit(0)
                return
            case "/crew":
                printCrewRoster()
                prompt()
                return
            case "/help":
                printInteractiveHelp(model, runnerSession.id)
                prompt()
                return
            case "/model":
                console.log(`\n  ${CYAN}${model.provider}/${model.id}${R}\n`)
                prompt()
                return
            case "/setup":
                await runModelSetupWizard()
                console.log(`\n  ${DIM}Restart monkeyDcode to use the new model.${R}\n`)
                prompt()
                return
            case "/clear":
                printHeader(model, runnerSession.id)
                prompt()
                return
            case "/status":
                console.log(`\n  ${YELLOW}${STATUS.idle}${R}\n`)
                prompt()
                return
        }

        await runTask(text)
        console.log()
        prompt()
    })
}

prompt()
