import { test, expect } from "bun:test"
import { detectTaskType } from "../src/task-type.ts"
import { enhance, TemplateEnhancer } from "../src/prompt-enhancer.ts"
import { scaffoldFor, toPlan } from "../src/scaffold.ts"

// ─── Task-type detection ──────────────────────────────────────────────────────

test("detects a web page request", () => {
    expect(detectTaskType("make a nike landing page, colourful with animations").type)
        .toBe("web_page")
})

test("detects a react component request", () => {
    expect(detectTaskType("build a reusable Button react component").type)
        .toBe("react_component")
})

test("falls back to generic for unrecognised tasks", () => {
    expect(detectTaskType("optimize the database query in users service").type)
        .toBe("generic")
})

// ─── Prompt enhancer ──────────────────────────────────────────────────────────

test("enhancer adds web-page deliverables and keeps the original ask", () => {
    const spec = enhance({ rawTask: "make a nike landing page", capabilityLevel: 5 })
    expect(spec.taskType).toBe("web_page")
    expect(spec.task).toContain("make a nike landing page")
    expect(spec.task).toContain("## Deliverables")
    expect(spec.deliverables.some(d => d.includes("index.html"))).toBe(true)
})

test("weaker models get stricter constraints than strong models", () => {
    const e = new TemplateEnhancer()
    const strong = e.enhance({ rawTask: "make a landing page", capabilityLevel: 1 })
    const weak = e.enhance({ rawTask: "make a landing page", capabilityLevel: 6 })
    expect(weak.constraints.length).toBeGreaterThan(strong.constraints.length)
    expect(weak.constraints.some(c => c.includes("COMPLETE file"))).toBe(true)
})

test("generic tasks are left essentially untouched", () => {
    const spec = enhance({ rawTask: "refactor utils.ts", capabilityLevel: 1 })
    expect(spec.taskType).toBe("generic")
    expect(spec.deliverables).toHaveLength(0)
})

// ─── Scaffold → plan ──────────────────────────────────────────────────────────

test("web page scaffolds to a single index.html create step", () => {
    const spec = enhance({ rawTask: "make a nike landing page", capabilityLevel: 4 })
    const scaffold = scaffoldFor(spec, "/project")
    expect(scaffold).not.toBeNull()

    const plan = toPlan(scaffold!, 4)
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]!.changeType).toBe("create")
    expect(plan.steps[0]!.targetFiles[0]!.replace(/\\/g, "/")).toContain("index.html")
    expect(plan.steps[0]!.description).toContain("```html")
})

test("react component scaffolds to a single tsx component", () => {
    const spec = enhance({ rawTask: "build a reusable Button react component", capabilityLevel: 5 })
    const scaffold = scaffoldFor(spec, "/project")
    expect(scaffold).not.toBeNull()

    const plan = toPlan(scaffold!, 5)
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]!.targetFiles[0]!.replace(/\\/g, "/")).toContain("src/components/Button.tsx")
    expect(plan.steps[0]!.description).toContain("```tsx:src/components/Button.tsx")
    expect(plan.steps[0]!.description).toContain("Export `Button` as the default export")
})

test("cli script scaffolds to a single shell script", () => {
    const spec = enhance({ rawTask: "create a CLI script to resize images", capabilityLevel: 6 })
    const scaffold = scaffoldFor(spec, "/project")
    expect(scaffold).not.toBeNull()

    const plan = toPlan(scaffold!, 6)
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]!.targetFiles[0]!.replace(/\\/g, "/")).toContain("scripts/resize-images.sh")
    expect(plan.steps[0]!.description).toContain("```bash:scripts/resize-images.sh")
    expect(plan.steps[0]!.description).toContain("--help")
})

test("python script scaffolds to a single py script", () => {
    const spec = enhance({ rawTask: "write a python script to clean csv files", capabilityLevel: 6 })
    const scaffold = scaffoldFor(spec, "/project")
    expect(scaffold).not.toBeNull()

    const plan = toPlan(scaffold!, 6)
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]!.targetFiles[0]!.replace(/\\/g, "/")).toContain("scripts/clean_csv_files.py")
    expect(plan.steps[0]!.description).toContain("```python:scripts/clean_csv_files.py")
    expect(plan.steps[0]!.description).toContain("argparse")
})

test("non-scaffoldable task types return null", () => {
    const spec = enhance({ rawTask: "refactor the auth module", capabilityLevel: 3 })
    expect(scaffoldFor(spec, "/project")).toBeNull()
})
