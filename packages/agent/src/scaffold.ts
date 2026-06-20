// Deterministic scaffolding. For task types where the *shape* of the deliverable
// is known (e.g. a web page is one index.html), we skip the generic planner —
// which over-engineers ("landing page" → Handlebars template + test file) — and
// hand the build agent a precise, single-artifact plan with a constrained prompt.
//
// The model still does the creative work through the normal Sampler path, so
// temperature sampling / best-of-N / verification all still apply. We're only
// fixing WHAT it's asked to produce and WHERE it goes.

import { join } from "path"
import type { Plan, PlanStep } from "./plan-agent.ts"
import type { EnhancedSpec } from "./prompt-enhancer.ts"

export interface ScaffoldFile {
    /** Absolute path the artifact should be written to. */
    path: string
    /** Constrained, self-contained instruction for producing this file. */
    instruction: string
    verificationCriteria: string
}

export interface Scaffold {
    taskType: EnhancedSpec["taskType"]
    files: ScaffoldFile[]
}

/**
 * Returns a scaffold for task types with a known single-artifact shape, or null
 * to fall back to the generic planner.
 */
export function scaffoldFor(spec: EnhancedSpec, root: string): Scaffold | null {
    switch (spec.taskType) {
        case "web_page":
            return webPageScaffold(spec, root)
        case "react_component":
            return reactComponentScaffold(spec, root)
        case "cli_script":
            return cliScriptScaffold(spec, root)
        case "python_script":
            return pythonScriptScaffold(spec, root)
        default:
            return null
    }
}

function webPageScaffold(spec: EnhancedSpec, root: string): Scaffold {
    const path = join(root, "index.html")
    const instruction = [
        spec.task,
        "",
        "## Output Format — CRITICAL",
        "Produce the COMPLETE contents of a single file `index.html`.",
        "Output exactly one ```html fenced code block and nothing else.",
        "The document must be fully self-contained: <!DOCTYPE html>, <head> with a",
        "single <style> block, <body> with the content, and a single <script> block",
        "before </body>. It must render correctly when opened directly in a browser.",
    ].join("\n")

    return {
        taskType: "web_page",
        files: [{
            path,
            instruction,
            verificationCriteria: "index.html is a complete, self-contained, valid HTML5 document",
        }],
    }
}

function reactComponentScaffold(spec: EnhancedSpec, root: string): Scaffold {
    const componentName = inferPascalName(rawTask(spec), "GeneratedComponent")
    const relativePath = `src/components/${componentName}.tsx`
    const path = join(root, relativePath)
    const instruction = [
        spec.task,
        "",
        "## Output Format — CRITICAL",
        `Produce the COMPLETE contents of a single React component file \`${relativePath}\`.`,
        `Output exactly one \`\`\`tsx:${relativePath} fenced code block and nothing else.`,
        `Export \`${componentName}\` as the default export.`,
        "Use an explicit Props interface, avoid unused imports, and keep the component",
        "self-contained so it typechecks without relying on generated companion files.",
    ].join("\n")

    return {
        taskType: "react_component",
        files: [{
            path,
            instruction,
            verificationCriteria: `${relativePath} typechecks and exports a default React component`,
        }],
    }
}

function cliScriptScaffold(spec: EnhancedSpec, root: string): Scaffold {
    const scriptName = inferKebabName(rawTask(spec), "tool")
    const relativePath = `scripts/${scriptName}.sh`
    const path = join(root, relativePath)
    const instruction = [
        spec.task,
        "",
        "## Output Format — CRITICAL",
        `Produce the COMPLETE contents of a single executable shell script \`${relativePath}\`.`,
        `Output exactly one \`\`\`bash:${relativePath} fenced code block and nothing else.`,
        "Include a shebang, a --help path, clear argument parsing, and non-zero exits",
        "for errors. Use POSIX-compatible shell where practical.",
    ].join("\n")

    return {
        taskType: "cli_script",
        files: [{
            path,
            instruction,
            verificationCriteria: `${relativePath} is a complete executable CLI script with --help behavior`,
        }],
    }
}

function pythonScriptScaffold(spec: EnhancedSpec, root: string): Scaffold {
    const scriptName = inferSnakeName(rawTask(spec), "script")
    const relativePath = `scripts/${scriptName}.py`
    const path = join(root, relativePath)
    const instruction = [
        spec.task,
        "",
        "## Output Format — CRITICAL",
        `Produce the COMPLETE contents of a single Python script \`${relativePath}\`.`,
        `Output exactly one \`\`\`python:${relativePath} fenced code block and nothing else.`,
        "Use argparse for CLI arguments, type hints for functions, a main() function,",
        "and an if __name__ == \"__main__\" entry point.",
    ].join("\n")

    return {
        taskType: "python_script",
        files: [{
            path,
            instruction,
            verificationCriteria: `${relativePath} is syntactically valid Python with a main entry point`,
        }],
    }
}

function rawTask(spec: EnhancedSpec): string {
    return spec.task.split("\n\n## ")[0]?.trim() ?? spec.task
}

function inferPascalName(task: string, fallback: string): string {
    const capitalizedBeforeComponent = task.match(/\b([A-Z][A-Za-z0-9]*)\b(?=.*\bcomponent\b)/)
    if (capitalizedBeforeComponent?.[1]) return capitalizedBeforeComponent[1]

    const noun = task.match(
        /\b(?:build|create|make|add)\s+(?:a|an|the|reusable|new)?\s*([A-Za-z][A-Za-z0-9-]*)/i,
    )?.[1]
    const base = noun ? toWords(noun) : []
    const words = base.length > 0 ? base : toWords(task).slice(0, 3)
    const name = words.map(capitalize).join("")
    return name || fallback
}

function inferKebabName(task: string, fallback: string): string {
    const words = meaningfulWords(task)
    return words.length > 0 ? words.slice(0, 4).join("-") : fallback
}

function inferSnakeName(task: string, fallback: string): string {
    const words = meaningfulWords(task)
    return words.length > 0 ? words.slice(0, 4).join("_") : fallback
}

function meaningfulWords(task: string): string[] {
    const stop = new Set([
        "a", "an", "the", "and", "or", "to", "for", "with", "using",
        "build", "create", "make", "add", "write", "script", "cli", "tool",
        "python", "shell", "bash", "command", "line",
    ])
    return toWords(task)
        .map(w => w.toLowerCase())
        .filter(w => !stop.has(w) && w.length > 1)
}

function toWords(value: string): string[] {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .map(w => w.trim())
        .filter(Boolean)
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Convert a scaffold into a Plan the build agent can execute directly. */
export function toPlan(scaffold: Scaffold, decompositionLevel: number): Plan {
    const steps: PlanStep[] = scaffold.files.map(f => ({
        description: f.instruction,
        targetFiles: [f.path],
        changeType: "create",
        dependencies: [],
        verificationCriteria: f.verificationCriteria,
    }))
    return { steps, decompositionLevel }
}
