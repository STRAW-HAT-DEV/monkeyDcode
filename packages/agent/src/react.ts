/**
 * ReAct prompt wrapper — Thought → Action → Observation → Answer
 * Used by all agents per plan/agents.md
 */

export interface ReActStep {
    thought: string
    action: string
    observation?: string
}

export function wrapReAct(task: string, context?: string): string {
    const ctx = context ? `\n\n## Context\n${context}` : ""
    return `You are a coding agent using ReAct (Reasoning + Acting).

For each step, think before acting:
Thought → Action → Observation → Thought → ... → Answer

## Task
${task}${ctx}

## Output Format
1. **Thought:** Reason about what to do next
2. **Action:** The concrete change or tool use
3. **Observation:** What you expect to see after the action
4. Then produce the final answer (code blocks, JSON plan, etc.)

Begin with Thought:`
}

export function parseReActSections(text: string): ReActStep[] {
    const steps: ReActStep[] = []
    const thought = text.match(/\*\*Thought:\*\*\s*([\s\S]*?)(?=\*\*Action:|$)/i)?.[1]?.trim()
    const action = text.match(/\*\*Action:\*\*\s*([\s\S]*?)(?=\*\*Observation:|$)/i)?.[1]?.trim()
    const observation = text.match(/\*\*Observation:\*\*\s*([\s\S]*?)(?=\*\*Thought:|$)/i)?.[1]?.trim()
    if (thought || action) {
        steps.push({ thought: thought ?? "", action: action ?? "", observation })
    }
    return steps
}
