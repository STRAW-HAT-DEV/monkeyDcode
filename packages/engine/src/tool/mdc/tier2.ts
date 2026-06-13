// @ts-nocheck
import { Schema } from "effect"
import { $ } from "bun"
import { existsSync } from "fs"
import { join } from "path"
import { mdcTool } from "./factory.ts"

const jobs = new Map<string, { cmd: string; proc: ReturnType<typeof $> | null; output: string }>()

export const RecipeTool = mdcTool(
    "recipe",
    "Invoke task runners: bun, make, just, cargo, npm based on project files.",
    { target: Schema.optional(Schema.String).pipe(Schema.annotate({ description: "Recipe target (default: default task)" })) },
    async (args, ctx) => {
        const root = ctx.directory
        const target = (args.target as string) ?? ""
        let cmd: string[] = []
        if (existsSync(join(root, "justfile"))) cmd = ["just", target].filter(Boolean)
        else if (existsSync(join(root, "Makefile"))) cmd = ["make", target].filter(Boolean)
        else if (existsSync(join(root, "Cargo.toml"))) cmd = ["cargo", target || "build"]
        else if (existsSync(join(root, "package.json"))) cmd = target ? ["bun", "run", target] : ["bun", "run", "build"]
        else return { title: "recipe", output: "No recognized task runner (just/make/cargo/npm) in project." }
        const proc = Bun.spawn({ cmd, cwd: root, stdout: "pipe", stderr: "pipe" })
        const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ])
        const exitCode = await proc.exited
        return { title: "recipe", output: stdout + stderr, metadata: { exitCode } }
    },
)

export const SshTool = mdcTool(
    "ssh",
    "Execute a command on a remote machine via SSH.",
    {
        host: Schema.String,
        command: Schema.String,
    },
    async (args) => {
        const r = await $`ssh ${args.host} ${args.command}`.quiet().nothrow()
        return { title: "ssh", output: r.stdout.toString() + r.stderr.toString(), metadata: { exitCode: r.exitCode } }
    },
)

export const EvalTool = mdcTool(
    "eval",
    "Run a Python or JavaScript REPL cell and return output.",
    {
        language: Schema.Literals(["python", "javascript"]),
        code: Schema.String,
    },
    async (args) => {
        const lang = args.language as string
        const code = args.code as string
        const r = lang === "python"
            ? await $`python -c ${code}`.quiet().nothrow()
            : await $`bun -e ${code}`.quiet().nothrow()
        return { title: "eval", output: r.stdout.toString() || r.stderr.toString(), metadata: { exitCode: r.exitCode } }
    },
)

export const JobTool = mdcTool(
    "job",
    "Background job management — start, stop, list, watch output.",
    {
        action: Schema.Literals(["start", "stop", "list", "watch"]),
        command: Schema.optional(Schema.String),
        jobId: Schema.optional(Schema.String),
    },
    async (args, ctx) => {
        const action = args.action as string
        if (action === "list") {
            return { title: "jobs", output: [...jobs.keys()].join("\n") || "No jobs" }
        }
        if (action === "start" && args.command) {
            const id = `job-${Date.now()}`
            const proc = $`${args.command}`.cwd(ctx.directory).quiet().nothrow()
            jobs.set(id, { cmd: args.command as string, proc, output: "" })
            return { title: "job started", output: id, metadata: { jobId: id } }
        }
        if (action === "stop" && args.jobId) {
            jobs.delete(args.jobId as string)
            return { title: "job stopped", output: String(args.jobId) }
        }
        if (action === "watch" && args.jobId) {
            const j = jobs.get(args.jobId as string)
            return { title: "job output", output: j?.output ?? "Job not found" }
        }
        return { title: "job", output: "Invalid job action or missing parameters." }
    },
)

export const CalcTool = mdcTool(
    "calc",
    "Deterministic arithmetic — never trust the LLM for maths.",
    { expression: Schema.String },
    async (args) => {
        const expr = String(args.expression).replace(/[^0-9+\-*/().%\s]/g, "")
        if (!expr.trim()) return { title: "calc", output: "Invalid expression" }
        try {
            const value = Function(`"use strict"; return (${expr})`)()
            return { title: "calc", output: String(value) }
        } catch (e) {
            return { title: "calc", output: e instanceof Error ? e.message : "Evaluation failed" }
        }
    },
)
