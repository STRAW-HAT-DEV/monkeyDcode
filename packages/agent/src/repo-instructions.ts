// Repo-level instruction files (AGENTS.md / CLAUDE.md) — GAPS.md Part 2, C4.
//
// packages/engine already has a full implementation of this (session/instruction.ts),
// but it's built on opencode's Config/Global/RuntimeFlags/HttpClient Effect service
// graph — the same reason packages/agent doesn't use engine's MCP client or tool
// registry (see tool-loop.ts's header, mcp-context.ts). This is the lightweight
// equivalent: a plain file read, no service layer, usable directly from
// orchestrator.ts's existing Effect.gen flow.
//
// Precedence matches engine's own convention: AGENTS.md first, CLAUDE.md as a
// fallback (the more established, widely-recognized convention), then the
// deprecated CONTEXT.md name. Only the project root is checked — this project's
// own CLAUDE.md lives there, and that's the overwhelmingly common placement.

import { readFile } from "fs/promises"
import { join } from "path"

const CANDIDATE_FILES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"]
const MAX_CHARS = 8_000

/** Reads the first repo-instruction file found in `projectRoot`, truncated to
 *  a bounded size (an instruction file is meant to be a short brief, not the
 *  whole prompt budget). Returns "" if none exists — never throws, since a
 *  missing or unreadable instruction file must degrade to "no instructions,"
 *  not fail the task. */
export async function loadRepoInstructions(projectRoot: string): Promise<string> {
    for (const name of CANDIDATE_FILES) {
        try {
            const content = await readFile(join(projectRoot, name), "utf-8")
            const trimmed = content.trim()
            if (trimmed.length === 0) continue
            const truncated = trimmed.length > MAX_CHARS
                ? trimmed.slice(0, MAX_CHARS) + "\n… (truncated)"
                : trimmed
            return `## Project Instructions (${name})\n${truncated}`
        } catch {
            continue
        }
    }
    return ""
}
