# Step 2: Adopt the LLM Package from opencode

**Goal:** Working LLM abstraction supporting OpenAI, Anthropic, Ollama (for local Qwen), and OpenRouter.

**Prerequisites:** [Step 1](01-fork-and-scaffold.md) complete. `~/Code/opencode-fork/` cloned.

**Reference spec:** [architecture.md](architecture.md) — Layer 3

---

## 2.1 Copy the LLM package

```bash
cd /home/rohan-prasen/Code/monkeyDcode

cp -r ~/Code/opencode-fork/packages/llm/src/* packages/llm/src/
cp ~/Code/opencode-fork/packages/llm/package.json packages/llm/package.json
cp ~/Code/opencode-fork/packages/llm/tsconfig.json packages/llm/tsconfig.json
cp ~/Code/opencode-fork/packages/llm/README.md packages/llm/README.md
```

## 2.2 Rename package scope

```bash
# Find all imports referencing opencode scope
grep -rn "@opencode-ai" packages/llm/src/

# Replace with monkeydcode
find packages/llm/src -type f -name "*.ts" -exec sed -i 's|@opencode-ai/|@monkeydcode/|g' {} \;
```

Edit `packages/llm/package.json` — change `"name"` to `"@monkeydcode/llm"`.

## 2.3 Update tsconfig

```json
{
    "extends": "../../tsconfig.base.json",
    "include": ["src"]
}
```

## 2.4 Copy `packages/core` (llm depends on it)

```bash
cp -r ~/Code/opencode-fork/packages/core/src/* packages/core/src/
cp ~/Code/opencode-fork/packages/core/package.json packages/core/package.json
cp ~/Code/opencode-fork/packages/core/tsconfig.json packages/core/tsconfig.json

find packages/core/src -type f -name "*.ts" -exec sed -i 's|@opencode-ai/|@monkeydcode/|g' {} \;
```

Edit `packages/core/package.json` — change `"name"` to `"@monkeydcode/core"`.

## 2.5 Install

```bash
bun install
```

## 2.6 Add Ollama provider

Create `packages/llm/src/providers/ollama.ts`:
```typescript
import { Route } from "../route/index.ts"
import { OpenAIChat } from "../protocols/openai-chat.ts"
import { HttpTransport, Endpoint, Framing } from "../route/transport.ts"

export const ollama = Route.make({
    id: "ollama",
    protocol: OpenAIChat.protocol,
    transport: HttpTransport.httpJson({
        endpoint: Endpoint.path("/api/chat"),
        framing: Framing.sse
    }),
    defaults: {
        baseURL: "http://localhost:11434/v1",
        capabilities: { tools: { calls: true } }
    }
})
```

(Adjust imports based on opencode's actual file structure.)

## 2.7 Smoke test

Create `packages/llm/test/smoke.test.ts`:
```typescript
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../src/llm.ts"
import { ollama } from "../src/providers/ollama.ts"

test("ollama responds to simple prompt", async () => {
    const program = Effect.gen(function* () {
        const response = yield* LLM.generate({
            model: ollama.model("qwen2.5-coder:7b"),
            prompt: "Say hello in 3 words"
        })
        return response.text
    })
    const result = await Effect.runPromise(program)
    expect(result).toBeTruthy()
    console.log("Response:", result)
})
```

Run `ollama serve` in another terminal, then:
```bash
bun test packages/llm/test/smoke.test.ts
```

If you see a response, the LLM layer works.

## 2.8 Commit

```bash
git add -A
git commit -m "feat: adopt LLM and core packages from opencode

- packages/llm: multi-provider LLM abstraction
- packages/core: shared schemas, model catalog
- Added Ollama route for local model testing
- Renamed scope to @monkeydcode/*"
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Cannot find module 'effect'" | `bun install` from repo root |
| Type errors after copy | Pin to opencode's effect version in root package.json |
| Ollama returns errors | Run `ollama serve` and `ollama pull qwen2.5-coder:7b` |

## Next Step

[Step 3: Adopt engine core](03-adopt-engine-core.md)
