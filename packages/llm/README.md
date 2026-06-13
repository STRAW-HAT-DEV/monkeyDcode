# @monkeydcode/llm

Multi-provider LLM abstraction for monkeyDcode.

## Providers

- **Ollama** — local models (`qwen2.5-coder:7b`, etc.)
- **Anthropic** — Claude models
- **OpenAI** — GPT models
- **OpenRouter** — hosted multi-model access
- **DeepSeek** — DeepSeek models

## Usage

```typescript
import { LLM } from "@monkeydcode/llm"
import { ollama } from "@monkeydcode/llm/providers/ollama"
import { Effect } from "effect"

const program = Effect.gen(function* () {
    const response = yield* LLM.generate({
        model: ollama.model("qwen2.5-coder:7b"),
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.3,
    })
    return response.text
})

await Effect.runPromise(program)
```

## Testing

```bash
bun test packages/llm/test/smoke.test.ts
```

Requires Ollama running for the live smoke test.
