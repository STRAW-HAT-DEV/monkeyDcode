export function DiffView({ diff }: { diff: string }) {
    if (!diff.trim()) return null
    return (
        <box flexDirection="column" borderStyle="rounded" borderColor="gray" padding={1}>
            {diff.split("\n").map((line, i) => (
                <text key={i}>{line}</text>
            ))}
        </box>
    )
}
