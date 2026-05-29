"""Signature-extraction test. Skips automatically if tree-sitter isn't installed."""

import pytest


def test_extract_signatures_finds_a_function(tmp_path):
    pytest.importorskip("tree_sitter")
    pytest.importorskip("tree_sitter_typescript")
    from src.tree_sitter_index import extract_signatures

    f = tmp_path / "sample.ts"
    f.write_text("export function foo(x: number): number { return x + 1 }")
    sigs = extract_signatures(str(f))
    assert any(s["name"] == "foo" for s in sigs)


def test_parse_ast_is_not_implemented(tmp_path):
    pytest.importorskip("tree_sitter")
    from src.tree_sitter_index import parse_ast

    f = tmp_path / "sample.ts"
    f.write_text("export const x = 1")
    with pytest.raises(NotImplementedError):
        parse_ast(str(f))
