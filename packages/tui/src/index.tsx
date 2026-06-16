import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { Effect } from "effect"
import { Runner } from "@monkeydcode/engine/session/runner"
import { initEngineSession, logUserToEngine, logAssistantToEngine, processWithEngine } from "./engine-session.ts"
import { handle as orchestrate } from "@monkeydcode/agent/orchestrator"
import { runModelSetupWizard } from "@monkeydcode/core/model-setup"
import { loadTuiConfig } from "./config.ts"
import { App } from "./App.tsx"
import { parseArgv, printBanner, printHelp, runDoctor, printShellInit, VERSION } from "./cli.ts"

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

const { config, model, modelId } = await loadTuiConfig()
const runnerSession = Runner.createSession(process.cwd())
const engineSession = await initEngineSession(process.cwd())

if (cli.mode === "oneshot" && cli.task) {
    Runner.logMessage(runnerSession.id, "user", cli.task)
    await logUserToEngine(process.cwd(), engineSession.id, cli.task, model)
    const reply = echoMode
        ? await processWithEngine(process.cwd(), engineSession.id, cli.task, model)
        : await (async () => {
            await Effect.runPromise(orchestrate(cli.task!, model, modelId))
            return "Task completed."
        })()
    Runner.logMessage(runnerSession.id, "assistant", reply)
    await logAssistantToEngine(process.cwd(), engineSession.id, reply)
    console.log(reply)
    process.exit(0)
}

printBanner()
console.log(`  model: ${model.provider}/${model.id}`)
console.log(`  cwd:   ${process.cwd()}`)
console.log(`  tips:  /help in TUI · mdc setup · mdc "one-shot task"`)
console.log("")

const renderer = await createCliRenderer()
const root = createRoot(renderer)

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
