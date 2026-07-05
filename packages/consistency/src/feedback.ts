import type { VerificationError } from "./verification/types.ts"

function formatErrorLines(errors: VerificationError[]): string {
    const lines = errors.slice(0, 20).map(err => {
        const loc = err.column
            ? `${err.file}:${err.line}:${err.column}`
            : `${err.file}:${err.line}`
        const rule = err.rule ? ` [${err.rule}]` : ""
        return `- ${loc}${rule}: ${err.message}`
    })
    return lines.join("\n") + (errors.length > 20 ? `\n... and ${errors.length - 20} more` : "")
}

/** Shape verification errors into a FULL RESAMPLE retry prompt — restarts from
 *  the original task with error context appended. Used only when every
 *  candidate failed and repair (below) has nothing to repair from. */
export function buildRetryPrompt(basePrompt: string, errors: VerificationError[]): string {
    if (errors.length === 0) return basePrompt

    return `${basePrompt}

Previous attempt failed verification. Fix these errors:
${formatErrorLines(errors)}`
}

/**
 * Shape a REPAIR prompt: asks the model to produce a minimal fix to its OWN
 * prior output, not regenerate from the original task. This is the cheap,
 * reliable path — weak models are far better at "fix this specific error in
 * code you just wrote" than at "produce fully correct code on the first try."
 * Distinct from buildRetryPrompt, which discards the candidate entirely.
 */
export function buildRepairPrompt(previousChange: string, errors: VerificationError[]): string {
    return `You previously produced this output:

${previousChange}

It failed verification with these specific errors:
${formatErrorLines(errors)}

Fix ONLY what is needed to resolve these errors. Preserve everything else exactly
as it was — do not rewrite unrelated code, do not change formatting elsewhere,
do not "improve" anything not mentioned in the errors above.

Output the complete corrected result in the same format as before (same code
block / hashline convention).`
}
