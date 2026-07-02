import { extname } from "path"
import type { Stage } from "./types.ts"

/**
 * Decides which verification stages are relevant for a given set of files.
 *
 * This is a separate responsibility from *running* the stages (see pipeline.ts),
 * and is injected into the pipeline so alternative selection policies can be
 * supplied without modifying the pipeline itself (Open/Closed + DIP).
 */
export interface StageSelector {
    select(files: string[], stages: Stage[]): Stage[]
}

/** Extensions the code-oriented stages (typecheck/lint/tests) actually apply to. */
const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
    "ts", "tsx", "js", "jsx", "mjs", "cjs",
    "py", "rs", "go",
])

/** Stages that remain meaningful for static, non-code assets (HTML/CSS/MD/...). */
const STATIC_SAFE_STAGES: ReadonlySet<Stage> = new Set<Stage>(["syntax", "smoke"])

function extensionOf(file: string): string {
    return extname(file).replace(".", "").toLowerCase()
}

/**
 * Conservative, behavior-preserving selector.
 *
 * If the changeset contains ANY source-code file, the full configured stage set
 * is returned unchanged — identical to the pre-existing pipeline behavior. Only
 * when a changeset is composed *exclusively* of static assets do we drop the
 * code-only stages (typecheck/lint/tests), which would otherwise run the entire
 * project's tooling (e.g. `bun test` on the whole repo) to verify an unrelated
 * standalone file such as a generated HTML page.
 */
export class StaticAssetStageSelector implements StageSelector {
    constructor(
        private readonly codeExtensions: ReadonlySet<string> = CODE_EXTENSIONS,
        private readonly staticSafeStages: ReadonlySet<Stage> = STATIC_SAFE_STAGES,
    ) {}

    select(files: string[], stages: Stage[]): Stage[] {
        // No target files to scope verification to. Previously this "preserved
        // configured behavior" by running the full stage set — but with no files,
        // detectProjectRoot() falls back to process.cwd(), and the "tests" stage
        // then spawns a fresh `bun test` there with no path scoping. In this
        // monorepo that means running the ENTIRE test suite, which includes
        // whatever test is currently calling this pipeline — a real recursive
        // hang (verified: a live-Ollama sampler test recursively re-invoked
        // itself via this exact path and never terminated). With no file to
        // anchor typecheck/lint/tests to, they can't meaningfully verify "this
        // candidate" anyway, so skip straight to the static-safe stages.
        if (files.length === 0) return stages.filter(s => this.staticSafeStages.has(s))

        const touchesCode = files.some(f => this.codeExtensions.has(extensionOf(f)))
        if (touchesCode) return stages

        return stages.filter(s => this.staticSafeStages.has(s))
    }
}

/** Default selector used by the pipeline. */
export const defaultStageSelector: StageSelector = new StaticAssetStageSelector()
