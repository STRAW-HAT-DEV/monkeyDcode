// @ts-nocheck
import { Schema } from "effect"
import { mdcTool } from "./factory.ts"

const ircChannel: { from: string; message: string; at: string }[] = []

export const IrcTool = mdcTool(
    "irc",
    "Inter-agent prose communication channel.",
    {
        action: Schema.Literals(["send", "read", "clear"]),
        from: Schema.optional(Schema.String),
        message: Schema.optional(Schema.String),
    },
    async (args) => {
        const action = args.action as string
        if (action === "send" && args.message) {
            ircChannel.push({
                from: (args.from as string) ?? "agent",
                message: args.message as string,
                at: new Date().toISOString(),
            })
            return { title: "irc", output: "Message sent." }
        }
        if (action === "read") {
            return {
                title: "irc",
                output: ircChannel.map(m => `[${m.at}] ${m.from}: ${m.message}`).join("\n") || "No messages",
            }
        }
        if (action === "clear") {
            ircChannel.length = 0
            return { title: "irc", output: "Channel cleared." }
        }
        return { title: "irc", output: "Invalid IRC action." }
    },
)
