# Step 10: Review Agent and Sub-Agents

**Goal:** Review Agent (Actor-Critique) + 4 specialized sub-agents (Bug-Fix, Feature, Refactor, Debug).

**Prerequisites:** [Step 9](09-context-engineering.md) complete.

**Reference spec:** [agents.md](agents.md)

---

## 10.1 Review Agent (Actor-Critique)

`packages/agent/src/review-agent.ts`:
```typescript
import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import { Git } from "@monkeydcode/engine"

export interface ReviewIssue {
    severity: "critical" | "high" | "medium" | "low"
    type: "bug" | "security" | "performance" | "style" | "missing-edge-case"
    file: string
    line: number
    message: string
    suggestion?: string
}

export function review(modelRef: any) {
    return Effect.gen(function* () {
        const diff = yield* Git.getDiff()

        // Round 1: Actor
        const actor = yield* LLM.generate({
            model: modelRef,
            prompt: actorPrompt(diff),
            generation: { temperature: 0.3 }
        })
        const actorIssues = parseIssues(actor.text)

        // Round 2: Critic
        const critic = yield* LLM.generate({
            model: modelRef,
            prompt: criticPrompt(diff, actorIssues),
            generation: { temperature: 0.4 }
        })
        const criticIssues = parseIssues(critic.text)

        // Round 3: Consensus
        const consensus = yield* LLM.generate({
            model: modelRef,
            prompt: consensusPrompt(diff, actorIssues, criticIssues),
            generation: { temperature: 0.2 }
        })

        return parseIssues(consensus.text)
    })
}
```

Prompts in `packages/agent/src/prompts/`:

**`review-actor.txt`**:
```
Review this code change. Find all issues:
- Bugs and logic errors
- Security vulnerabilities (injection, XSS, hardcoded secrets)
- Performance issues
- Style/maintainability problems
- Missing edge cases

Diff: {DIFF}

Output JSON array with: severity, type, file, line, message, suggestion.
```

**`review-critic.txt`**:
```
A reviewer found these issues. Critique:
- Which are false positives?
- Which are correct?
- What did they miss?

Diff: {DIFF}
Issues: {ISSUES}

Output JSON: { validated: [...], false_positives: [...], missed: [...] }
```

**`review-consensus.txt`**:
```
Two reviewers analyzed this. Produce final actionable list.

Diff: {DIFF}
Actor: {ACTOR}
Critic: {CRITIC}

Output JSON array of confirmed issues.
```

## 10.2 Wire into the build flow

After Build Agent completes:
```typescript
const issues = yield* ReviewAgent.review(modelRef)

if (issues.some(i => i.severity === "critical" || i.severity === "high")) {
    const fixSteps = issues.map(i => ({
        description: `Fix: ${i.message}`,
        targetFiles: [i.file],
        changeType: "modify" as const,
        dependencies: [],
        verificationCriteria: i.suggestion || ""
    }))
    yield* BuildAgent.executePlan({ steps: fixSteps, decompositionLevel: level }, modelId)
}
```

## 10.3 Bug-Fix Sub-Agent

`packages/agent/src/sub-agents/bugfix.ts`:
```typescript
export function fix(report: { error: string; stack?: string }) {
    return Effect.gen(function* () {
        // 1. Reproduce: write a failing test
        const reproPlan = yield* PlanAgent.plan(
            `Write a test reproducing this bug:\n${report.error}\n${report.stack}`,
            modelId
        )
        yield* BuildAgent.executePlan(reproPlan, modelId)

        // 2. Localize: use stack trace
        const suspectFiles = yield* localize(report)

        // 3. Fix
        const fixPlan = yield* PlanAgent.plan(
            `Fix the bug. Suspect: ${suspectFiles.join(", ")}`,
            modelId
        )
        yield* BuildAgent.executePlan(fixPlan, modelId)

        // 4. Verify reproduction test passes
        return (yield* Pipeline.run(suspectFiles)).passed
    })
}
```

## 10.4 Feature Sub-Agent

`packages/agent/src/sub-agents/feature.ts`:
```typescript
export function build(spec: string) {
    return Effect.gen(function* () {
        const clarifiedSpec = yield* clarify(spec)
        const plan = yield* PlanAgent.plan(clarifiedSpec, modelId)

        yield* BuildAgent.executePlan(extractScaffolding(plan), modelId)
        yield* BuildAgent.executePlan(extractImplementation(plan), modelId)

        const testPlan = yield* PlanAgent.plan(
            `Write tests for: ${clarifiedSpec}`, modelId
        )
        yield* BuildAgent.executePlan(testPlan, modelId)
    })
}
```

## 10.5 Refactor Sub-Agent

`packages/agent/src/sub-agents/refactor.ts`:
```typescript
export function refactor(target: string, goal: string) {
    return Effect.gen(function* () {
        const ast = yield* treeSitter.parseAST(target)

        const plan = yield* PlanAgent.plan(
            `Refactor ${target} to: ${goal}. Structure: ${JSON.stringify(ast)}`,
            modelId
        )

        yield* BuildAgent.executePlan(plan, modelId)

        const verification = yield* Pipeline.run([target])
        if (!verification.passed) {
            yield* Effect.fail(new Error("Refactor broke existing behavior"))
        }
    })
}
```

## 10.6 Debug Sub-Agent (HyDE)

`packages/agent/src/sub-agents/debug.ts`:
```typescript
export function debug(traceback: string) {
    return Effect.gen(function* () {
        const parsed = parseTraceback(traceback)

        const hypotheses = yield* LLM.generate({
            model: modelRef,
            prompt: `Given this error, list 3-5 hypotheses for root cause:\n${traceback}`,
            generation: { temperature: 0.7 }
        })

        for (const h of parseHypotheses(hypotheses.text)) {
            const test = yield* generateTest(h)
            const result = yield* runTest(test)
            if (result.confirms(h)) {
                yield* fix(h)
                return
            }
        }
    })
}
```

## 10.7 Classifier and orchestrator

`packages/agent/src/orchestrator.ts`:
```typescript
export function handle(message: string) {
    return Effect.gen(function* () {
        const category = yield* classifier.classify(message)

        switch (category) {
            case "bug_fix":  yield* BugFix.fix(parseAsBugReport(message)); break
            case "feature":  yield* Feature.build(message); break
            case "refactor": yield* Refactor.refactor(extractTarget(message), message); break
            case "debug":    yield* Debug.debug(message); break
            default: {
                const plan = yield* PlanAgent.plan(message, modelId)
                yield* BuildAgent.executePlan(plan, modelId)
            }
        }

        const issues = yield* ReviewAgent.review(modelRef)
        // Handle issues...
    })
}
```

## 10.8 Test workflows

- "There's a bug: getUsers returns duplicates" -> Bug-Fix
- "Add a search feature" -> Feature
- "Refactor src/api.ts to use repository pattern" -> Refactor
- Paste Python traceback -> Debug

## 10.9 Commit

```bash
git add -A
git commit -m "feat: review agent and 4 sub-agents"
```

## Validation Checklist

- [ ] Review runs 3 rounds (Actor, Critic, Consensus)
- [ ] Critical/high issues route back to Build
- [ ] Classifier picks right agent
- [ ] Bug-Fix produces failing test before fixing
- [ ] Refactor preserves behavior
- [ ] Debug tests hypotheses systematically

## Next Step

[Step 11: TUI and installation](11-tui-and-installation.md)
