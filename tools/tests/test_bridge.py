"""Hermetic tests for the JSON-RPC bridge dispatch logic.

These avoid the heavy optional deps (chromadb, tree-sitter) — they exercise the
method allowlist, parameter validation, and error-leak behavior directly.
"""

import json

from src.bridge_server import BridgeServer, FileParams, PingParams


def make_server() -> BridgeServer:
    server = BridgeServer("/tmp/monkeydcode-test-unused.sock")
    server.register("ping", lambda: "pong", PingParams)

    def boom():
        raise RuntimeError("secret internal detail that must not leak")

    server.register("boom", boom, PingParams)
    return server


def dispatch(server: BridgeServer, method: str, params: dict | None = None, req_id: int = 1) -> dict:
    line = json.dumps({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}).encode()
    return server._dispatch(line)


def test_known_method_dispatches():
    resp = dispatch(make_server(), "ping")
    assert resp["result"] == "pong"
    assert resp["id"] == 1


def test_unknown_method_is_rejected():
    resp = dispatch(make_server(), "vectorStore.dropEverything")
    assert resp["error"]["code"] == -32601
    assert resp["error"]["message"] == "Method not found"


def test_internal_error_does_not_leak_details():
    resp = dispatch(make_server(), "boom")
    assert resp["error"]["code"] == -32000
    assert "secret internal detail" not in resp["error"]["message"]
    assert "Internal error" in resp["error"]["message"]


def test_invalid_params_are_rejected():
    server = BridgeServer("/tmp/monkeydcode-test-unused.sock")
    server.register("needsFile", lambda file: file, FileParams)
    resp = dispatch(server, "needsFile", {})  # missing required 'file'
    assert resp["error"]["code"] == -32602


def test_not_implemented_surfaces_its_message():
    def stub(file):
        raise NotImplementedError("treeSitter.parseAST is not implemented yet")

    server = BridgeServer("/tmp/monkeydcode-test-unused.sock")
    server.register("treeSitter.parseAST", stub, FileParams)
    resp = dispatch(server, "treeSitter.parseAST", {"file": "/tmp/x.ts"})
    assert resp["error"]["code"] == -32004
    assert "not implemented" in resp["error"]["message"]
