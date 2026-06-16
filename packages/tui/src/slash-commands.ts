export interface SlashResult {
    handled: boolean
    message?: string
    exit?: boolean
}

export function handleSlashCommand(
    input: string,
    ctx?: { provider?: string; modelId?: string },
): SlashResult {
    const cmd = input.trim().toLowerCase()
    if (!cmd.startsWith("/")) return { handled: false }

    const [name, ...rest] = cmd.slice(1).split(/\s+/)
    const arg = rest.join(" ").trim()

    switch (name) {
        case "help":
        case "h":
            return {
                handled: true,
                message: [
                    "Slash commands:",
                    "  /help     — this message",
                    "  /model    — show active model",
                    "  /setup    — how to change provider/API key",
                    "  /clear    — clear chat",
                    "  /quit     — exit",
                    "",
                    "Or run from shell: mdc setup | mdc doctor | mdc \"task\"",
                ].join("\n"),
            }
        case "model":
            return {
                handled: true,
                message: ctx?.provider && ctx?.modelId
                    ? `Active model: ${ctx.provider}/${ctx.modelId}`
                    : "Model info unavailable",
            }
        case "setup":
            return {
                handled: true,
                message:
                    "To change provider or API key:\n" +
                    "  1. Exit ( /quit )\n" +
                    "  2. Run: mdc setup\n" +
                    "  Or: MDCODE_RECONFIGURE=1 mdc",
            }
        case "clear":
            return { handled: true, message: "__CLEAR__" }
        case "quit":
        case "exit":
        case "q":
            return { handled: true, exit: true }
        default:
            return {
                handled: true,
                message: `Unknown command /${name}. Try /help`,
            }
    }
}
