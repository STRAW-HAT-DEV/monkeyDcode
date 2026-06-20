import type { VerificationError } from "./verification/types.ts"

/** Shape verification errors into a retry prompt for the sampler. */
export function buildRetryPrompt(basePrompt: string, errors: VerificationError[]): string {
    if (errors.length === 0) return basePrompt

    const lines = errors.slice(0, 20).map(err => {
        const loc = err.column
            ? `${err.file}:${err.line}:${err.column}`
            : `${err.file}:${err.line}`
        const rule = err.rule ? ` [${err.rule}]` : ""
        return `- ${loc}${rule}: ${err.message}`
    })

    return `${basePrompt}

Previous attempt failed verification. Fix these errors:
${lines.join("\n")}${errors.length > 20 ? `\n... and ${errors.length - 20} more` : ""}`
}
