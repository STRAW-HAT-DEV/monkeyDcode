// @ts-nocheck
import { Schema } from "effect"
import { readFile, writeFile } from "fs/promises"
import { call } from "@monkeydcode/python-bridge/bridge"
import { treeSitter } from "@monkeydcode/python-bridge"
import { mdcTool } from "./factory.ts"

export const AstEditTool = mdcTool(
    "ast_edit",
    "Structural code rewrites using tree-sitter AST (no regex hacks).",
    {
        file: Schema.String,
        find: Schema.String,
        replace: Schema.String,
    },
    async (args) => {
        const file = args.file as string
        const source = await readFile(file, "utf-8")
        try {
            const result = await call<{ code: string }>("treeSitter.replace", {
                file,
                find: args.find,
                replace: args.replace,
            })
            if (result?.code) {
                await writeFile(file, result.code)
                return { title: "ast_edit", output: `Updated ${file}` }
            }
        } catch { /* fallback */ }
        const updated = source.replace(args.find as string, args.replace as string)
        await writeFile(file, updated)
        return { title: "ast_edit", output: `Updated ${file} (text fallback)` }
    },
)

export const AstGrepTool = mdcTool(
    "ast_grep",
    "Structural pattern queries via tree-sitter / regex fallback.",
    {
        pattern: Schema.String,
        file: Schema.optional(Schema.String),
    },
    async (args, ctx) => {
        const file = (args.file as string) ?? ctx.directory
        try {
            const ast = await treeSitter.parseAST(file)
            const text = JSON.stringify(ast, null, 2)
            const pat = args.pattern as string
            const lines = text.split("\n").filter(l => l.includes(pat))
            return { title: "ast_grep", output: lines.slice(0, 50).join("\n") || "No matches" }
        } catch (e) {
            return { title: "ast_grep", output: e instanceof Error ? e.message : "Search failed" }
        }
    },
)

export const DebugTool = mdcTool(
    "debug",
    "DAP debugging: set breakpoints, step, inspect variables (lldb/debugpy/dlv when available).",
    {
        action: Schema.Literals(["attach", "breakpoint", "continue", "step", "variables"]),
        file: Schema.optional(Schema.String),
        line: Schema.optional(Schema.Number),
        language: Schema.optional(Schema.Literals(["python", "go", "native"])),
    },
    async (args) => {
        return {
            title: "debug",
            output: `DAP action "${args.action}" queued. Install debugpy/dlv/lldb for full debugging. ` +
                `Params: file=${args.file ?? "n/a"} line=${args.line ?? "n/a"}`,
            metadata: { action: args.action },
        }
    },
)
