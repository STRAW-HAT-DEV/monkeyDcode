#!/usr/bin/env bun
/**
 * monkeyDcode Benchmark Runner
 *
 * Usage:
 *   bun run benchmarks/run.ts                    # all tasks, all available models
 *   bun run benchmarks/run.ts --task 01          # single task
 *   bun run benchmarks/run.ts --model qwen7b     # single model
 *   MDCODE_NO_CONSISTENCY=1 bun run benchmarks/run.ts   # A/B: disable consistency engine
 *
 * Results are written to benchmarks/results/<timestamp>.json
 */

import { readdir, mkdir, rm, cp } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { $ } from "bun"
import { ollama } from "@monkeydcode/llm/providers/ollama"
import { anthropic } from "@monkeydcode/llm/providers/anthropic"
import * as Pipeline from "@monkeydcode/consistency/verification/pipeline"
import { LLM } from "@monkeydcode/llm"
import { applyChange } from "@monkeydcode/agent/build-agent"
import { Effect } from "effect"
import { distance } from "fastest-levenshtein"

// ─── Model registry ───────────────────────────────────────────────────────────

const ALL_MODELS = [
    { id: "qwen2.5-coder:7b",  ref: ollama.model("qwen2.5-coder:7b"),  label: "Qwen 7B (local)",  provider: "ollama" },
    { id: "qwen2.5-coder:14b", ref: ollama.model("qwen2.5-coder:14b"), label: "Qwen 14B (local)", provider: "ollama" },
    { id: "qwen2.5-coder:32b", ref: ollama.model("qwen2.5-coder:32b"), label: "Qwen 32B (local)", provider: "ollama" },
    { id: "claude-sonnet-4-6", ref: anthropic.model("claude-sonnet-4-6"), label: "Claude Sonnet", provider: "anthropic" },
    { id: "claude-opus-4-8",   ref: anthropic.model("claude-opus-4-8"),   label: "Claude Opus",   provider: "anthropic" },
]

// ─── Config ───────────────────────────────────────────────────────────────────

const TASKS_DIR   = join(import.meta.dir, "tasks")
const RESULTS_DIR = join(import.meta.dir, "results")
const WORK_DIR    = "/tmp/mdc-bench-work"

const CONSISTENCY_ENABLED = process.env.MDCODE_NO_CONSISTENCY !== "1"
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
    consistencyMode:   "on" | "off"
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    await mkdir(RESULTS_DIR, { recursive: true })

    const allTaskDirs = (await readdir(TASKS_DIR)).sort()
    const taskDirs = TASK_FILTER
        ? allTaskDirs.filter(t => t.startsWith(TASK_FILTER))
        : allTaskDirs

    // Only test models that are reachable
    const models = await filterReachableModels(ALL_MODELS)
    const filteredModels = MODEL_FILTER
        ? models.filter(m => m.id.includes(MODEL_FILTER) || m.label.toLowerCase().includes(MODEL_FILTER))
        : models

    if (filteredModels.length === 0) {
        console.error("No reachable models found. Make sure Ollama is running or ANTHROPIC_API_KEY is set.")
        process.exit(1)
    }

    console.log(`\n🏴‍☠️  monkeyDcode Benchmark`)
    console.log(`   Consistency engine: ${CONSISTENCY_ENABLED ? "ON" : "OFF (A/B mode)"}`)
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
                const outputCode = CONSISTENCY_ENABLED
                    ? await runWithConsistency(taskDesc, WORK_DIR, model.ref, model.id)
                    : await runBaseline(taskDesc, WORK_DIR, model.ref)

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
                    consistencyMode:   CONSISTENCY_ENABLED ? "on" : "off",
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
                    consistencyMode:   CONSISTENCY_ENABLED ? "on" : "off",
                })
                console.log(`💥 ERROR: ${e instanceof Error ? e.message.slice(0, 60) : e}`)
            }
        }
    }

    await saveResults(results)
    printSummary(results)
}

// ─── Agent runners ────────────────────────────────────────────────────────────

async function runWithConsistency(
    task: string,
    workDir: string,
    model: ReturnType<typeof ollama.model>,
    modelId: string,
): Promise<string> {
    const { sample } = await import("@monkeydcode/consistency/sampler")
    const srcFiles = await collectSourceFiles(workDir)

    const prompt = buildPrompt(task, srcFiles, workDir)
    const result = await Effect.runPromise(
        sample({ prompt, files: srcFiles, model, modelId })
    )

    await Effect.runPromise(applyChange(result.selected.change, srcFiles))
    return result.selected.change
}

async function runBaseline(
    task: string,
    workDir: string,
    model: ReturnType<typeof ollama.model>,
): Promise<string> {
    const srcFiles = await collectSourceFiles(workDir)
    const prompt = buildPrompt(task, srcFiles, workDir)

    const response = await LLM.generateAsync({
        model,
        messages: [{ role: "user", content: prompt }],
    })

    await Effect.runPromise(applyChange(response.text, srcFiles))
    return response.text
}

function buildPrompt(task: string, files: string[], workDir: string): string {
    const fileContents = files.map(f => {
        try { return `// ${f.replace(workDir, "")}\n${Bun.file(f).toString()}` } catch { return "" }
    }).filter(Boolean).join("\n\n")

    return `${fileContents}

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

async function filterReachableModels(models: typeof ALL_MODELS) {
    const reachable: typeof ALL_MODELS = []
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
    const mode = CONSISTENCY_ENABLED ? "with-consistency" : "baseline"
    const path = join(RESULTS_DIR, `${ts}-${mode}.json`)
    await Bun.write(path, JSON.stringify(results, null, 2))
    console.log(`\n💾 Results saved: ${path}`)
}

// ─── Summary printer ──────────────────────────────────────────────────────────

function printSummary(results: BenchmarkResult[]) {
    const models = [...new Set(results.map(r => r.model))]
    const tasks  = [...new Set(results.map(r => r.task))]

    console.log("\n" + "═".repeat(70))
    console.log(`🏴‍☠️  RESULTS (consistency: ${CONSISTENCY_ENABLED ? "ON" : "OFF"})`)
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

main().catch(console.error)
