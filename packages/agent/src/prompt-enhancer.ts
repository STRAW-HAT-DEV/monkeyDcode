// Prompt enhancer. Turns a terse user request into a precise, constrained spec
// BEFORE it reaches the planner/sampler. This is the input-quality half of the
// model-agnostic story: temperature sampling can only pick the best candidate
// the model produces, so the cheapest way to lift a weak model is to stop asking
// it open-ended questions and hand it an explicit contract instead.
//
// It is deliberately DETERMINISTIC (no LLM call). An LLM-based "clarify" step
// behaves differently on every model — the exact non-determinism we're trying to
// remove for weaker models. Rules give every model the same strong starting spec.

import { detectTaskType, type TaskType } from "./task-type.ts"

export interface EnhanceInput {
    rawTask: string
    /** Model capability level 1 (strong) … 6 (weak). Lower-capability models get
     *  stricter, more explicit constraints. */
    capabilityLevel: number
}

export interface EnhancedSpec {
    taskType: TaskType
    /** Full enriched instruction to feed the planner or scaffold builder. */
    task: string
    deliverables: string[]
    constraints: string[]
}

export interface PromptEnhancer {
    enhance(input: EnhanceInput): EnhancedSpec
}

interface TypeProfile {
    deliverables: string[]
    constraints: string[]
}

const PROFILES: Record<TaskType, TypeProfile> = {
    web_page: {
        deliverables: [
            "A single, self-contained index.html that opens directly in a browser",
            "All CSS inside one <style> tag in the <head>",
            "All JavaScript inside one <script> tag before </body>",
            "Semantic HTML5 structure (header, nav, main, section, footer)",
            "Responsive layout that works on mobile and desktop",
        ],
        constraints: [
            "No external build step, bundler, or framework — plain HTML/CSS/JS only",
            "No external file references except fonts/images via public CDNs",
            "The file must be complete and runnable on its own",
        ],
    },
    react_component: {
        deliverables: [
            "A single .tsx file exporting one component as the default export",
            "Typed props via an explicit interface",
            "Self-contained styles (CSS-in-JS or a co-located className contract)",
        ],
        constraints: [
            "Use function components and hooks only",
            "No unused imports; the file must typecheck in isolation",
        ],
    },
    cli_script: {
        deliverables: [
            "A single executable script with a clear entry point",
            "Argument parsing and a --help usage message",
            "Non-zero exit codes on error",
        ],
        constraints: ["Use only the standard library unless a dependency is explicitly requested"],
    },
    python_script: {
        deliverables: [
            "A single .py file with an if __name__ == '__main__': entry point",
            "Functions with type hints and short docstrings",
        ],
        constraints: ["Standard library only unless a dependency is explicitly requested"],
    },
    api_endpoint: {
        deliverables: [
            "Route handler(s) with explicit request/response typing",
            "Input validation and proper HTTP status codes",
            "Error handling that never leaks stack traces",
        ],
        constraints: ["Follow the existing framework and conventions already present in the project"],
    },
    generic: {
        deliverables: [],
        constraints: [],
    },
}

// Extra constraints injected for weaker models (higher level number). These force
// the determinism that strong models give for free.
function capabilityConstraints(level: number): string[] {
    if (level <= 3) return []
    const strict = [
        "Output the COMPLETE file content — never snippets, placeholders, or \"...\"",
        "Do not include explanations or commentary outside the code",
    ]
    if (level >= 5) {
        strict.push(
            "Keep the solution simple and direct; avoid clever abstractions",
            "Use only well-known, widely-supported APIs",
        )
    }
    return strict
}

export class TemplateEnhancer implements PromptEnhancer {
    enhance(input: EnhanceInput): EnhancedSpec {
        const { type } = detectTaskType(input.rawTask)
        const profile = PROFILES[type]
        const deliverables = profile.deliverables
        const constraints = [...profile.constraints, ...capabilityConstraints(input.capabilityLevel)]

        return {
            taskType: type,
            task: compose(input.rawTask, deliverables, constraints),
            deliverables,
            constraints,
        }
    }
}

function compose(rawTask: string, deliverables: string[], constraints: string[]): string {
    let out = rawTask.trim()
    if (deliverables.length > 0) {
        out += `\n\n## Deliverables\n${deliverables.map(d => `- ${d}`).join("\n")}`
    }
    if (constraints.length > 0) {
        out += `\n\n## Constraints\n${constraints.map(c => `- ${c}`).join("\n")}`
    }
    return out
}

export const defaultEnhancer: PromptEnhancer = new TemplateEnhancer()

/** Convenience wrapper around the default enhancer. */
export function enhance(input: EnhanceInput): EnhancedSpec {
    return defaultEnhancer.enhance(input)
}
