#!/usr/bin/env bun
/**
 * monkeyDcode Benchmark Runner
 *
 * Usage:
 *   bun run benchmarks/run.ts                    # all tasks, all available models
 *   bun run benchmarks/run.ts --task 01          # single task
 *   bun run benchmarks/run.ts --model qwen7b     # single model
 *   MDCODE_NO_CONSISTENCY=1 bun run benchmarks/run.ts   # baseline: one-shot WITH prompt engineering, no sampling/voting
 *   MDCODE_RAW=1 bun run benchmarks/run.ts              # raw: one-shot with NO engineering — what a user gets pasting into a bare chat
 *
 * Three arms, three different questions:
 *   consistency (default) — does the full agent (this project) help?
 *   baseline               — does multi-candidate sampling/voting help, holding prompt engineering constant?
 *   raw                    — the floor: same model, zero scaffolding. This is what "agent vs raw" is actually measured against.
 *
 * Headline metric: pass-rate uplift = consistency_pass_rate - raw_pass_rate, per model, per task.
 * That number is the entire "does the agent help" claim — track it every run.
 *
 * Results are written to benchmarks/results/<timestamp>.json
 */

import { readdir, mkdir, rm, cp, readFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import * as Pipeline from "../packages/consistency/src/verification/pipeline.ts"
import { distance } from "fastest-levenshtein"

async function runEffect<A>(program: import("effect").Effect.Effect<A, unknown, never>): Promise<A> {
    const { Effect } = await import("effect")
    return Effect.runPromise(program)
}

type ModelEntry = {
    id: string
    ref: { provider: string; id: string }
    label: string
    provider: string
}

async function loadModels(): Promise<ModelEntry[]> {
    const { ollama } = await import("../packages/llm/src/providers/ollama.ts")
    const { anthropic } = await import("../packages/llm/src/providers/anthropic.ts")
    return [
        { id: "qwen2.5-coder:7b",  ref: ollama.model("qwen2.5-coder:7b"),  label: "Qwen 7B (local)",  provider: "ollama" },
        { id: "qwen2.5-coder:14b", ref: ollama.model("qwen2.5-coder:14b"), label: "Qwen 14B (local)", provider: "ollama" },
        { id: "qwen2.5-coder:32b", ref: ollama.model("qwen2.5-coder:32b"), label: "Qwen 32B (local)", provider: "ollama" },
        { id: "claude-sonnet-4-6", ref: anthropic.model("claude-sonnet-4-6"), label: "Claude Sonnet", provider: "anthropic" },
        { id: "claude-opus-4-8",   ref: anthropic.model("claude-opus-4-8"),   label: "Claude Opus",   provider: "anthropic" },
    ]
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TASKS_DIR   = join(import.meta.dir, "tasks")
const RESULTS_DIR = join(import.meta.dir, "results")
const WORK_DIR    = join(tmpdir(), "mdc-bench-work")

type Mode = "consistency" | "baseline" | "raw"

const MODE: Mode = process.env.MDCODE_RAW === "1"
    ? "raw"
    : process.env.MDCODE_NO_CONSISTENCY === "1"
        ? "baseline"
        : "consistency"

const VERIFY_ONLY = process.argv.includes("--verify-only")
const TASK_FILTER  = process.argv.find((_, i) => process.argv[i - 1] === "--task")
const MODEL_FILTER = process.argv.find((_, i) => process.argv[i - 1] === "--model")

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
    model:             string
    modelLabel:        string
    task:              string
    passed:            boolean
    verificationScore: number
    durationMs:        number
    outputCode:        string
    error?:            string
    consistencyMode:   Mode
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    await mkdir(RESULTS_DIR, { recursive: true })

    const allTaskDirs = (await readdir(TASKS_DIR)).sort()
    const taskDirs = TASK_FILTER
        ? allTaskDirs.filter(t => t.startsWith(TASK_FILTER))
        : allTaskDirs

    const ALL_MODELS = await loadModels()

    // Only test models that are reachable
    const models = await filterReachableModels(ALL_MODELS)
    const filteredModels = MODEL_FILTER
        ? models.filter(m => m.id.includes(MODEL_FILTER) || m.label.toLowerCase().includes(MODEL_FILTER))
        : models

    if (filteredModels.length === 0 && !VERIFY_ONLY) {
        console.error("No reachable models found. Make sure Ollama is running or ANTHROPIC_API_KEY is set.")
        console.error("Tip: run with --verify-only to test expected solutions without LLM.")
        process.exit(1)
    }

    if (VERIFY_ONLY) {
        console.log("\n🔬 Verify-only mode (no LLM — tests expected/ solutions)\n")
        const verifyResults = await runVerifyOnly(taskDirs)
        await saveResults(verifyResults)
        printSummary(verifyResults)
        await generateReport(verifyResults)
        return
    }

    console.log(`\n🏴‍☠️  monkeyDcode Benchmark`)
    console.log(`   Mode: ${MODE}`)
    console.log(`   Tasks:  ${taskDirs.length}`)
    console.log(`   Models: ${filteredModels.map(m => m.label).join(", ")}`)
    console.log(`   Total runs: ${taskDirs.length * filteredModels.length}\n`)

    const results: BenchmarkResult[] = []

    for (const taskDir of taskDirs) {
        const taskPath = join(TASKS_DIR, taskDir)
        const taskDesc = await Bun.file(join(taskPath, "task.md")).text()

        console.log(`\n📋 Task: ${taskDir}`)

        for (const model of filteredModels) {
            process.stdout.write(`   ${model.label}... `)
            const start = Date.now()

            try {
                // Reset work dir to starter code
                await rm(WORK_DIR, { recursive: true, force: true })
                await cp(join(taskPath, "starter"), WORK_DIR, { recursive: true })

                // Run the agent
                const outputCode = MODE === "consistency"
                    ? await runWithConsistency(taskDesc, WORK_DIR, model.ref, model.id)
                    : MODE === "baseline"
                        ? await runBaseline(taskDesc, WORK_DIR, model.ref)
                        : await runRaw(taskDesc, WORK_DIR, model.ref)

                // Copy expected tests in
                await cp(join(taskPath, "expected"), WORK_DIR, { recursive: true })

                // Verify
                const srcFiles = await collectSourceFiles(WORK_DIR)
                const verification = await Pipeline.run(srcFiles, WORK_DIR)

                results.push({
                    model:             model.id,
                    modelLabel:        model.label,
                    task:              taskDir,
                    passed:            verification.passed,
                    verificationScore: verification.score,
                    durationMs:        Date.now() - start,
                    outputCode,
                    consistencyMode:   MODE,
                })

                console.log(verification.passed ? "✅ PASS" : `❌ FAIL (score: ${(verification.score * 100).toFixed(0)}%)`)
            } catch (e) {
                results.push({
                    model:             model.id,
                    modelLabel:        model.label,
                    task:              taskDir,
                    passed:            false,
                    verificationScore: 0,
                    durationMs:        Date.now() - start,
                    outputCode:        "",
                    error:             e instanceof Error ? e.message : String(e),
                    consistencyMode:   MODE,
                })
                console.log(`💥 ERROR: ${e instanceof Error ? e.message.slice(0, 60) : e}`)
            }
        }
    }

    await saveResults(results)
    printSummary(results)
    await generateReport(results)
    checkSuccessCriteria(results)
}

/** Verify expected solutions pass pipeline — no LLM required. */
async function runVerifyOnly(taskDirs: string[]): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = []
    for (const taskDir of taskDirs) {
        const taskPath = join(TASKS_DIR, taskDir)
        const start = Date.now()
        await rm(WORK_DIR, { recursive: true, force: true })
        await cp(join(taskPath, "starter"), WORK_DIR, { recursive: true })
        await cp(join(taskPath, "expected"), WORK_DIR, { recursive: true })
        const srcFiles = await collectSourceFiles(WORK_DIR)
        const verification = await Pipeline.run(srcFiles, WORK_DIR)
        results.push({
            model:             "verify-only",
            modelLabel:        "Expected solutions",
            task:              taskDir,
            passed:            verification.passed,
            verificationScore: verification.score,
            durationMs:        Date.now() - start,
            outputCode:        "",
            consistencyMode:   "consistency",
        })
        console.log(`  ${taskDir}: ${verification.passed ? "✅" : "❌"}`)
    }
    return results
}

// ─── Agent runners ────────────────────────────────────────────────────────────

async function runWithConsistency(
    task: string,
    workDir: string,
    model: ModelEntry["ref"],
    modelId: string,
): Promise<string> {
    const { handle: orchestrate } = await import("../packages/agent/src/orchestrator.ts")
    const orig = process.cwd()
    try {
        process.chdir(workDir)
        await runEffect(orchestrate(task, model, modelId))
        return await readGeneratedCode(workDir)
    } finally {
        process.chdir(orig)
    }
}

async function runBaseline(
    task: string,
    workDir: string,
    model: ModelEntry["ref"],
): Promise<string> {
    const { LLM } = await import("../packages/llm/src/llm.ts")
    const { applyChange } = await import("../packages/agent/src/build-agent.ts")
    const srcFiles = await collectSourceFiles(workDir)
    const prompt = await buildPrompt(task, srcFiles, workDir)

    const response = await LLM.generateAsync({
        model,
        messages: [{ role: "user", content: prompt }],
    })

    await runEffect(applyChange(response.text, srcFiles))
    return response.text
}

/**
 * The floor: same model, same starter files, but NO engineering at all — no
 * output-format contract, no "implement the solution" framing, no explicit
 * file-fence instructions. This is what a user gets pasting the files and the
 * task into a bare chat window. `runBaseline` above already has real prompt
 * engineering (explicit output contract); this is deliberately more naive so
 * the three arms measure three different things: does the full agent help
 * (consistency vs raw), and does sampling/voting alone help holding prompt
 * engineering constant (baseline vs raw). Extraction is intentionally lenient
 * since we didn't ask for a specific format.
 */
async function runRaw(
    task: string,
    workDir: string,
    model: ModelEntry["ref"],
): Promise<string> {
    const { LLM } = await import("../packages/llm/src/llm.ts")
    const { applyChange } = await import("../packages/agent/src/build-agent.ts")
    const srcFiles = await collectSourceFiles(workDir)

    const fileContents = await Promise.all(srcFiles.map(async f => {
        try {
            return await readFile(f, "utf-8")
        } catch {
            return ""
        }
    }))
    const rawPrompt = `${fileContents.filter(Boolean).join("\n\n")}\n\n${task}`

    const response = await LLM.generateAsync({
        model,
        messages: [{ role: "user", content: rawPrompt }],
    })

    await runEffect(applyChange(response.text, srcFiles))
    return response.text
}

async function readGeneratedCode(workDir: string): Promise<string> {
    const files = await collectSourceFiles(workDir)
    const parts: string[] = []
    for (const f of files) {
        parts.push(await readFile(f, "utf-8"))
    }
    return parts.join("\n")
}

async function buildPrompt(task: string, files: string[], workDir: string): Promise<string> {
    const fileContents = await Promise.all(files.map(async f => {
        try {
            const text = await readFile(f, "utf-8")
            return `// ${f.replace(workDir, "")}\n${text}`
        } catch { return "" }
    }))

    return `${fileContents.filter(Boolean).join("\n\n")}

## Task
${task}

## Instructions
Implement the solution. Output ONLY the complete modified file(s) using this format:

\`\`\`typescript:path/to/file.ts
// complete file contents
\`\`\`

Output the modified files now:`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function collectSourceFiles(dir: string): Promise<string[]> {
    const glob = new Bun.Glob("src/**/*.{ts,tsx,js}")
    const files: string[] = []
    for await (const f of glob.scan({ cwd: dir, absolute: true })) {
        files.push(f)
    }
    return files
}

async function filterReachableModels(models: ModelEntry[]) {
    const reachable: ModelEntry[] = []
    for (const m of models) {
        if (m.provider === "ollama") {
            try {
                const r = await fetch("http://localhost:11434/api/tags").catch(() => null)
                if (r?.ok) {
                    const tags = await r.json() as { models: Array<{ name: string }> }
                    if (tags.models.some(t => t.name.startsWith(m.id.split(":")[0]!))) {
                        reachable.push(m)
                    }
                }
            } catch {}
        } else if (m.provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
            reachable.push(m)
        }
    }
    return reachable
}

async function saveResults(results: BenchmarkResult[]) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    const path = join(RESULTS_DIR, `${ts}-${MODE}.json`)
    await Bun.write(path, JSON.stringify(results, null, 2))
    console.log(`\n💾 Results saved: ${path}`)
}

// ─── Summary printer ──────────────────────────────────────────────────────────

function printSummary(results: BenchmarkResult[]) {
    const models = [...new Set(results.map(r => r.model))]
    const tasks  = [...new Set(results.map(r => r.task))]

    console.log("\n" + "═".repeat(70))
    console.log(`🏴‍☠️  RESULTS (mode: ${MODE})`)
    console.log("═".repeat(70))

    console.log("\n📊 Pass Rates by Model:\n")
    for (const model of models) {
        const modelResults = results.filter(r => r.model === model)
        const passed = modelResults.filter(r => r.passed).length
        const pct = ((passed / modelResults.length) * 100).toFixed(0)
        const avgScore = (modelResults.reduce((s, r) => s + r.verificationScore, 0) / modelResults.length * 100).toFixed(0)
        const avgMs = Math.round(modelResults.reduce((s, r) => s + r.durationMs, 0) / modelResults.length / 1000)
        const label = modelResults[0]?.modelLabel ?? model
        console.log(`  ${label.padEnd(20)} ${pct.padStart(4)}% pass   avg score ${avgScore}%   avg ${avgMs}s/task`)
    }

    if (models.length > 1) {
        console.log("\n🔀 Pairwise Consistency (passing results only):\n")
        const consistency = computePairwiseConsistency(results)
        for (const [pair, sim] of Object.entries(consistency)) {
            console.log(`  ${pair.padEnd(40)} ${(sim * 100).toFixed(1)}% similar`)
        }
    }

    console.log("\n📋 Task Breakdown:\n")
    for (const task of tasks) {
        const taskResults = results.filter(r => r.task === task)
        const passed = taskResults.filter(r => r.passed).length
        const icon = passed === taskResults.length ? "✅" : passed === 0 ? "❌" : "⚠️ "
        console.log(`  ${icon} ${task}  (${passed}/${taskResults.length} models passed)`)
    }

    const total = results.length
    const totalPassed = results.filter(r => r.passed).length
    console.log(`\n${"═".repeat(70)}`)
    console.log(`   Overall: ${totalPassed}/${total} (${((totalPassed / total) * 100).toFixed(0)}%)`)
    console.log("═".repeat(70) + "\n")
}

function computePairwiseConsistency(results: BenchmarkResult[]): Record<string, number> {
    const tasks  = [...new Set(results.map(r => r.task))]
    const models = [...new Set(results.map(r => r.model))]
    const byPair: Record<string, { sum: number; count: number }> = {}

    for (const task of tasks) {
        const passing = results.filter(r => r.task === task && r.passed && r.outputCode.length > 0)
        for (let i = 0; i < passing.length; i++) {
            for (let j = i + 1; j < passing.length; j++) {
                const a = passing[i]!
                const b = passing[j]!
                const maxLen = Math.max(a.outputCode.length, b.outputCode.length, 1)
                const sim = 1 - distance(a.outputCode, b.outputCode) / maxLen
                const key = `${a.modelLabel} vs ${b.modelLabel}`
                if (!byPair[key]) byPair[key] = { sum: 0, count: 0 }
                byPair[key]!.sum += sim
                byPair[key]!.count++
            }
        }
    }

    return Object.fromEntries(
        Object.entries(byPair)
            .filter(([, v]) => v.count > 0)
            .map(([k, v]) => [k, v.sum / v.count])
    )
}

function passRateByModel(results: BenchmarkResult[]): Map<string, number> {
    const models = [...new Set(results.map(r => r.model))]
    const out = new Map<string, number>()
    for (const model of models) {
        const mr = results.filter(r => r.model === model)
        out.set(model, mr.filter(r => r.passed).length / mr.length)
    }
    return out
}

/** Load the most recent raw-mode results file, if one exists, to compute the
 *  headline "does the agent actually help" number. Best-effort: a missing or
 *  unreadable baseline just means the uplift section is skipped, not a
 *  reason to fail the whole report. */
async function loadMostRecentRawResults(): Promise<BenchmarkResult[] | null> {
    try {
        const files = (await readdir(RESULTS_DIR))
            .filter(f => f.endsWith("-raw.json"))
            .sort()
        const latest = files.at(-1)
        if (!latest) return null
        const raw = await Bun.file(join(RESULTS_DIR, latest)).json()
        return raw as BenchmarkResult[]
    } catch {
        return null
    }
}

async function generateReport(results: BenchmarkResult[]) {
    const models = [...new Set(results.map(r => r.model))]
    const lines = [
        "# monkeyDcode Benchmark Results",
        "",
        `Generated: ${new Date().toISOString()}`,
        `Mode: ${MODE}`,
        "",
        "## Pass Rates",
        "",
        "| Model | Pass Rate | Avg Score |",
        "|-------|-----------|-----------|",
    ]

    for (const model of models) {
        const mr = results.filter(r => r.model === model)
        const passed = mr.filter(r => r.passed).length
        const pct = ((passed / mr.length) * 100).toFixed(0)
        const avg = (mr.reduce((s, r) => s + r.verificationScore, 0) / mr.length * 100).toFixed(0)
        lines.push(`| ${mr[0]?.modelLabel ?? model} | ${pct}% | ${avg}% |`)
    }

    // The headline metric: pass-rate uplift = this run's pass rate − raw pass
    // rate, per model. This is the entire "agent beats raw prompting" claim —
    // every other number in this report is supporting detail.
    if (MODE !== "raw") {
        const rawResults = await loadMostRecentRawResults()
        if (rawResults) {
            const rawRates = passRateByModel(rawResults)
            const thisRates = passRateByModel(results)
            lines.push("", `## Pass-Rate Uplift vs Raw (${MODE} − raw)`, "", "| Model | This Run | Raw | Uplift |", "|-------|----------|-----|--------|")
            for (const model of models) {
                const thisRate = thisRates.get(model)
                const rawRate = rawRates.get(model)
                if (thisRate === undefined || rawRate === undefined) continue
                const uplift = thisRate - rawRate
                const label = results.find(r => r.model === model)?.modelLabel ?? model
                const sign = uplift >= 0 ? "+" : ""
                lines.push(`| ${label} | ${(thisRate * 100).toFixed(0)}% | ${(rawRate * 100).toFixed(0)}% | ${sign}${(uplift * 100).toFixed(0)}pp |`)
            }
        } else {
            lines.push("", "## Pass-Rate Uplift vs Raw", "", "_No raw-mode results found yet — run `bun run bench:raw` to establish the baseline this number needs._")
        }
    }

    lines.push("", "## Pairwise Consistency", "")
    const pairs = computePairwiseConsistency(results)
    for (const [pair, sim] of Object.entries(pairs)) {
        lines.push(`- ${pair}: ${(sim * 100).toFixed(1)}%`)
    }

    const reportPath = join(RESULTS_DIR, "report.md")
    await Bun.write(reportPath, lines.join("\n"))
    console.log(`📄 Report: ${reportPath}`)
}

function checkSuccessCriteria(results: BenchmarkResult[]) {
    const qwen7 = results.filter(r => r.model.includes("7b"))
    if (qwen7.length === 0) return

    const passRate = qwen7.filter(r => r.passed).length / qwen7.length
    console.log(`\n🎯 Qwen 7B pass rate: ${(passRate * 100).toFixed(0)}% (target: ≥70%)`)
    if (passRate >= 0.7) console.log("   ✅ Meets weak-model target")
    else console.log("   ⚠️  Below weak-model target")
}

main().catch(console.error)
