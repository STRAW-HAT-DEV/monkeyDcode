# Step 7: Plan and Build Agents

**Goal:** Plan (adaptive decomposition) + Build (executes plan steps with consistency).

**Prerequisites:** [Step 6](06-consistency-engine.md) complete.

**Reference spec:** [agents.md](agents.md)

---

## 7.1 Plan Agent

`packages/agent/src/plan-agent.ts`:
```typescript
import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import * as Capability from "@monkeydcode/consistency/model-capability/detector"

export interface PlanStep {
    description: string
    targetFiles: string[]
    changeType: "create" | "modify" | "delete"
    dependencies: number[]
    verificationCriteria: string
}

export interface Plan {
    steps: PlanStep[]
    decompositionLevel: number
}

export function plan(task: string, modelId: string): Effect.Effect<Plan> {
    return Effect.gen(function* () {
        const level = yield* Capability.detect(modelId)
        const promptTemplate = yield* loadPrompt(`plan-level-${level}.txt`)
        const prompt = promptTemplate.replace("{TASK}", task)

        const response = yield* LLM.generate({
            model: resolveModel(modelId),
            prompt,
            generation: { temperature: 0.3 }
        })

        const steps = parseStepsFromResponse(response.text)
        return { steps, decompositionLevel: level }
    })
}
```

## 7.2 Plan prompts per level

`packages/agent/src/prompts/plan-level-1.txt` (frontier — coarse):
```
You are a planning agent. Decompose into 1-3 high-level steps.

Task: {TASK}

Output JSON:
[
  { "description": "...", "targetFiles": ["..."], "changeType": "modify",
    "dependencies": [], "verificationCriteria": "..." }
]
```

`packages/agent/src/prompts/plan-level-6.txt` (very small — hyper-granular):
```
You are a planning agent. Decompose into SIMPLE, ATOMIC steps.

Each step must:
- Modify or create EXACTLY ONE file
- Contain LESS THAN 20 LINES of code
- Be executable in isolation

Task: {TASK}

Examples:
- "Add the import statement for X in Y.ts"
- "Add a type for PaginationParams to types/pagination.ts"
- "Add parameter `page: number` to function getUsers"
- "Change SQL query to include LIMIT and OFFSET"

Output JSON array of atomic steps.
```

Levels 2-5 are intermediate (max LOC: 100, 50, 30, 20).

## 7.3 Build Agent

`packages/agent/src/build-agent.ts`:
```typescript
import { Effect } from "effect"
import * as Sampler from "@monkeydcode/consistency/sampler"
import * as WorkingMemory from "@monkeydcode/context/working-memory"
import * as Retriever from "@monkeydcode/context/retriever"

export function executePlan(plan: Plan, modelId: string) {
    return Effect.gen(function* () {
        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i]!
            yield* executeStep(step, modelId, i)
        }
    })
}

function executeStep(step: PlanStep, modelId: string, index: number) {
    return Effect.gen(function* () {
        const context = yield* Retriever.retrieve({
            files: step.targetFiles,
            description: step.description
        })

        const prompt = buildExecutionPrompt(step, context)

        const result = yield* Sampler.sample({
            prompt,
            files: step.targetFiles,
            model: resolveModel(modelId),
            modelId
        })

        yield* applyChange(result.selected.change, step.targetFiles)

        yield* WorkingMemory.update({
            completedStep: index,
            confidence: result.confidence
        })
    })
}
```

## 7.4 Working memory (basic)

`packages/context/src/working-memory.ts`:
```typescript
import { Effect } from "effect"
import { writeFile, readFile, mkdir } from "fs/promises"
import { join } from "path"

interface State {
    currentGoal: string
    completedSteps: { index: number; confidence: number; timestamp: string }[]
    knownConstraints: string[]
    errorHistory: { step: number; error: string; timestamp: string }[]
}

const FILE = join(process.cwd(), ".monkeydcode", "working-memory.json")

export function load(): Effect.Effect<State> {
    return Effect.tryPromise(async () => {
        try {
            return JSON.parse(await readFile(FILE, "utf-8")) as State
        } catch {
            return { currentGoal: "", completedSteps: [], knownConstraints: [], errorHistory: [] }
        }
    })
}

export function save(state: State) {
    return Effect.tryPromise(async () => {
        await mkdir(join(process.cwd(), ".monkeydcode"), { recursive: true })
        await writeFile(FILE, JSON.stringify(state, null, 2))
    })
}

export function update(patch: Partial<State>) {
    return Effect.gen(function* () {
        const current = yield* load()
        yield* save({ ...current, ...patch })
    })
}
```

## 7.5 Context retriever (stub — enhanced in step 9)

`packages/context/src/retriever.ts`:
```typescript
export function retrieve(query: { files: string[]; description: string }) {
    return Effect.gen(function* () {
        const fileContents = yield* Effect.all(
            query.files.map(f => Effect.tryPromise(() => Bun.file(f).text()))
        )
        return { files: fileContents.join("\n---\n") }
    })
}
```

## 7.6 Wire into TUI

```typescript
async function handleUserMessage(message: string) {
    const program = Effect.gen(function* () {
        const plan = yield* PlanAgent.plan(message, modelId)
        displayPlan(plan)
        yield* BuildAgent.executePlan(plan, modelId)
        return "Done"
    })
    return Effect.runPromise(program)
}
```

## 7.7 End-to-end test

Task: `"Add a function called \`sum\` to src/math.ts that returns the sum of two numbers"`

With Qwen 7B (level 6): 3-5 atomic steps, each verified individually.
With Claude Opus (level 1): 1 single step.

## 7.8 Commit

```bash
git add -A
git commit -m "feat: Plan and Build agents"
```

## Validation Checklist

- [ ] Plan agent produces correct step count per level
- [ ] Build agent executes steps in order
- [ ] Each step goes through Consistency Engine
- [ ] Working memory persists
- [ ] Simple task completes with both weak and strong models

## Next Step

[Step 8: Python bridge](08-python-bridge.md)
