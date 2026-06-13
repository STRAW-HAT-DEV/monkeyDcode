import type { AgentStatus as Status } from "@monkeydcode/agent/status"

export function AgentStatus({ status }: { status: Status }) {
    return (
        <box borderStyle="single" padding={1}>
            <text>Agent: {status.agent}</text>
            <text>{status.action}</text>
        </box>
    )
}
