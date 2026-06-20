#!/usr/bin/env bun
/**
 * Compare A/B benchmark results (with vs without consistency engine).
 *
 * Usage:
 *   bun run benchmarks/compare.ts
 *   bun run benchmarks/compare.ts benchmarks/results/2026-01-01-with-consistency.json benchmarks/results/2026-01-01-baseline.json
 */
import { readdir, readFile } from "fs/promises"
import { join } from "path"
import { distance } from "fastest-levenshtein"

interface BenchmarkResult {
    model: string
    modelLabel: string
    task: string
    passed: boolean
    verificationScore: number
    outputCode: string
}

async function loadLatest(mode: "with-consistency" | "baseline"): Promise<BenchmarkResult[]> {
    const dir = join(import.meta.dir, "results")
    const files = (await readdir(dir)).filter(f => f.endsWith(`-${mode}.json`)).sort()
    const latest = files.at(-1)
    if (!latest) throw new Error(`No ${mode} results in benchmarks/results/`)
    return JSON.parse(await readFile(join(dir, latest), "utf-8")) as BenchmarkResult[]
}

async function main() {
    const withPath = process.argv[2]
    const withoutPath = process.argv[3]

    const withResults: BenchmarkResult[] = withPath
        ? JSON.parse(await readFile(withPath, "utf-8"))
        : await loadLatest("with-consistency")

    const withoutResults: BenchmarkResult[] = withoutPath
        ? JSON.parse(await readFile(withoutPath, "utf-8"))
        : await loadLatest("baseline")

    const models = [...new Set(withResults.map(r => r.model))]

    console.log("\n# monkeyDcode A/B Comparison\n")
    console.log("| Model | With | Without | Delta |")
    console.log("|-------|------|---------|-------|")

    for (const model of models) {
        const w = withResults.filter(r => r.model === model)
        const wo = withoutResults.filter(r => r.model === model)
        const wPct = w.length ? (w.filter(r => r.passed).length / w.length) * 100 : 0
        const woPct = wo.length ? (wo.filter(r => r.passed).length / wo.length) * 100 : 0
        const delta = wPct - woPct
        const label = w[0]?.modelLabel ?? model
        console.log(`| ${label} | ${wPct.toFixed(0)}% | ${woPct.toFixed(0)}% | ${delta >= 0 ? "+" : ""}${delta.toFixed(0)}pp |`)
    }

    // Qwen 7B target check
    const qwen7 = withResults.filter(r => r.model.includes("7b"))
    if (qwen7.length) {
        const rate = qwen7.filter(r => r.passed).length / qwen7.length
        console.log(`\nQwen 7B pass rate: ${(rate * 100).toFixed(0)}% (target ≥70%)`)
    }

    // Pairwise consistency Qwen 7B vs Opus
    const tasks = [...new Set(withResults.map(r => r.task))]
    let simSum = 0
    let simCount = 0
    for (const task of tasks) {
        const q7 = withResults.find(r => r.task === task && r.model.includes("7b") && r.passed)
        const opus = withResults.find(r => r.task === task && r.model.includes("opus") && r.passed)
        if (q7?.outputCode && opus?.outputCode) {
            const maxLen = Math.max(q7.outputCode.length, opus.outputCode.length, 1)
            simSum += 1 - distance(q7.outputCode, opus.outputCode) / maxLen
            simCount++
        }
    }
    if (simCount) {
        console.log(`Qwen 7B vs Opus similarity: ${((simSum / simCount) * 100).toFixed(1)}% (target ≥60%)`)
    }

    const report = join(import.meta.dir, "results", "ab-comparison.md")
    await Bun.write(report, `# A/B Comparison\n\nGenerated ${new Date().toISOString()}\n`)
    console.log(`\nReport appended: ${report}`)
}

main().catch(console.error)
