import ast
from pathlib import Path

import networkx as nx

_graph = None

def build(project_root: str) -> None:
    global _graph
    _graph = nx.DiGraph()
    for py_file in Path(project_root).rglob("*.py"):
        tree = ast.parse(py_file.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                src = f"{py_file}:{node.name}"
                _graph.add_node(src, file=str(py_file))
                for child in ast.walk(node):
                    if isinstance(child, ast.Call) and hasattr(child.func, "id"):
                        _graph.add_edge(src, child.func.id)


def neighbors(node: str, depth: int = 2) -> list[str]:
    if _graph is None:
        return []
    visited = {node}
    frontier = {node}
    for _ in range(depth):
        nxt = set()
        for n in frontier:
            if n in _graph:
                nxt.update(_graph.successors(n))
                nxt.update(_graph.predecessors(n))
        nxt -= visited
        visited.update(nxt)
        frontier = nxt
    return list(visited - {node})
