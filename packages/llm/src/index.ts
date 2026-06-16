// Public API for @monkeydcode/llm
// Import the providers you need — each self-registers on import.

export type {
    Role,
    TextPart,
    ImagePart,
    ToolCallPart,
    ToolResultPart,
    ContentPart,
    Message,
    ToolDefinition,
    ModelRef,
    LLMRequest,
    UsageStats,
    StopReason,
    LLMResponse,
    LLMEvent,
} from "./schema.ts"

export { LLMError } from "./error.ts"
export type { LLMErrorCode } from "./error.ts"

export type { Protocol, RequestBuilder, ResponseParser } from "./protocol.ts"
export { Route } from "./route.ts"
export type { RouteConfig } from "./route.ts"
export { RouteRegistry } from "./route-registry.ts"
export { LLMRuntime } from "./runtime.ts"
export { resolveModel } from "./resolve-model.ts"
export { bootstrapLLM } from "./bootstrap.ts"
export { registerOpenAICompatibleProvider } from "./register-custom.ts"
export { LLM } from "./llm.ts"

// Protocols (for building custom providers)
export { openAIChat } from "./protocols/openai-chat.ts"
export { anthropicMessages } from "./protocols/anthropic-messages.ts"

// Providers (import to activate)
export { anthropic } from "./providers/anthropic.ts"
export { openai } from "./providers/openai.ts"
export { ollama } from "./providers/ollama.ts"
export { deepseek } from "./providers/deepseek.ts"
export { groq } from "./providers/groq.ts"
export { openrouter } from "./providers/openrouter.ts"

// Uppercase re-exports for opencode engine compatibility
export { openrouter as OpenRouter } from "./providers/openrouter.ts"
export { anthropic as Anthropic } from "./providers/anthropic.ts"
export { openai as OpenAI } from "./providers/openai.ts"
export { ollama as Ollama } from "./providers/ollama.ts"
export { deepseek as DeepSeek } from "./providers/deepseek.ts"
export { groq as Groq } from "./providers/groq.ts"

// Type aliases for opencode engine compatibility
export type Usage = import("./schema.ts").UsageStats
export type FinishReason = import("./schema.ts").StopReason
export type ProviderMetadata = Record<string, Record<string, unknown>>
export type ToolResultValue = string | Array<{ type: string; text?: string }>
export type JsonSchema = Record<string, unknown>

// Runtime Usage namespace for opencode engine compatibility
// (Usage is used as both a type and a namespace in session/processor.ts)
export const Usage = {
    make: (inputTokens: number, outputTokens: number): import("./schema.ts").UsageStats => ({
        inputTokens,
        outputTokens,
    }),
}
