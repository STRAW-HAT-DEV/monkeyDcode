"""
monkeyDcode Python Bridge Server
JSON-RPC over Unix socket (Linux/macOS) or TCP (Windows).
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


class BridgeServer:
    def __init__(self):
        self.handlers: dict = {}

    def register(self, method: str, handler):
        self.handlers[method] = handler

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        while True:
            line = await reader.readline()
            if not line:
                break
            try:
                req = json.loads(line)
                handler = self.handlers.get(req["method"])
                if handler:
                    params = req.get("params") or {}
                    if isinstance(params, dict):
                        result = (
                            await handler(**params)
                            if asyncio.iscoroutinefunction(handler)
                            else handler(**params)
                        )
                    else:
                        result = (
                            await handler(params)
                            if asyncio.iscoroutinefunction(handler)
                            else handler(params)
                        )
                    resp = {"jsonrpc": "2.0", "id": req["id"], "result": result}
                else:
                    resp = {
                        "jsonrpc": "2.0",
                        "id": req["id"],
                        "error": {"code": -32601, "message": f"Method not found: {req['method']}"},
                    }
            except Exception as e:
                resp = {
                    "jsonrpc": "2.0",
                    "id": req.get("id"),
                    "error": {"code": -32000, "message": str(e)},
                }
            writer.write((json.dumps(resp) + "\n").encode())
            await writer.drain()
        writer.close()

    async def start_unix(self, socket_path: str):
        Path(socket_path).unlink(missing_ok=True)
        srv = await asyncio.start_unix_server(self.handle_client, socket_path)
        print("ready", flush=True)
        async with srv:
            await srv.serve_forever()

    async def start_tcp(self):
        srv = await asyncio.start_server(self.handle_client, "127.0.0.1", 0)
        host, port = srv.sockets[0].getsockname()[:2]
        print(f"ready tcp://{host}:{port}", flush=True)
        async with srv:
            await srv.serve_forever()


def main():
    if len(sys.argv) < 2:
        print("Usage: bridge_server.py <socket_path|tcp://0>", file=sys.stderr)
        sys.exit(1)

    endpoint = sys.argv[1]
    server = BridgeServer()

    try:
        from tree_sitter_index import extract_signatures, parse_ast
        server.register("treeSitter.extractSignatures", extract_signatures)
        server.register("treeSitter.parseAST", parse_ast)
    except ImportError as e:
        print(f"[bridge] tree-sitter unavailable: {e}", file=sys.stderr)

    try:
        from vector_store import index_files, search as vs_search
        server.register("vectorStore.index", index_files)
        server.register("vectorStore.search", vs_search)
    except ImportError as e:
        print(f"[bridge] vector_store unavailable: {e}", file=sys.stderr)

    try:
        from knowledge_graph import neighbors as kg_neighbors, build as kg_build
        server.register("knowledgeGraph.build", kg_build)
        server.register("knowledgeGraph.neighbors", kg_neighbors)
    except ImportError as e:
        print(f"[bridge] knowledge_graph unavailable: {e}", file=sys.stderr)

    server.register("ping", lambda: "pong")

    if endpoint.startswith("tcp://"):
        asyncio.run(server.start_tcp())
    else:
        asyncio.run(server.start_unix(endpoint))


if __name__ == "__main__":
    main()
