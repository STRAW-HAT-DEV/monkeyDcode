# Step 3: Adopt the Engine Core

**Goal:** Get session management, tool system, storage, and Effect runtime working.

**Prerequisites:** [Step 2](02-adopt-llm-package.md) complete. LLM smoke test passes.

**Reference spec:** [architecture.md](architecture.md) — Layers 1, 2, 4

---

## 3.1 What to copy from opencode

These directories from `~/Code/opencode-fork/packages/opencode/src/` go into `packages/engine/src/`:

| opencode source | monkeyDcode destination | What it does |
|----------------|------------------------|-------------|
| `effect/` | `packages/engine/src/effect/` | Effect runtime bootstrap |
| `bus/` | `packages/engine/src/bus/` | Event bus |
| `config/` | `packages/engine/src/config/` | Config management |
| `storage/` | `packages/engine/src/storage/` | SQLite/Drizzle |
| `session/` | `packages/engine/src/session/` | Session lifecycle, processor |
| `tool/` | `packages/engine/src/tool/` | Tool registry |
| `permission/` | `packages/engine/src/permission/` | Permission model |
| `lsp/` | `packages/engine/src/lsp/` | Language Server Protocol |
| `mcp/` | `packages/engine/src/mcp/` | Model Context Protocol |
| `git/` | `packages/engine/src/git/` | Git integration |
| `plugin/` | `packages/engine/src/plugin/` | Plugin extensibility |
| `provider/` | `packages/engine/src/provider/` | Provider auth/status |
| `agent/` | `packages/engine/src/agent/` | Agent definition framework |

## 3.2 What to SKIP

- `share/`, `sync/`, `control-plane/`, `acp/`
- `account/`, `auth/` (we use env vars for API keys)
- `ide/`, `image/`
- The entire `packages/` siblings: console, web, desktop, app, storybook, docs, enterprise, identity, containers, function, http-recorder, slack

## 3.3 Copy command

```bash
cd /home/rohan-prasen/Code/monkeyDcode

for dir in effect bus config storage session tool permission lsp mcp git plugin provider agent; do
    cp -r ~/Code/opencode-fork/packages/opencode/src/$dir packages/engine/src/$dir
done

find packages/engine/src -type f -name "*.ts" -exec sed -i 's|@opencode-ai/|@monkeydcode/|g' {} \;
find packages/engine/src -type f -name "*.ts" -exec sed -i 's|@opencode/|@monkeydcode/|g' {} \;
```

## 3.4 Engine `package.json`

```json
{
    "name": "@monkeydcode/engine",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "main": "src/index.ts",
    "scripts": {
        "typecheck": "tsc --noEmit",
        "test": "bun test"
    },
    "dependencies": {
        "@monkeydcode/llm": "workspace:*",
        "@monkeydcode/core": "workspace:*",
        "effect": "<copy version from opencode>",
        "drizzle-orm": "<copy version from opencode>",
        "@libsql/client": "<copy version from opencode>"
    },
    "devDependencies": {
        "@types/bun": "latest"
    }
}
```

Check `~/Code/opencode-fork/packages/opencode/package.json` for exact versions.

## 3.5 Engine `index.ts` (public API)

`packages/engine/src/index.ts`:
```typescript
export * as Session from "./session/index.ts"
export * as Tool from "./tool/index.ts"
export * as Config from "./config/index.ts"
export * as Bus from "./bus/index.ts"
export * as Storage from "./storage/index.ts"
export * as Permission from "./permission/index.ts"
export * as LSP from "./lsp/index.ts"
export * as MCP from "./mcp/index.ts"
export * as Git from "./git/index.ts"
export * as Plugin from "./plugin/index.ts"
export * as Provider from "./provider/index.ts"
export * as Agent from "./agent/index.ts"
```

## 3.6 Strip references to removed code

```bash
bun run --filter @monkeydcode/engine typecheck 2>&1 | head -50
```

Common removals:
- Imports of `share`, `sync`, `acp`, `account`, `auth`, `ide`, `image`, `control-plane`
- Stub functions that reference removed modules with `throw new Error("not implemented")`

**Tip:** Fix one module at a time. Start with `effect/` and `bus/`, then `config/`, `storage/`, `tool/`, `session/`.

## 3.7 Database migrations

```bash
cp -r ~/Code/opencode-fork/packages/opencode/migration packages/engine/migration
cp ~/Code/opencode-fork/packages/opencode/drizzle.config.ts packages/engine/drizzle.config.ts
```

Update `drizzle.config.ts` paths.

## 3.8 Migrate

```bash
cd packages/engine
bunx drizzle-kit migrate
```

## 3.9 Smoke test

`packages/engine/test/session-smoke.test.ts`:
```typescript
import { test, expect } from "bun:test"
import { Effect } from "effect"
import * as Session from "../src/session/index.ts"

test("can create and load a session", async () => {
    const program = Effect.gen(function* () {
        const session = yield* Session.create({ projectRoot: process.cwd() })
        const loaded = yield* Session.get(session.id)
        return loaded
    })
    const result = await Effect.runPromise(program)
    expect(result).toBeDefined()
})
```

```bash
bun test packages/engine/test/session-smoke.test.ts
```

## 3.10 Commit

```bash
git add -A
git commit -m "feat: adopt engine core from opencode"
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| Cannot find module '@monkeydcode/...' | `bun install` from repo root |
| Drizzle migration errors | Check SQLite path is writable |
| Many type errors | Triage in order: paths -> remove stripped imports -> stub TODO |

## Next Step

[Step 4: Echo milestone](04-echo-milestone.md)
