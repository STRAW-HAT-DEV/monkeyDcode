# Python Bridge

TypeScript <-> Python integration via JSON-RPC 2.0 over Unix domain socket.

## Architecture

TypeScript (`packages/python-bridge/`):
- `bridge.ts` — spawns Python, manages lifecycle, creates UDS
- `client.ts` — typed Effect wrappers

Python (`tools/src/`):
- `bridge_server.py` — JSON-RPC server (asyncio)
- `tree_sitter_index.py` — function signature extraction
- `knowledge_graph/` — code-review-graph wrapper
- `vector_store/` — ChromaDB semantic search
- `auth/` — OAuth, API key management

## Startup

1. `PythonBridge.spawn()` called lazily on first use
2. Check for uv: `which uv`
3. Spawn: `uv run python -m tools.bridge_server --socket /tmp/monkeydcode-{pid}.sock`
4. Poll for socket availability (100ms, 5s timeout)
5. Health check RPC
6. Ready

## Graceful Degradation

If Python not set up:
- tree-sitter -> regex fallback in TypeScript
- knowledge graph -> disabled
- vector store -> disabled
- User prompted to run `scripts/setup-python.sh`
