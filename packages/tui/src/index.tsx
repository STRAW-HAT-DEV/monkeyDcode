import { createInterface } from "readline"
import { Effect, Cause } from "effect"
import { Runner } from "@monkeydcode/engine/session/runner"
import { initEngineSession, logUserToEngine, logAssistantToEngine, processWithEngine } from "./engine-session.ts"
import { handle as orchestrate } from "@monkeydcode/agent/orchestrator"
import { subscribe as subscribeStatus } from "@monkeydcode/agent/status"
import { runModelSetupWizard } from "@monkeydcode/core/model-setup"
import { startMcpServer } from "@monkeydcode/mcp-server"
import { startAcpAgent } from "@monkeydcode/acp"
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
    case "mcp-server":
        // startMcpServer() resolves once the initial handshake completes —
        // NOT when the session ends. The process must stay alive after that
        // to answer tools/list and tools/call; calling process.exit() here
        // would kill it before it can serve a single real request. The open
        // stdio transport keeps the event loop alive on its own; the process
        // exits naturally on EOF (parent closes the pipe) or SIGTERM.
        await startMcpServer()
        break
    case "acp":
        // Unlike startMcpServer(), startAcpAgent() genuinely awaits the
        // connection's `closed` promise internally (see packages/acp's
        // index.ts and its comment on why that distinction matters) — so
        // exiting right after IS correct here, not the same footgun.
        await startAcpAgent()
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
    if (root instanceof Error) {
        const code = (root as { code?: string }).code
        return code ? `[${code}] ${root.message}` : root.message
    }
    if (typeof root === "string") return root
    // Effect failures, retriever errors, and rejected promises surface as plain
    // objects like { message, _tag, code } — not Error instances. Pull the
    // message out so we never fall through to the useless "[object Object]".
    if (root && typeof root === "object") {
        const o = root as { code?: string; message?: unknown; _tag?: unknown }
        if (typeof o.message === "string" && o.message.length > 0) {
            return o.code ? `[${o.code}] ${o.message}` : o.message
        }
        if (typeof o._tag === "string" && o._tag.length > 0) return o._tag
        try {
            const json = JSON.stringify(root)
            // Prefer even "{}" over the useless "[object Object]".
            if (typeof json === "string") return json
        } catch {
            // fall through to String() below (circular / non-serializable)
        }
    }
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
        printError(friendlyError(describeError(e)))
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
