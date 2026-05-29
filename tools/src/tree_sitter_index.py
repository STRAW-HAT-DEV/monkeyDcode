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
                    "type": "function"
                })
        for child in node.children:
            visit(child)

    visit(tree.root_node)
    return signatures


def parse_ast(file: str) -> dict:
    # Returns simplified AST as nested dict
    pass
