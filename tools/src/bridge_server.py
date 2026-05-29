from .vector_store import index_files, search

server.register("vectorStore.index", index_files)
server.register("vectorStore.search", search)

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
                            "error": {"code": -32601, "message": "Method not found"}}
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
