#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${MONKEYDCODE_HOME:-$HOME/.monkeydcode}"
BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[91m"
RESET="\033[0m"

echo -e "${YELLOW}${BOLD}"
echo "        _____________________________________________"
echo "    ___/  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~   \___"
echo "   /                                                     \\"
echo "   \_____________________________________________________/${RESET}"
echo -e "${CYAN}${BOLD}  monkeyDcode — Installing...${RESET}"
echo -e "${RED}  \"I'm gonna be the King of the Coding Agents!\"${RESET}"
echo ""

# ─── Check dependencies ───────────────────────────────────────────────────────
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
echo -e "  ${GREEN}✓ Git$(git --version | awk '{print $3}')${RESET}"

if ! command -v python3 &>/dev/null; then
    echo -e "${YELLOW}⚠️  Python3 not found — Python bridge tools will be unavailable.${RESET}"
else
    echo -e "  ${GREEN}✓ Python $(python3 --version | awk '{print $2}')${RESET}"
fi

echo ""

# ─── Clone or update ──────────────────────────────────────────────────────────
echo -e "⚓ ${BOLD}Setting sail to $INSTALL_DIR...${RESET}"

if [ -d "$INSTALL_DIR/.git" ]; then
    echo -e "  Updating existing installation..."
    git -C "$INSTALL_DIR" pull --ff-only
else
    echo -e "  Cloning monkeyDcode..."
    git clone https://github.com/shaikashfaaqhamja/monkeyDcode "$INSTALL_DIR"
fi

echo ""

# ─── Install JS dependencies ──────────────────────────────────────────────────
echo -e "🔧 ${BOLD}Franky is building... (bun install)${RESET}"
bun install --cwd "$INSTALL_DIR"
echo ""

# ─── Setup Python bridge ──────────────────────────────────────────────────────
if command -v python3 &>/dev/null; then
    echo -e "🌸 ${BOLD}Robin is setting up the Python bridge...${RESET}"
    bash "$INSTALL_DIR/scripts/setup-python.sh"
    echo ""
fi

# ─── Install binary ───────────────────────────────────────────────────────────
echo -e "🗡️  ${BOLD}Zoro is linking the blade...${RESET}"
chmod +x "$INSTALL_DIR/bin/mdc"

if [ -w "/usr/local/bin" ]; then
    ln -sf "$INSTALL_DIR/bin/mdc" /usr/local/bin/mdc
    echo -e "  ${GREEN}✓ Linked to /usr/local/bin/mdc${RESET}"
else
    mkdir -p "$HOME/.local/bin"
    ln -sf "$INSTALL_DIR/bin/mdc" "$HOME/.local/bin/mdc"
    echo -e "  ${GREEN}✓ Linked to ~/.local/bin/mdc${RESET}"
    echo -e "  ${YELLOW}Add ~/.local/bin to your PATH if not already there.${RESET}"
fi

# ─── Create default config ────────────────────────────────────────────────────
CONFIG_DIR="$HOME/.config/monkeydcode"
CONFIG_FILE="$CONFIG_DIR/config.toml"
mkdir -p "$CONFIG_DIR"

if [ ! -f "$CONFIG_FILE" ]; then
    cp "$INSTALL_DIR/scripts/config.default.toml" "$CONFIG_FILE"
    echo -e "  ${GREEN}✓ Config created at $CONFIG_FILE${RESET}"
fi

echo ""
echo -e "${GREEN}${BOLD}🏴‍☠️  Installation complete!${RESET}"
echo ""
echo -e "  Run ${CYAN}${BOLD}mdc${RESET} to start."
echo -e "  Edit ${CYAN}$CONFIG_FILE${RESET} to set your model and API keys."
echo ""
