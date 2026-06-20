import type { Plan } from "./plan-agent.ts"

export interface AgentStatus {
    agent: string
    action: string
    plan?: Plan | null
    progress?: { current: number; total: number }
    diff?: string
}

type Listener = (status: AgentStatus) => void

const listeners = new Set<Listener>()

export function subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function emit(status: AgentStatus): void {
    for (const fn of listeners) fn(status)
}

export function idle(): void {
    emit({ agent: "idle", action: "Ready" })
}
