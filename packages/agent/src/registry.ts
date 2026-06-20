/** Agent registry — roles and permissions per plan/agents.md */

export type Permission = "read-only" | "full"

export interface AgentDefinition {
    id: string
    role: string
    permissions: Permission
    description: string
}

export const AGENTS: Record<string, AgentDefinition> = {
    plan: {
        id: "plan",
        role: "Adaptive task decomposition (levels 1–6)",
        permissions: "read-only",
        description: "Breaks tasks into atomic steps; never writes files directly",
    },
    build: {
        id: "build",
        role: "Code generation with consistency loop",
        permissions: "full",
        description: "Generates code via multi-temperature sampling + verification",
    },
    review: {
        id: "review",
        role: "Actor-Critique multi-round review",
        permissions: "read-only",
        description: "Reviews diffs; routes fixes back to build",
    },
    bugfix: {
        id: "bugfix",
        role: "Reproduce → localize → fix → verify",
        permissions: "full",
        description: "Bug-fix sub-agent",
    },
    feature: {
        id: "feature",
        role: "Spec → plan → scaffold → implement → test",
        permissions: "full",
        description: "Feature sub-agent",
    },
    refactor: {
        id: "refactor",
        role: "Parse AST → plan → apply → verify",
        permissions: "full",
        description: "Refactor sub-agent",
    },
    debug: {
        id: "debug",
        role: "Read traceback → hypothesize → test → fix (HyDE)",
        permissions: "full",
        description: "Debug sub-agent",
    },
}

export function get(id: string): AgentDefinition | undefined {
    return AGENTS[id]
}

export function canWrite(agentId: string): boolean {
    return AGENTS[agentId]?.permissions === "full"
}

export function assertCanWrite(agentId: string): void {
    if (!canWrite(agentId)) {
        throw new Error(`Agent "${agentId}" is read-only and cannot modify files`)
    }
}
