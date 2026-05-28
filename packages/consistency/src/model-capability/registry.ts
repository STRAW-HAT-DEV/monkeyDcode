export type CapabilityLevel = 1 | 2 | 3 | 4 | 5 | 6

export const KNOWN_MODELS: Record<string, CapabilityLevel> = {
    // Level 1: Frontier
    "claude-opus-4": 1, "claude-opus-4-7": 1,
    "gpt-4o": 1, "gemini-2.5-pro": 1,

    // Level 2: Strong
    "claude-sonnet-4": 2, "claude-sonnet-4-6": 2,
    "gpt-4o-mini": 2, "deepseek-v3": 2,

    // Level 3: Medium
    "qwen2.5-coder:72b": 3, "qwen2.5-coder:32b": 3,
    "llama-3.3-70b": 3, "mistral-large": 3,

    // Level 4
    "deepseek-coder:33b": 4,

    // Level 5
    "qwen2.5-coder:14b": 5, "codellama:13b": 5,

    // Level 6
    "qwen2.5-coder:7b": 6, "deepseek-coder:6.7b": 6, "codellama:7b": 6,
}

export function lookup(modelId: string): CapabilityLevel | null {
    return KNOWN_MODELS[modelId] ?? null
}
