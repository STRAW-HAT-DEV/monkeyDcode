import * as p from "@clack/prompts"
import type { MdcConfig } from "./mdc-config.ts"
import { loadConfig, saveConfig } from "./mdc-config.ts"
import { loadCredentials, saveCredentials, hasProviderSecret } from "./credentials.ts"

export interface ProviderOption {
    id: string
    label: string
    needsApiKey: boolean
    envKeys?: string[]
    defaultBaseUrl?: string
    modelHint: string
}

export const PROVIDER_CATALOG: ProviderOption[] = [
    {
        id: "ollama",
        label: "Ollama (local)",
        needsApiKey: false,
        defaultBaseUrl: "http://localhost:11434",
        modelHint: "qwen2.5-coder:7b",
    },
    {
        id: "openrouter",
        label: "OpenRouter (many models, one key)",
        needsApiKey: true,
        envKeys: ["OPENROUTER_API_KEY"],
        modelHint: "qwen/qwen-2.5-coder-7b-instruct",
    },
    {
        id: "anthropic",
        label: "Anthropic",
        needsApiKey: true,
        envKeys: ["ANTHROPIC_API_KEY"],
        modelHint: "claude-sonnet-4-20250514",
    },
    {
        id: "openai",
        label: "OpenAI",
        needsApiKey: true,
        envKeys: ["OPENAI_API_KEY"],
        modelHint: "gpt-4o",
    },
    {
        id: "deepseek",
        label: "DeepSeek",
        needsApiKey: true,
        envKeys: ["DEEPSEEK_API_KEY"],
        modelHint: "deepseek-chat",
    },
    {
        id: "groq",
        label: "Groq (fast inference)",
        needsApiKey: true,
        envKeys: ["GROQ_API_KEY"],
        modelHint: "llama-3.3-70b-versatile",
    },
    {
        id: "custom",
        label: "Custom OpenAI-compatible API (LM Studio, vLLM, etc.)",
        needsApiKey: true,
        defaultBaseUrl: "http://localhost:1234/v1",
        modelHint: "your-model-id",
    },
]

export function isModelConfigured(config: MdcConfig): boolean {
    return Boolean(config.provider?.trim() && config.model?.trim())
}

function catalogEntry(provider: string): ProviderOption | undefined {
    return PROVIDER_CATALOG.find(p => p.id === provider)
}

async function listOllamaModels(baseUrl: string): Promise<string[]> {
    try {
        const root = baseUrl.replace(/\/v1\/?$/, "")
        const res = await fetch(`${root}/api/tags`)
        if (!res.ok) return []
        const data = (await res.json()) as { models?: Array<{ name: string }> }
        return (data.models ?? []).map(m => m.name)
    } catch {
        return []
    }
}

async function promptModelId(provider: string, baseUrl?: string): Promise<string> {
    const entry = catalogEntry(provider)
    if (provider === "ollama" && baseUrl) {
        const models = await listOllamaModels(baseUrl)
        if (models.length > 0) {
            const picked = await p.select({
                message: "Select a local model",
                options: models.map(m => ({ value: m, label: m })),
            })
            if (!p.isCancel(picked) && typeof picked === "string") return picked
        }
    }

    const model = await p.text({
        message: "Model ID",
        placeholder: entry?.modelHint ?? "model-name",
        validate: v => (v?.trim() ? undefined : "Model ID is required"),
    })
    if (p.isCancel(model)) throw new Error("Setup cancelled")
    return String(model).trim()
}

async function promptApiKey(provider: string, envKeys: string[] = []): Promise<string | undefined> {
    const fromEnv = envKeys.map(k => process.env[k]).find(Boolean)
    if (fromEnv) {
        const useEnv = await p.confirm({
            message: `Use API key from ${envKeys[0]} environment variable?`,
            initialValue: true,
        })
        if (!p.isCancel(useEnv) && useEnv) return fromEnv
    }

    const key = await p.password({
        message: "API key",
        validate: v => (v?.trim() ? undefined : "API key is required"),
    })
    if (p.isCancel(key)) throw new Error("Setup cancelled")
    return String(key).trim()
}

/** Interactive first-run setup — asks for provider, credentials, and model. */
export async function runModelSetupWizard(): Promise<MdcConfig> {
    p.intro("monkeyDcode — model setup")

    const mode = await p.select({
        message: "How do you want to connect?",
        options: [
            { value: "pick", label: "Choose a provider and enter credentials" },
            { value: "env", label: "I already set API keys in environment variables" },
        ],
    })
    if (p.isCancel(mode)) throw new Error("Setup cancelled")

    let provider: string
    let apiKey: string | undefined
    let baseUrl: string | undefined
    let model = ""

    if (mode === "env") {
        const withEnv = PROVIDER_CATALOG.filter(
            e => e.envKeys?.some(k => process.env[k]),
        )
        if (withEnv.length === 0) {
            p.log.error("No supported API keys found in environment.")
            p.outro("Set e.g. OPENROUTER_API_KEY or ANTHROPIC_API_KEY, then re-run.")
            throw new Error("No API keys in environment")
        }
        const picked = await p.select({
            message: "Provider detected from environment",
            options: withEnv.map(e => ({ value: e.id, label: e.label })),
        })
        if (p.isCancel(picked)) throw new Error("Setup cancelled")
        provider = String(picked)
        const entry = catalogEntry(provider)!
        apiKey = entry.envKeys?.map(k => process.env[k]).find(Boolean)
        model = await promptModelId(provider)
    } else {
        const picked = await p.select({
            message: "Provider",
            options: PROVIDER_CATALOG.map(e => ({ value: e.id, label: e.label })),
        })
        if (p.isCancel(picked)) throw new Error("Setup cancelled")
        provider = String(picked)
        const entry = catalogEntry(provider)!

        if (provider === "custom") {
            const url = await p.text({
                message: "API base URL (OpenAI-compatible)",
                placeholder: entry.defaultBaseUrl,
                initialValue: entry.defaultBaseUrl,
                validate: v => (v?.trim() ? undefined : "Base URL is required"),
            })
            if (p.isCancel(url)) throw new Error("Setup cancelled")
            baseUrl = String(url).trim().replace(/\/$/, "")

            const needsKey = await p.confirm({
                message: "Does this endpoint require an API key?",
                initialValue: false,
            })
            if (!p.isCancel(needsKey) && needsKey) {
                apiKey = await promptApiKey("custom")
            } else {
                apiKey = "local"
            }
            model = await promptModelId(provider)
        } else if (provider === "ollama") {
            const url = await p.text({
                message: "Ollama base URL",
                placeholder: entry.defaultBaseUrl,
                initialValue: entry.defaultBaseUrl,
            })
            if (p.isCancel(url)) throw new Error("Setup cancelled")
            baseUrl = String(url).trim().replace(/\/$/, "")
            model = await promptModelId(provider, baseUrl)
        } else {
            apiKey = await promptApiKey(provider, entry.envKeys ?? [])
            model = await promptModelId(provider)
        }
    }

    const config = await loadConfig()
    config.provider = provider
    config.model = model

    const creds = await loadCredentials()
    const normalizedOllama = baseUrl
        ? baseUrl.endsWith("/v1")
            ? baseUrl
            : `${baseUrl}/v1`
        : undefined

    creds[provider] = {
        ...(apiKey ? { apiKey } : {}),
        ...(normalizedOllama ? { baseUrl: normalizedOllama } : {}),
        ...(provider === "custom" && baseUrl ? { baseUrl } : {}),
    }

    await saveCredentials(creds)
    await saveConfig(config)

    p.log.success(`Using ${provider} / ${model}`)
    p.outro(`Saved to ${resolveConfigPathForUser()}`)
    return config
}

function resolveConfigPathForUser(): string {
    return process.platform === "win32"
        ? "%APPDATA%\\monkeydcode\\"
        : "~/.config/monkeydcode/"
}

/** Run setup when no model is configured; skip when config + credentials exist. */
export async function ensureModelConfigured(): Promise<MdcConfig> {
    if (process.env.MDCODE_SKIP_SETUP === "1") {
        return loadConfig()
    }

    if (process.env.MDCODE_RECONFIGURE === "1" && process.stdin.isTTY) {
        return runModelSetupWizard()
    }

    const config = await loadConfig()
    const creds = await loadCredentials()

    if (isModelConfigured(config)) {
        const entry = catalogEntry(config.provider)
        const envKeys = entry?.envKeys ?? []
        if (
            config.provider === "ollama" ||
            config.provider === "custom" ||
            hasProviderSecret(config.provider, creds, envKeys)
        ) {
            return config
        }
    }

    if (!process.stdin.isTTY) {
        throw new Error(
            "No model configured. Run interactively once, or set provider/model in config and credentials.",
        )
    }

    return runModelSetupWizard()
}
