import { createInterface } from "readline"
import { Runner } from "@monkeydcode/engine/session/runner"
import { ollama } from "@monkeydcode/llm/providers/ollama"
import type { ModelRef } from "@monkeydcode/llm"

const MODEL: ModelRef = ollama.model("qwen2.5-coder:7b")
const session = Runner.createSession(process.cwd())

// ─── ANSI ────────────────────────────────────────────────────────────────────
const R    = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM  = "\x1b[2m"
const YELLOW  = "\x1b[33m"
const CYAN    = "\x1b[36m"
const GREEN   = "\x1b[32m"
const RED     = "\x1b[91m"
const MAGENTA = "\x1b[35m"

// ─── Logo ─────────────────────────────────────────────────────────────────────
const LOGO = `
${YELLOW}${BOLD}                    _______________________________
                 __/                               \\__
                /   ~  ~  ~  ~  ~  ~  ~  ~  ~  ~    \\
               /   ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~   \\
     _________/___________________________________________\\_________
    /  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~   \\
   /  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  \\
  '________________________________________________________________________'${R}

${CYAN}${BOLD}  ███╗   ███╗ ██████╗ ███╗  ██╗██╗ ██╗███████╗██╗   ██╗${R}
${CYAN}${BOLD}  ████╗ ████║██╔═══██╗████╗ ██║██║██╔╝██╔════╝╚██╗ ██╔╝${R}
${CYAN}${BOLD}  ██╔████╔██║██║   ██║██╔██╗██║█████╔╝ █████╗   ╚████╔╝${R}
${CYAN}${BOLD}  ██║╚██╔╝██║██║   ██║██║╚████║██╔═██╗ ██╔══╝    ╚██╔╝${R}
${CYAN}${BOLD}  ██║ ╚═╝ ██║╚██████╔╝██║ ╚███║██║  ██╗███████╗   ██║${R}
${CYAN}${BOLD}  ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚══╝╚═╝  ╚═╝╚══════╝   ╚═╝${R}

${MAGENTA}${BOLD}  ·  ·  ·  ·  ·  ·  ·  ·  · ${R}${RED}${BOLD}  ██████╗  ${R}${MAGENTA}${BOLD} ·  ·  ·  ·  ·  ·  ·  ·  ·${R}
${MAGENTA}${BOLD}  ·  ·  ·  ·  ·  ·  ·  ·  · ${R}${RED}${BOLD} ██╔══██╗ ${R}${MAGENTA}${BOLD} ·  ·  ·  ·  ·  ·  ·  ·  ·${R}
${MAGENTA}${BOLD}  ·  ·  ·  ·  ·  ·  ·  ·  · ${R}${RED}${BOLD} ██║  ██║ ${R}${MAGENTA}${BOLD} ·  ·  ·  ·  ·  ·  ·  ·  ·${R}
${MAGENTA}${BOLD}  ·  ·  ·  ·  ·  ·  ·  ·  · ${R}${RED}${BOLD} ██║  ██║ ${R}${MAGENTA}${BOLD} ·  ·  ·  ·  ·  ·  ·  ·  ·${R}
${MAGENTA}${BOLD}  ·  ·  ·  ·  ·  ·  ·  ·  · ${R}${RED}${BOLD} ██████╔╝ ${R}${MAGENTA}${BOLD} ·  ·  ·  ·  ·  ·  ·  ·  ·${R}
${MAGENTA}${BOLD}  ·  ·  ·  ·  ·  ·  ·  ·  · ${R}${RED}${BOLD} ╚═════╝  ${R}${MAGENTA}${BOLD} ·  ·  ·  ·  ·  ·  ·  ·  ·${R}

${YELLOW}${BOLD}   ██████╗ ██████╗ ██████╗ ███████╗${R}
${YELLOW}${BOLD}  ██╔════╝██╔═══██╗██╔══██╗██╔════╝${R}
${YELLOW}${BOLD}  ██║     ██║   ██║██║  ██║█████╗${R}
${YELLOW}${BOLD}  ██║     ██║   ██║██║  ██║██╔══╝${R}
${YELLOW}${BOLD}  ╚██████╗╚██████╔╝██████╔╝███████╗${R}
${YELLOW}${BOLD}   ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝${R}

${RED}${BOLD}  "I'm gonna be the king of the coding agents!"${R}
`

// ─── Separator ────────────────────────────────────────────────────────────────
const SEP = `${DIM}  ${"─".repeat(70)}${R}`

function printHeader() {
    console.clear()
    console.log(LOGO)
    console.log(SEP)
    console.log(`${DIM}  model   ${R}${CYAN}${MODEL.provider}/${MODEL.id}${R}`)
    console.log(`${DIM}  session ${R}${CYAN}${session.id.slice(0, 8)}${R}`)
    console.log(`${DIM}  /exit to quit${R}`)
    console.log(SEP)
    console.log()
}

function printUser(text: string) {
    console.log(`\n  ${GREEN}${BOLD}you${R}`)
    console.log(`  ${text}\n`)
}

function printAssistantStart() {
    process.stdout.write(`\n  ${YELLOW}${BOLD}assistant${R}\n  `)
}

function printError(msg: string) {
    console.log(`\n  ${RED}${BOLD}error${R}  ${msg}\n`)
}

// ─── Main loop ────────────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout })

printHeader()

function prompt() {
    rl.question(`${CYAN}>${R} `, async (raw) => {
        const text = raw.trim()
        if (!text) { prompt(); return }
        if (text === "/exit" || text === "/quit") {
            console.log(`\n${YELLOW}${BOLD}  Yohohoho! Until next time, King.${R}\n`)
            rl.close()
            return
        }

        printUser(text)
        printAssistantStart()

        try {
            for await (const delta of Runner.streamChat(session.id, text, MODEL)) {
                process.stdout.write(delta)
            }
        } catch (e) {
            printError(e instanceof Error ? e.message : String(e))
        }

        console.log("\n")
        prompt()
    })
}

prompt()
