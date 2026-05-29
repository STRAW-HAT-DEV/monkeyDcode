# Step 8: Python Bridge

**Goal:** TypeScript <-> Python via JSON-RPC over Unix socket. Enables tree-sitter, knowledge graph, vector store.

**Prerequisites:** [Step 7](07-plan-build-agents.md) complete.

**Reference spec:** [python-bridge.md](python-bridge.md)

---

## 8.1 Python JSON-RPC server

`tools/src/bridge_server.py`:
```python
import asyncio
import json
import sys
from pathlib import Path

class BridgeServer:
    def __init__(self, socket_path: str):
        self.socket_path = socket_path
        self.handlers = {}

    def register(self, method: str, handler):
        self.handlers[method] = handler

    async def handle_client(self, reader, writer):
        while True:
            line = await reader.readline()
            if not line:
                break
            try:
                req = json.loads(line)
                handler = self.handlers.get(req["method"])
                if handler:
                    params = req.get("params", {})
                    result = await handler(**params) if asyncio.iscoroutinefunction(handler) else handler(**params)
                    resp = {"jsonrpc": "2.0", "id": req["id"], "result": result}
                else:
                    resp = {"jsonrpc": "2.0", "id": req["id"],
                            "error": {"code": -32601, "message": f"Method not found"}}
            except Exception as e:
                resp = {"jsonrpc": "2.0", "id": req.get("id"),
                        "error": {"code": -32000, "message": str(e)}}
            writer.write((json.dumps(resp) + "\n").encode())
            await writer.drain()
        writer.close()

    async def start(self):
        Path(self.socket_path).unlink(missing_ok=True)
        server = await asyncio.start_unix_server(self.handle_client, self.socket_path)
        async with server:
            await server.serve_forever()


def main():
    socket_path = sys.argv[sys.argv.index("--socket") + 1]
    server = BridgeServer(socket_path)

    from .tree_sitter_index import extract_signatures, parse_ast
    server.register("treeSitter.extractSignatures", extract_signatures)
    server.register("treeSitter.parseAST", parse_ast)
    server.register("ping", lambda: "pong")

    asyncio.run(server.start())


if __name__ == "__main__":
    main()
```

## 8.2 Tree-sitter signature extraction

Add to `tools/pyproject.toml`:
```toml
dependencies = [
    # existing...
    "tree-sitter>=0.24.0",
    "tree-sitter-python>=0.23.0",
    "tree-sitter-typescript>=0.23.0",
]
```

Then `cd tools && uv sync`.

`tools/src/tree_sitter_index.py`:
```python
from tree_sitter import Parser, Language
import tree_sitter_python as tspython
import tree_sitter_typescript as tsts
from pathlib import Path

LANGUAGES = {
    ".py": Language(tspython.language()),
    ".ts": Language(tsts.language_typescript()),
    ".tsx": Language(tsts.language_tsx()),
}

def extract_signatures(file: str) -> list[dict]:
    path = Path(file)
    lang = LANGUAGES.get(path.suffix)
    if not lang:
        return []

    parser = Parser(lang)
    source = path.read_bytes()
    tree = parser.parse(source)

    signatures = []
    def visit(node):
        if node.type in ("function_definition", "function_declaration", "method_definition"):
            name_node = node.child_by_field_name("name")
            params_node = node.child_by_field_name("parameters")
            if name_node:
                signatures.append({
                    "name": source[name_node.start_byte:name_node.end_byte].decode(),
                    "parameters": source[params_node.start_byte:params_node.end_byte].decode() if params_node else "",
                    "line": node.start_point[0] + 1,
                    "type": "function"
                })
        for child in node.children:
            visit(child)

    visit(tree.root_node)
    return signatures


def parse_ast(file: str) -> dict:
    # Returns simplified AST as nested dict
    pass
```

## 8.3 TypeScript bridge client

`packages/python-bridge/src/bridge.ts`:
```typescript
import { Effect, Context, Layer, Data } from "effect"
import { spawn, type ChildProcess } from "child_process"
import { Socket } from "net"

export class PythonBridgeError extends Data.TaggedError("PythonBridgeError")<{
    kind: "spawn_failed" | "connection_lost" | "timeout" | "rpc_error"
    message: string
}> {}

export class PythonBridge extends Context.Tag("@monkeydcode/PythonBridge")<
    PythonBridge,
    {
        call: <T>(method: string, params?: any) => Effect.Effect<T, PythonBridgeError>
        shutdown: () => Effect.Effect<void>
    }
>() {}

export const live = Layer.scoped(PythonBridge, Effect.gen(function* () {
    const state = yield* spawnBridge()
    return PythonBridge.of({
        call: (method, params) => callRpc(state, method, params),
        shutdown: () => Effect.sync(() => {
            state.process.kill()
            state.socket.destroy()
        })
    })
}))

// ... spawnBridge() and callRpc() implementations ...
```

## 8.4 Typed client wrappers

`packages/python-bridge/src/client.ts`:
```typescript
export interface Signature {
    name: string
    parameters: string
    line: number
    type: "function" | "method" | "class"
}

export const treeSitter = {
    extractSignatures: (file: string) =>
        Effect.gen(function* () {
            const bridge = yield* PythonBridge
            return yield* bridge.call<Signature[]>("treeSitter.extractSignatures", { file })
        })
}
```

## 8.5 Test

`packages/python-bridge/test/roundtrip.test.ts`:
```typescript
test("ping roundtrip", async () => {
    const program = Effect.gen(function* () {
        const bridge = yield* PythonBridge
        return yield* bridge.call<string>("ping")
    })
    const result = await Effect.runPromise(Effect.provide(program, live))
    expect(result).toBe("pong")
})

test("extract signatures from TS", async () => {
    await writeFile("/tmp/sample.ts", `
        export function foo(x: number): number { return x + 1 }
    `)
    const program = treeSitter.extractSignatures("/tmp/sample.ts")
    const result = await Effect.runPromise(Effect.provide(program, live))
    expect(result[0]!.name).toBe("foo")
})
```

```bash
cd tools && uv sync && cd ..
bun test packages/python-bridge/test/
```

## 8.6 Graceful degradation

If `uv` missing or `tools/.venv` doesn't exist, fall back to regex parsing in TypeScript:

```typescript
export const treeSitter = {
    extractSignatures: (file: string) =>
        Effect.catchTag("PythonBridgeError", () =>
            Effect.succeed(regexFallbackExtract(file))
        )(realExtract(file))
}
```

## 8.7 Commit

```bash
git add -A
git commit -m "feat: Python bridge

- JSON-RPC 2.0 server
- Effect-based TypeScript client
- Tree-sitter signature extraction
- Graceful degradation"
```

## Validation Checklist

- [ ] Python process spawns
- [ ] Unix socket established
- [ ] `ping` -> `pong` works
- [ ] Signature extraction returns correct results
- [ ] Concurrent requests handled
- [ ] Graceful degradation when uv missing

## Next Step

[Step 9: Context engineering](09-context-engineering.md)
