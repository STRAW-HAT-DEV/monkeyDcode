#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${MONKEYDCODE_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
TOOLS_DIR="$INSTALL_DIR/tools"

echo "  Setting up Python bridge (tree-sitter, vector store, knowledge graph)..."

if ! command -v uv &>/dev/null; then
    echo "  uv not found — installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

cd "$TOOLS_DIR"
uv venv --python python3 2>/dev/null || uv venv
uv sync

echo "  Python bridge ready."
