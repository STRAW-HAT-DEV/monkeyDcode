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
export { LLM } from "./llm.ts"

// Protocols (for building custom providers)
export { openAIChat } from "./protocols/openai-chat.ts"
export { anthropicMessages } from "./protocols/anthropic-messages.ts"

// Providers (import to activate)
export { anthropic } from "./providers/anthropic.ts"
export { openai } from "./providers/openai.ts"
export { ollama } from "./providers/ollama.ts"
export { deepseek } from "./providers/deepseek.ts"
export { openrouter } from "./providers/openrouter.ts"
