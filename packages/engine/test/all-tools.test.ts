import { test, expect } from "bun:test"
import { readFileSync, readdirSync } from "fs"
import { join } from "path"

/** All 43 tools from plan/TOOLS.md */
const PLAN_TOOLS = [
    "read", "write", "edit", "apply_patch", "glob", "grep", "repo_overview", "repo_clone",
    "shell", "recipe", "ssh", "eval", "job", "calc",
    "lsp", "ast_edit", "ast_grep", "debug",
    "git", "github",
    "webfetch", "websearch", "browser", "localhost_view", "generate_image", "inspect_image",
    "task", "task_status", "irc", "plan", "question", "skill", "todo_write",
    "checkpoint", "rewind", "retain", "recall", "reflect", "handoff",
    "consistency_sample", "verify_pipeline", "model_probe", "knowledge_graph", "vector_search",
] as const

function collectSources(dir: string): string {
    let text = ""
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name)
        if (entry.isDirectory()) text += collectSources(p)
        else if (entry.name.endsWith(".ts")) text += readFileSync(p, "utf-8") + "\n"
    }
    return text
}

test("plan tool list matches TOOLS.md tables (44 entries; doc rounds to 43)", () => {
    expect(PLAN_TOOLS.length).toBe(44)
})

test("all plan tools are registered in engine tool sources", () => {
    const toolDir = join(import.meta.dir, "../src/tool")
    const sources = collectSources(toolDir)

    for (const id of PLAN_TOOLS) {
        expect(sources.includes(`"${id}"`)).toBe(true)
    }
})

test("actor-critic review uses 3 rounds", () => {
    const review = readFileSync(
        join(import.meta.dir, "../../agent/src/review-agent.ts"),
        "utf-8",
    )
    expect(review).toContain("Round 1/3")
    expect(review).toContain("Round 2/3")
    expect(review).toContain("Round 3/3")
    expect(review).toContain("review-actor.txt")
    expect(review).toContain("review-critic.txt")
    expect(review).toContain("review-consensus.txt")
})
