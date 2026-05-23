export type LLMErrorCode =
    | "auth_failed"
    | "rate_limited"
    | "model_not_found"
    | "context_too_long"
    | "network_error"
    | "parse_error"
    | "unknown"

export class LLMError extends Error {
    readonly _tag = "LLMError" // Effect-compatible tag

    constructor(
        message: string,
        readonly code: LLMErrorCode,
        readonly provider?: string,
        readonly statusCode?: number,
        override readonly cause?: unknown,
    ) {
        super(message)
        this.name = "LLMError"
    }

    static from(e: unknown, provider?: string): LLMError {
        if (e instanceof LLMError) return e
        return new LLMError(String(e), "unknown", provider, undefined, e)
    }
}
