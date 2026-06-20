#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${MONKEYDCODE_HOME:-$HOME/.monkeydcode}"
REPO_URL="${MONKEYDCODE_REPO:-https://github.com/STRAW-HAT-DEV/monkeyDcode.git}"
BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[91m"
RESET="\033[0m"

echo -e "${CYAN}${BOLD}  monkeyDcode — Installing...${RESET}"
echo ""

echo -e "🔍 ${BOLD}Checking dependencies...${RESET}"

if ! command -v bun &>/dev/null; then
    echo -e "${RED}❌ Bun not found. Install from https://bun.sh${RESET}"
    exit 1
fi
echo -e "  ${GREEN}✓ Bun $(bun --version)${RESET}"

if ! command -v git &>/dev/null; then
    echo -e "${RED}❌ Git not found.${RESET}"
    exit 1
fi
echo -e "  ${GREEN}✓ Git $(git --version | awk '{print $3}')${RESET}"

echo ""

# Clone or use existing repo
if [ -f "$(dirname "$0")/../package.json" ] && [ "${MONKEYDCODE_INSTALL_FROM_REPO:-}" = "1" ]; then
    INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
    echo -e "⚓ Using current repo at $INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
    echo -e "⚓ Updating $INSTALL_DIR..."
    git -C "$INSTALL_DIR" pull --ff-only
else
    echo -e "⚓ Cloning to $INSTALL_DIR..."
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

echo ""
echo -e "🔧 ${BOLD}bun install${RESET}"
bun install --cwd "$INSTALL_DIR"

if command -v python3 &>/dev/null || command -v python &>/dev/null; then
    echo ""
    echo -e "🌸 ${BOLD}Python bridge${RESET}"
    bash "$INSTALL_DIR/scripts/setup-python.sh"
fi

echo ""
echo -e "🗡️  ${BOLD}Linking global commands: mdc, monkeydcode${RESET}"
chmod +x "$INSTALL_DIR/bin/mdc" "$INSTALL_DIR/bin/monkeydcode"

link_bin() {
    local name="$1"
    local target="$INSTALL_DIR/bin/$name"
    if [ -w "/usr/local/bin" ]; then
        ln -sf "$target" "/usr/local/bin/$name"
        echo -e "  ${GREEN}✓ /usr/local/bin/$name${RESET}"
    else
        mkdir -p "$HOME/.local/bin"
        ln -sf "$target" "$HOME/.local/bin/$name"
        echo -e "  ${GREEN}✓ ~/.local/bin/$name${RESET}"
    fi
}

link_bin mdc
link_bin monkeydcode

if ! echo ":$PATH:" | grep -q ":$HOME/.local/bin:"; then
    echo -e "  ${YELLOW}Add to ~/.bashrc or ~/.zshrc:${RESET}"
    echo -e "  ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}"
fi

echo ""
echo -e "${GREEN}${BOLD}✅ Installation complete!${RESET}"
echo ""
echo -e "  ${CYAN}${BOLD}mdc${RESET}              Start agent (like ${CYAN}claude${RESET})"
echo -e "  ${CYAN}mdc setup${RESET}        Configure provider + API key"
echo -e "  ${CYAN}mdc doctor${RESET}       Check dependencies"
echo -e "  ${CYAN}mdc \"your task\"${RESET}  One-shot"
echo ""
echo -e "  First run opens an interactive model setup wizard."
echo ""
