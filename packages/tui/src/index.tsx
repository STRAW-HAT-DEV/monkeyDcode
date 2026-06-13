import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { Effect } from "effect"
import { Runner } from "@monkeydcode/engine/session/runner"
import { initEngineSession, logUserToEngine, logAssistantToEngine, processWithEngine } from "./engine-session.ts"
import { handle as orchestrate } from "@monkeydcode/agent/orchestrator"

const echoMode = process.env.MDCODE_ECHO === "1"
import { loadTuiConfig } from "./config.ts"
import { App } from "./App.tsx"

const { config, model, modelId } = await loadTuiConfig()
const runnerSession = Runner.createSession(process.cwd())
const engineSession = await initEngineSession(process.cwd())

const renderer = await createCliRenderer()
const root = createRoot(renderer)

// CLI one-shot: mdc "add pagination"
const cliArg = process.argv.slice(2).join(" ").trim()
if (cliArg) {
    Runner.logMessage(runnerSession.id, "user", cliArg)
    await logUserToEngine(process.cwd(), engineSession.id, cliArg, model)
    const reply = echoMode
        ? await processWithEngine(process.cwd(), engineSession.id, cliArg, model)
        : await (async () => {
            await Effect.runPromise(orchestrate(cliArg, model, modelId))
            return "Task completed."
        })()
    Runner.logMessage(runnerSession.id, "assistant", reply)
    await logAssistantToEngine(process.cwd(), engineSession.id, reply)
    console.log(reply)
    process.exit(0)
}

root.render(
    <App
        config={config}
        model={model}
        modelId={modelId}
        runnerSessionId={runnerSession.id}
        engineSessionId={engineSession.id}
        echoMode={echoMode}
    />,
)
