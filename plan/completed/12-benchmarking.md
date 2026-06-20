# Step 12: Benchmarking — Prove Consistency Across Model Sizes

**Goal:** Quantitatively prove monkeyDcode produces consistent output across LLM sizes. This is the entire point.

**Prerequisites:** Steps 1-11 complete.

---

## 12.1 Benchmark task suite

Create `benchmarks/tasks/` with 10 representative coding tasks. Each task is a directory with:
- `task.md` — description
- `starter/` — initial codebase
- `expected/` — tests proving success

Example `benchmarks/tasks/01-add-pagination/`:
```
task.md            -> "Add pagination to the getUsers function"
starter/
  src/users.ts
  src/users.test.ts
expected/
  test/pagination.test.ts
```

Suggested 10 tasks:
1. Add pagination to a list endpoint
2. Fix an off-by-one bug
3. Refactor a class to composition
4. Add error handling to async functions
5. Implement a debounce utility
6. Add input validation
7. Cache an expensive computation
8. Convert callbacks to async/await
9. Add TypeScript types to a JS file
10. Implement binary search

## 12.2 Benchmark runner

`benchmarks/run.ts`:
```typescript
import { Effect } from "effect"
import { Orchestrator } from "@monkeydcode/agent"
import { Pipeline } from "@monkeydcode/consistency/verification/pipeline"
import { ollama, anthropic, openrouter } from "@monkeydcode/llm/providers"

const MODELS = [
    { id: "qwen2.5-coder:7b", ref: ollama.model("qwen2.5-coder:7b"), label: "Qwen 7B" },
    { id: "qwen2.5-coder:14b", ref: ollama.model("qwen2.5-coder:14b"), label: "Qwen 14B" },
    { id: "qwen2.5-coder:32b", ref: openrouter.model("qwen/qwen-2.5-coder-32b"), label: "Qwen 32B" },
    { id: "claude-sonnet-4-6", ref: anthropic.model("claude-sonnet-4-6"), label: "Claude Sonnet" },
    { id: "claude-opus-4-7", ref: anthropic.model("claude-opus-4-7"), label: "Claude Opus" },
]

interface Result {
    model: string; task: string; passed: boolean
    verificationScore: number; durationSec: number; outputCode: string
}

async function runBenchmark() {
    const tasks = await readdir("benchmarks/tasks")
    const results: Result[] = []

    for (const taskDir of tasks) {
        const taskPath = `benchmarks/tasks/${taskDir}`
        for (const model of MODELS) {
            // Reset to starter
            await rm("/tmp/bench-work", { recursive: true, force: true })
            await cp(`${taskPath}/starter`, "/tmp/bench-work", { recursive: true })

            const description = await Bun.file(`${taskPath}/task.md`).text()
            const start = Date.now()

            try {
                await Effect.runPromise(Orchestrator.handle(description))
                // Copy expected tests in
                await cp(`${taskPath}/expected`, "/tmp/bench-work", { recursive: true })
                const verification = await Effect.runPromise(Pipeline.run(["/tmp/bench-work"]))

                results.push({
                    model: model.id, task: taskDir,
                    passed: verification.passed,
                    verificationScore: verification.score,
                    durationSec: (Date.now() - start) / 1000,
                    outputCode: await readGenerated("/tmp/bench-work"),
                })
            } catch {
                results.push({
                    model: model.id, task: taskDir, passed: false,
                    verificationScore: 0, durationSec: (Date.now() - start) / 1000,
                    outputCode: ""
                })
            }
        }
    }
    return results
}
```

## 12.3 Consistency metric

```typescript
import { distance } from "fastest-levenshtein"

function computePairwiseConsistency(results: Result[]) {
    const tasks = [...new Set(results.map(r => r.task))]
    const byPair: Record<string, number> = {}

    for (const task of tasks) {
        const taskResults = results.filter(r => r.task === task && r.passed)
        for (let i = 0; i < taskResults.length; i++) {
            for (let j = i + 1; j < taskResults.length; j++) {
                const a = taskResults[i]!
                const b = taskResults[j]!
                const sim = 1 - (distance(a.outputCode, b.outputCode) /
                                Math.max(a.outputCode.length, b.outputCode.length, 1))
                const key = `${a.model} vs ${b.model}`
                byPair[key] = (byPair[key] || 0) + sim
            }
        }
    }
    for (const key in byPair) byPair[key] /= tasks.length
    return byPair
}
```

## 12.4 Success criteria

monkeyDcode is working if:

1. **Pass rate:** Qwen 7B passes >= 70% (frontier baseline ~95%)
2. **Consistency:** Qwen 7B vs Claude Opus similarity >= 0.6
3. **Without consistency engine:** Qwen 7B passes <40%
4. **Improvement delta:** monkeyDcode improves Qwen 7B by >30pp

## 12.5 A/B comparison

Add flag to disable consistency sampling:
```typescript
const CONSISTENCY_ENABLED = process.env.MDCODE_NO_CONSISTENCY !== "1"
```

Run twice:
```bash
bun run benchmarks/run.ts > results-with.json
MDCODE_NO_CONSISTENCY=1 bun run benchmarks/run.ts > results-without.json
```

Expected:
```
qwen2.5-coder:7b:    with=70%, without=30%   delta=+40pp
qwen2.5-coder:14b:   with=80%, without=50%   delta=+30pp
qwen2.5-coder:32b:   with=90%, without=70%   delta=+20pp
claude-sonnet-4-6:   with=100%, without=90%  delta=+10pp
claude-opus-4-7:     with=100%, without=100% delta=0pp
```

## 12.6 Report

`benchmarks/report.md` (generated):
```markdown
# monkeyDcode Benchmark Results

## Pass Rates

| Model | With | Without | Delta |
|-------|------|---------|-------|
| Qwen 7B | 70% | 30% | +40pp |
| Qwen 14B | 80% | 50% | +30pp |
| Qwen 32B | 90% | 70% | +20pp |
| Claude Sonnet | 100% | 90% | +10pp |
| Claude Opus | 100% | 100% | 0pp |

## Pairwise Consistency

| Pair | Similarity |
|------|-----------|
| Qwen 7B vs Claude Opus | 0.65 |
| Qwen 32B vs Claude Opus | 0.78 |

## Conclusion

monkeyDcode raises weak-model output to near-frontier quality.
```

## 12.7 Commit

```bash
git add -A
git commit -m "feat: benchmark suite"
```

## What "Done" Looks Like

You're done with v1 when:

- [ ] All 12 steps validated and committed
- [ ] Benchmark shows >30pp improvement for weak models
- [ ] Qwen 7B output is >60% similar to Claude Opus output
- [ ] Users can install via curl and run `mdc`
- [ ] Full session works entirely on local Ollama (zero cloud calls)

## Beyond v1

- More language support (Rust, Go) in verification pipeline
- More sub-agents (performance optimizer, security auditor)
- VS Code extension talking to `mdc` daemon
- Public benchmark leaderboard
- Plugin marketplace
