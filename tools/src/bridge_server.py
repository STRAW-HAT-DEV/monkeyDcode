"""Unix-socket JSON-RPC bridge server for the monkeyDcode Python tools.

Hardened: method allowlist with per-method pydantic param schemas, read
timeout + max line size (DoS), generic client-facing errors (no internal
leakage), and a 0600 socket created under a user-owned directory.
"""

import asyncio
import json
import logging
import os
import sys
import uuid
from pathlib import Path

from pydantic import BaseModel, ValidationError

logger = logging.getLogger("monkeydcode.bridge")

MAX_LINE_BYTES = 10 * 1024 * 1024  # 10 MiB per request line
READ_TIMEOUT_S = 300


# --- Per-method parameter schemas (validated before dispatch) ---

class PingParams(BaseModel):
    pass


class FileParams(BaseModel):
    file: str


class IndexParams(BaseModel):
    files: list[str]


class SearchParams(BaseModel):
    query: str
    k: int = 5


class BridgeServer:
    def __init__(self, socket_path: str):
        self.socket_path = socket_path
        # method -> (handler, param_schema)
        self.handlers: dict[str, tuple] = {}

    def register(self, method: str, handler, schema: type[BaseModel]):
        self.handlers[method] = (handler, schema)

    async def _send(self, writer, resp: dict) -> None:
        writer.write((json.dumps(resp) + "\n").encode())
        await writer.drain()

    async def handle_client(self, reader, writer):
        try:
            while True:
                try:
                    line = await asyncio.wait_for(reader.readline(), timeout=READ_TIMEOUT_S)
                except asyncio.TimeoutError:
                    break
                if not line:
                    break
                if len(line) > MAX_LINE_BYTES:
                    await self._send(
                        writer,
                        {"jsonrpc": "2.0", "id": None,
                         "error": {"code": -32600, "message": "Request too large"}},
                    )
                    continue

                resp = self._dispatch(line)
                await self._send(writer, resp)
        finally:
            writer.close()

    def _dispatch(self, line: bytes) -> dict:
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            method = req.get("method")

            entry = self.handlers.get(method)
            if entry is None:
                return {"jsonrpc": "2.0", "id": req_id,
                        "error": {"code": -32601, "message": "Method not found"}}

            handler, schema = entry
            validated = schema(**(req.get("params") or {}))
            params = validated.model_dump()
            result = handler(**params)
            return {"jsonrpc": "2.0", "id": req_id, "result": result}

        except ValidationError as e:
            logger.warning("parameter validation failed: %s", e)
            return {"jsonrpc": "2.0", "id": req_id,
                    "error": {"code": -32602, "message": "Invalid params"}}
        except NotImplementedError as e:
            # Our own message — safe to surface to the client.
            return {"jsonrpc": "2.0", "id": req_id,
                    "error": {"code": -32004, "message": str(e)}}
        except Exception:
            ref = uuid.uuid4().hex[:8]
            logger.exception("handler error [ref %s]", ref)
            return {"jsonrpc": "2.0", "id": req_id,
                    "error": {"code": -32000, "message": f"Internal error (ref {ref})"}}

    async def start(self):
        Path(self.socket_path).unlink(missing_ok=True)
        server = await asyncio.start_unix_server(self.handle_client, self.socket_path)
        os.chmod(self.socket_path, 0o600)
        logger.info("bridge listening on %s", self.socket_path)
        async with server:
            await server.serve_forever()


def resolve_socket_arg(argv: list[str]) -> str:
    """Validate the --socket argument: absolute path under a user-owned dir."""
    if "--socket" not in argv:
        raise SystemExit("--socket <path> is required")
    raw = argv[argv.index("--socket") + 1]
    path = Path(raw)
    if not path.is_absolute():
        raise SystemExit("--socket must be an absolute path")

    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if parent.stat().st_uid != os.getuid():
        raise SystemExit("socket directory must be owned by the current user")
    return str(path)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    socket_path = resolve_socket_arg(sys.argv)
    server = BridgeServer(socket_path)

    # Import handlers lazily so the heavy optional deps (chromadb, tree-sitter)
    # are only loaded when the server actually starts.
    from .vector_store import index_files, search
    from .tree_sitter_index import extract_signatures, parse_ast

    server.register("ping", lambda: "pong", PingParams)
    server.register("vectorStore.index", index_files, IndexParams)
    server.register("vectorStore.search", search, SearchParams)
    server.register("treeSitter.extractSignatures", extract_signatures, FileParams)
    server.register("treeSitter.parseAST", parse_ast, FileParams)

    asyncio.run(server.start())


if __name__ == "__main__":
    main()
