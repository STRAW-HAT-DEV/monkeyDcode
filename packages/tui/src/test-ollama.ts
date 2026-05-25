import { ollama } from "@monkeydcode/llm/providers/ollama"
import { LLM } from "@monkeydcode/llm"

const model = ollama.model("qwen2.5-coder:7b")

console.log("Connecting to Ollama...")
console.log("Streaming response:\n")

for await (const event of LLM.stream({ model, messages: [{ role: "user", content: "Write a python function to reverse a string. Be brief." }] })) {
    if (event.type === "text_delta") process.stdout.write(event.delta)
    if (event.type === "error") { console.error("\nError:", event.error); process.exit(1) }
    if (event.type === "done") console.log("\n\nDone. Tokens:", event.response.usage)
}
