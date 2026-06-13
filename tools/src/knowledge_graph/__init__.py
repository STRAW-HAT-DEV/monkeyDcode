import ast
import re
from pathlib import Path

import networkx as nx

_graph = None


def _normalize_path(p: str) -> str:
    return str(Path(p).resolve())


def build(project_root: str) -> None:
    global _graph
    _graph = nx.DiGraph()
    root = Path(project_root)

    for py_file in root.rglob("*.py"):
        if "node_modules" in py_file.parts or ".git" in py_file.parts:
            continue
        file_node = _normalize_path(str(py_file))
        _graph.add_node(file_node, kind="file")
        try:
            tree = ast.parse(py_file.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                src = f"{file_node}:{node.name}"
                _graph.add_node(src, kind="function", file=file_node)
                _graph.add_edge(file_node, src)
                for child in ast.walk(node):
                    if isinstance(child, ast.Call) and hasattr(child.func, "id"):
                        _graph.add_edge(src, child.func.id)

    for pattern in ("*.ts", "*.tsx", "*.js", "*.jsx"):
        for ts_file in root.rglob(pattern):
            if "node_modules" in ts_file.parts or ".git" in ts_file.parts:
                continue
            file_node = _normalize_path(str(ts_file))
            _graph.add_node(file_node, kind="file")
            try:
                text = ts_file.read_text(encoding="utf-8")
            except OSError:
                continue
            for m in re.finditer(r"import\s+.*?from\s+['\"]([^'\"]+)['\"]", text):
                target = m.group(1)
                if target.startswith("."):
                    resolved = _normalize_path(str((ts_file.parent / target).resolve()))
                    _graph.add_edge(file_node, resolved)
                else:
                    _graph.add_node(target, kind="module")
                    _graph.add_edge(file_node, target)


def _matching_nodes(node: str) -> set[str]:
    if _graph is None:
        return set()
    norm = _normalize_path(node) if Path(node).exists() else node
    matches = set()
    for n in _graph.nodes:
        if n == norm or n == node:
            matches.add(n)
        elif norm in n or node in n or n.endswith(node) or node.endswith(Path(n).name):
            matches.add(n)
    if not matches and node in _graph:
        matches.add(node)
    return matches


def neighbors(node: str, depth: int = 2) -> list[str]:
    if _graph is None:
        return []

    seeds = _matching_nodes(node)
    if not seeds:
        seeds = {node}

    visited = set(seeds)
    frontier = set(seeds)

    for _ in range(depth):
        nxt: set[str] = set()
        for n in frontier:
            if n not in _graph:
                continue
            nxt.update(_graph.successors(n))
            nxt.update(_graph.predecessors(n))
        nxt -= visited
        visited.update(nxt)
        frontier = nxt

    return [n for n in visited if n not in seeds]
