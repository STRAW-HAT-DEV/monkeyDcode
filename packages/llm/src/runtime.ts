/** Per-provider runtime overrides (user setup — not hardcoded in source). */

export interface ProviderRuntime {
    apiKey?: string
    baseUrl?: string
}

const overrides = new Map<string, ProviderRuntime>()

export const LLMRuntime = {
    set(provider: string, config: ProviderRuntime): void {
        overrides.set(provider, { ...overrides.get(provider), ...config })
    },

    get(provider: string): ProviderRuntime | undefined {
        return overrides.get(provider)
    },

    getApiKey(provider: string, fallback: () => string | undefined): string | undefined {
        const key = overrides.get(provider)?.apiKey
        if (key) return key
        return fallback()
    },

    getBaseUrl(provider: string, fallback: string): string {
        return overrides.get(provider)?.baseUrl ?? fallback
    },

    applyAll(creds: Record<string, ProviderRuntime>): void {
        for (const [id, cfg] of Object.entries(creds)) {
            this.set(id, cfg)
        }
    },

    clear(): void {
        overrides.clear()
    },
}
