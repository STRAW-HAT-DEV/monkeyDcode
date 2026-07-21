import { VERSION } from "./version.ts"

export type CliMode = "interactive" | "oneshot" | "help" | "version" | "doctor" | "setup" | "shell-init" | "mcp-server" | "acp"
export { VERSION }

export interface CliArgs {
    mode: CliMode
    task?: string
    shell?: "bash" | "zsh" | "fish" | "powershell"
}

const BANNER = `
  __  __                         _       ____          _
 |  \\/  | ___  _ __   __ _ _   _| | __  |  _ \\ ___  __| | ___ _ __
 | |\\/| |/ _ \\| '_ \\ / _\` | | | | |/ /  | | | / _ \\/ _\` |/ _ \\ '__|
 | |  | | (_) | | | | (_| | |_| |   <   | |_| |  __/ (_| |  __/ |
 |_|  |_|\\___/|_| |_|\\__,_|\\__,_|_|\\_\\  |____/ \\___|\\__,_|\\___|_|
`

export function printBanner(): void {
    console.log(BANNER)
    console.log(`  v${VERSION} — consistent code from Qwen 7B to Opus`)
    console.log("")
}

export function printHelp(): void {
    printBanner()
    console.log(`Usage:
  mdc                    Start interactive agent (like \`claude\`)
  mdc "your task here"   Run one task and exit
  mdc setup              Reconfigure model / API key
  mdc doctor             Check dependencies
  mdc version            Show version
  mdc shell-init bash    Print shell hook (optional)
  mdc mcp-server          Run monkeyDcode as an MCP server (stdio) — exposes
                          mdc_build/mdc_verify/mdc_check_assets to MCP clients
  mdc acp                 Run monkeyDcode as an ACP agent (stdio) — for
                          editors that speak the Agent Client Protocol (Zed, etc.)

Global install:
  macOS/Linux:  curl -fsSL .../install.sh | bash
  Windows:      .\\scripts\\install.ps1

First run walks you through provider + API key setup automatically.

In the TUI, slash commands:
  /help   /model   /setup   /clear   /quit

Environment:
  MDCODE_RECONFIGURE=1   Force setup wizard on next start
  MDCODE_SKIP_SETUP=1    Skip wizard (CI/tests)
  MDCODE_ECHO=1          Engine echo mode (no orchestrator)
`)
}

export function parseArgv(argv: string[]): CliArgs {
    const args = argv.filter(a => a !== "--")
    if (args.length === 0) return { mode: "interactive" }

    const first = args[0]!
    if (first === "--help" || first === "-h" || first === "help") return { mode: "help" }
    if (first === "--version" || first === "-v" || first === "version") return { mode: "version" }
    if (first === "doctor" || first === "check") return { mode: "doctor" }
    if (first === "setup" || first === "configure" || first === "config") return { mode: "setup" }
    if (first === "mcp-server") return { mode: "mcp-server" }
    if (first === "acp") return { mode: "acp" }
    if (first === "shell-init") {
        const shell = (args[1] ?? "bash") as CliArgs["shell"]
        return { mode: "shell-init", shell }
    }

    return { mode: "oneshot", task: args.join(" ") }
}

export async function runDoctor(): Promise<number> {
    printBanner()
    console.log("Checking dependencies...\n")
    let ok = true

    const checks: Array<{ name: string; cmd: () => Promise<boolean>; hint: string }> = [
        {
            name: "Bun",
            cmd: async () => {
                try {
                    const p = Bun.spawn(["bun", "--version"], { stdout: "pipe" })
                    const code = await p.exited
                    if (code === 0) {
                        const v = await new Response(p.stdout).text()
                        console.log(`  ✓ Bun ${v.trim()}`)
                        return true
                    }
                } catch {}
                return false
            },
            hint: "Install Bun: https://bun.sh",
        },
        {
            name: "Git",
            cmd: async () => {
                try {
                    const p = Bun.spawn(["git", "--version"], { stdout: "pipe" })
                    const code = await p.exited
                    if (code === 0) {
                        console.log(`  ✓ ${(await new Response(p.stdout).text()).trim()}`)
                        return true
                    }
                } catch {}
                return false
            },
            hint: "Install Git: https://git-scm.com",
        },
        {
            name: "Python (optional)",
            cmd: async () => {
                for (const bin of ["python3", "python"]) {
                    try {
                        const p = Bun.spawn([bin, "--version"], { stdout: "pipe" })
                        if ((await p.exited) === 0) {
                            console.log(`  ✓ ${(await new Response(p.stdout).text()).trim()}`)
                            return true
                        }
                    } catch {}
                }
                console.log("  ⚠ Python not found — bridge tools use regex fallback")
                return true
            },
            hint: "",
        },
        {
            name: "uv (optional)",
            cmd: async () => {
                try {
                    const p = Bun.spawn(["uv", "--version"], { stdout: "pipe" })
                    if ((await p.exited) === 0) {
                        console.log(`  ✓ ${(await new Response(p.stdout).text()).trim()}`)
                        return true
                    }
                } catch {}
                console.log("  ⚠ uv not found — run scripts/setup-python.sh after installing uv")
                return true
            },
            hint: "Install uv: https://docs.astral.sh/uv/",
        },
    ]

    for (const c of checks) {
        const pass = await c.cmd()
        if (!pass) {
            console.log(`  ✗ ${c.name} missing — ${c.hint}`)
            if (c.name === "Bun" || c.name === "Git") ok = false
        }
    }

    console.log("")
    if (ok) {
        console.log("Ready. Run `mdc` to start (first run opens model setup).")
        return 0
    }
    console.log("Fix the items above, then run `mdc doctor` again.")
    return 1
}

export function printShellInit(shell: CliArgs["shell"]): void {
    switch (shell) {
        case "zsh":
        case "bash":
            console.log(`# Add to ~/.${shell === "zsh" ? "zshrc" : "bashrc"}
# monkeyDcode — run from any directory (like claude)
mdc() { command mdc "$@"; }
alias monkeydcode='mdc'
`)
            break
        case "fish":
            console.log(`# Add to ~/.config/fish/config.fish
function mdc; command mdc $argv; end
alias monkeydcode='mdc'
`)
            break
        case "powershell":
            console.log(`# Add to $PROFILE
function mdc { & (Get-Command mdc).Source @args }
Set-Alias monkeydcode mdc
`)
            break
        default:
            console.log("# Unsupported shell — use `mdc` directly if it is on your PATH")
    }
}
