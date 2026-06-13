import type { Plan } from "@monkeydcode/agent/plan-agent"

export function PlanView({ plan }: { plan: Plan }) {
    return (
        <box flexDirection="column" borderStyle="single" padding={1}>
            <text>Plan ({plan.steps.length} steps, level {plan.decompositionLevel})</text>
            {plan.steps.map((step, i) => (
                <box key={i} flexDirection="column">
                    <text>{i + 1}. {step.description}</text>
                    <text>   → {step.targetFiles.join(", ") || "(infer)"}</text>
                </box>
            ))}
        </box>
    )
}
