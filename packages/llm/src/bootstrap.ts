import { loadCredentials } from "@monkeydcode/core/credentials"
import type { MdcConfig } from "@monkeydcode/core/mdc-config"
import { LLMRuntime } from "./runtime.ts"
import { registerOpenAICompatibleProvider } from "./register-custom.ts"

// Side-effect: register built-in providers
import "./providers/anthropic.ts"
import "./providers/openai.ts"
import "./providers/openrouter.ts"
import "./providers/deepseek.ts"
import "./providers/groq.ts"
import "./providers/ollama.ts"

/** Apply saved credentials + config to the LLM runtime (call after loadConfig). */
export async function bootstrapLLM(config: MdcConfig): Promise<void> {
    const creds = await loadCredentials()
    LLMRuntime.applyAll(creds)

    if (creds.ollama?.baseUrl) {
        const url = creds.ollama.baseUrl.endsWith("/v1")
            ? creds.ollama.baseUrl
            : `${creds.ollama.baseUrl.replace(/\/$/, "")}/v1`
        LLMRuntime.set("ollama", { baseUrl: url })
    }

    if (config.provider === "custom" && creds.custom?.baseUrl) {
        registerOpenAICompatibleProvider(
            "custom",
            creds.custom.baseUrl,
            creds.custom.apiKey ?? "local",
        )
    }
}
