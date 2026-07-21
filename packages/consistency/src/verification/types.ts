export type Stage =
    | "syntax"
    | "typecheck"
    | "lint"
    | "tests"
    | "test-generated"
    | "assets"
    | "browser"
    | "smoke"
    | "complete"

export interface VerificationError {
    file: string
    line: number
    column?: number
    message: string
    severity: "error" | "warning"
    rule?: string
}

export interface StageResult {
    passed: boolean
    errors: VerificationError[]
    durationMs: number
}

export interface VerificationResult {
    passed: boolean
    stage: Stage
    score: number
    errors: VerificationError[]
    durationMs: number
    stages: Partial<Record<Stage, StageResult>>
}
