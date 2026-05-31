import { createInterface } from "readline"
import { Runner } from "@monkeydcode/engine/session/runner"
import { ollama } from "@monkeydcode/llm/providers/ollama"
import type { ModelRef } from "@monkeydcode/llm"
import { CREW, STATUS } from "./crew.ts"

const MODEL: ModelRef = ollama.model("qwen2.5-coder:7b")
const session = Runner.createSession(process.cwd())

// ─── ANSI ────────────────────────────────────────────────────────────────────
const R       = "\x1b[0m"
const BOLD    = "\x1b[1m"
const DIM     = "\x1b[2m"
const YELLOW  = "\x1b[33m"
const CYAN    = "\x1b[36m"
const GREEN   = "\x1b[32m"
const RED     = "\x1b[91m"
const MAGENTA = "\x1b[35m"
const WHITE   = "\x1b[97m"

const SEP = `${DIM}  ${"─".repeat(70)}${R}`

// ─── Logo ─────────────────────────────────────────────────────────────────────
const LOGO = `
${YELLOW}${BOLD}        _____________________________________________
    ___/  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~   \\___
   /                                                     \\
   \\_____________________________________________________/${R}

${CYAN}${BOLD}  ███╗   ███╗ ██████╗ ███╗  ██╗██╗ ██╗███████╗██╗   ██╗${R}
${CYAN}${BOLD}  ████╗ ████║██╔═══██╗████╗ ██║██║██╔╝██╔════╝╚██╗ ██╔╝${R}
${CYAN}${BOLD}  ██╔████╔██║██║   ██║██╔██╗██║█████╔╝ █████╗   ╚████╔╝${R}
${CYAN}${BOLD}  ██║╚██╔╝██║██║   ██║██║╚████║██╔═██╗ ██╔══╝    ╚██╔╝${R}
${CYAN}${BOLD}  ██║ ╚═╝ ██║╚██████╔╝██║ ╚███║██║  ██╗███████╗   ██║${R}
${CYAN}${BOLD}  ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚══╝╚═╝  ╚═╝╚══════╝   ╚═╝${R}

${MAGENTA}${BOLD}  ·  ·  ·  ·  · ${R}${RED}${BOLD} ██████╗  ${R}${MAGENTA}${BOLD} ·  ·  ·  ·  ·${R}
${MAGENTA}${BOLD}  ·  ·  ·  ·  · ${R}${RED}${BOLD} ██   ██╗ ${R}${MAGENTA}${BOLD} ·  ·  ·  ·  ·${R}
${MAGENTA}${BOLD}  ·  ·  ·  ·  · ${R}${RED}${BOLD} ██    ██║${R}${MAGENTA}${BOLD} ·  ·  ·  ·  ·${R}
${MAGENTA}${BOLD}  ·  ·  ·  ·  · ${R}${RED}${BOLD} ██   ██╝ ${R}${MAGENTA}${BOLD} ·  ·  ·  ·  ·${R}
${MAGENTA}${BOLD}  ·  ·  ·  ·  · ${R}${RED}${BOLD} ██████╝  ${R}${MAGENTA}${BOLD} ·  ·  ·  ·  ·${R}
${MAGENTA}${BOLD}  ·  ·  ·  ·  ·  ${R}${MAGENTA}${BOLD}          ·  ·  ·  ·  ·${R}

${YELLOW}${BOLD}   ██████╗ ██████╗ ██████╗  ███████╗${R}
${YELLOW}${BOLD}  ██╔════╝██╔═══██╗██   ██╗ ██╔════╝${R}
${YELLOW}${BOLD}  ██║     ██║   ██║██    ██║█████╗  ${R}
${YELLOW}${BOLD}  ██║     ██║   ██║██   ██╝ ██╔══╝  ${R}
${YELLOW}${BOLD}  ╚██████╗╚██████╔╝██████╝  ███████╗${R}
${YELLOW}${BOLD}   ╚═════╝ ╚═════╝          ╚══════╝${R}

${RED}${BOLD}  "I'm gonna be the King of the Coding Agents!"${R}
`

// ─── Crew Legend ─────────────────────────────────────────────────────────────
function printCrewRoster() {
    console.log(`\n${BOLD}${YELLOW}  🏴‍☠️  The Straw Hat Crew — Agent Legend${R}`)
    console.log(`${DIM}  Each crew member is a specialized AI agent. Names are from One Piece,${R}`)
    console.log(`${DIM}  but the role in brackets [ ] is what they actually do technically.${R}\n`)
    console.log(SEP)

    for (const m of Object.values(CREW)) {
        // Name + role line
        console.log(`  ${m.color}${BOLD}${m.symbol} ${m.name}${R}  ${WHITE}${BOLD}[${m.role}]${R}`)
        // What they do
        console.log(`  ${DIM}  ↳ ${m.what}${R}`)
        // When they activate
        console.log(`  ${DIM}  ⚡ Activates when: ${m.trigger}${R}`)
        console.log()
    }

    console.log(SEP)
    console.log(`${DIM}  Tip: you don't need to know One Piece to use monkeyDcode.`)
    console.log(`  Just type what you need — Luffy (Orchestrator) figures out who to send.${R}\n`)
}

// ─── Help screen ──────────────────────────────────────────────────────────────
function printHelp() {
    console.log(`\n${BOLD}  📖 monkeyDcode — How to use${R}\n`)
    console.log(SEP)

    console.log(`\n${BOLD}  💬 Just type naturally:${R}`)
    console.log(`  ${DIM}"fix the bug in auth.ts"${R}          → Zoro (Bug-Fix Agent) takes over`)
    console.log(`  ${DIM}"add pagination to the users API"${R}  → Nami (Feature Agent) charts the course`)
    console.log(`  ${DIM}"refactor src/api.ts"${R}              → Sanji (Refactor Agent) restructures`)
    console.log(`  ${DIM}"why is getUsers returning null"${R}   → Usopp (Debug Agent) investigates`)
    console.log(`  ${DIM}paste a stack trace${R}                → Usopp (Debug Agent) snipes the cause`)

    console.log(`\n${BOLD}  🛡️  What happens automatically:${R}`)
    console.log(`  ${DIM}Every code change runs: syntax → typecheck → lint → tests${R}`)
    console.log(`  ${DIM}Robin (Review Agent) checks every result for bugs and security holes${R}`)
    console.log(`  ${DIM}Chopper (Context Memory) tracks your goal and completed steps${R}`)

    console.log(`\n${BOLD}  ⌨️  Commands:${R}`)
    console.log(`  ${CYAN}/crew${R}    — full legend of all crew members and what they do`)
    console.log(`  ${CYAN}/help${R}    — this screen`)
    console.log(`  ${CYAN}/status${R}  — show current agent status`)
    console.log(`  ${CYAN}/exit${R}    — quit monkeyDcode\n`)

    console.log(SEP)
    console.log(`${DIM}  monkeyDcode works with any LLM — Ollama locally or any cloud provider.${R}`)
    console.log(`${DIM}  Model: ${MODEL.provider}/${MODEL.id}  ·  Session: ${session.id.slice(0, 8)}${R}\n`)
}

// ─── Header ───────────────────────────────────────────────────────────────────
function printHeader() {
    console.clear()
    console.log(LOGO)
    console.log(SEP)
    console.log(`${DIM}  model   ${R}${CYAN}${MODEL.provider}/${MODEL.id}${R}`)
    console.log(`${DIM}  session ${R}${CYAN}${session.id.slice(0, 8)}${R}`)
    console.log(SEP)

    // Quick-start guide — always visible
    console.log(`
  ${BOLD}Quick start:${R}
  ${DIM}Just type what you want — the agent figures out the rest.${R}

  ${GREEN}Examples:${R}
  ${DIM}  "fix the crash in login.ts"          ${R}→ ${GREEN}Zoro [Bug-Fix Agent]${R} hunts the bug
  ${DIM}  "add dark mode to the settings page" ${R}→ ${YELLOW}Nami [Feature Agent]${R} builds it
  ${DIM}  "refactor the database layer"        ${R}→ ${CYAN}Sanji [Refactor Agent]${R} restructures
  ${DIM}  paste a Python traceback             ${R}→ ${"\x1b[34m"}Usopp [Debug Agent]${R} diagnoses

  ${BOLD}Commands:${R}  ${CYAN}/crew${R} ${DIM}(full agent legend)${R}  ·  ${CYAN}/help${R} ${DIM}(usage guide)${R}  ·  ${CYAN}/exit${R} ${DIM}(quit)${R}
`)
    console.log(SEP)
    console.log()
}

// ─── Message helpers ──────────────────────────────────────────────────────────
function printStatus(msg: string) {
    process.stdout.write(`\r${DIM}  ${msg}${R}\x1b[K`)
}

function printUser(text: string) {
    console.log(`\n  ${GREEN}${BOLD}you${R}`)
    console.log(`  ${text}\n`)
}

function printAssistantStart(memberKey: keyof typeof CREW = "franky") {
    const m = CREW[memberKey]
    console.log(`\n  ${m.color}${BOLD}${m.symbol} ${m.name}${R} ${WHITE}${BOLD}[${m.role}]${R}`)
    process.stdout.write("  ")
}

function printError(msg: string) {
    console.log(`\n  ${RED}${BOLD}💀  A Sea King appeared  ${DIM}[Runtime Error]${R}`)
    console.log(`  ${DIM}${msg}${R}\n`)
}

// ─── Commands ────────────────────────────────────────────────────────────────
const COMMANDS: Record<string, () => void> = {
    "/crew":   printCrewRoster,
    "/help":   printHelp,
    "/status": () => console.log(`\n  ${YELLOW}${STATUS.idle}${R}\n`),
}

// ─── Main loop ────────────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout })

printHeader()
printStatus(STATUS.idle)
process.stdout.write("\n\n")

function prompt() {
    rl.question(`${CYAN}>${R} `, async (raw: string) => {
        const text = raw.trim()
        if (!text) { prompt(); return }

        if (text === "/exit" || text === "/quit") {
            console.log(`\n${YELLOW}${BOLD}  🏴‍☠️  ${CREW.luffy.tagline}${R}`)
            console.log(`${DIM}  Until next time, Nakama.${R}\n`)
            rl.close()
            return
        }

        if (COMMANDS[text]) {
            COMMANDS[text]!()
            prompt()
            return
        }

        printUser(text)
        printStatus(STATUS.classify)
        printAssistantStart()

        try {
            let full = ""
            for await (const delta of Runner.streamChat(session.id, text, MODEL)) {
                full += delta
                process.stdout.write(delta)
            }
            console.log("\n")
            console.log(`  ${DIM}${STATUS.done}${R}`)
        } catch (e) {
            printError(e instanceof Error ? e.message : String(e))
        }

        console.log()
        prompt()
    })
}

prompt()
