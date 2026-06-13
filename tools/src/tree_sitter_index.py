from pathlib import Path

import tree_sitter_python as tspython
import tree_sitter_typescript as tsts
from tree_sitter import Language, Parser

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
                    "type": "function",
                })
        for child in node.children:
            visit(child)

    visit(tree.root_node)
    return signatures


def _node_to_dict(node, source: bytes, depth: int = 0) -> dict:
    if depth > 8:
        return {"type": node.type, "truncated": True}
    children = [_node_to_dict(c, source, depth + 1) for c in node.children[:20]]
    text = source[node.start_byte:node.end_byte].decode(errors="replace")
    if len(text) > 120:
        text = text[:117] + "..."
    return {
        "type": node.type,
        "text": text,
        "line": node.start_point[0] + 1,
        "children": children,
    }


def parse_ast(file: str) -> dict:
    path = Path(file)
    lang = LANGUAGES.get(path.suffix)
    if not lang:
        return {"file": file, "type": "unknown", "children": []}

    parser = Parser(lang)
    source = path.read_bytes()
    tree = parser.parse(source)
    return {
        "file": file,
        "type": "ast",
        "root": _node_to_dict(tree.root_node, source),
    }
