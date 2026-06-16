import { CREW } from "./crew.ts"
import type { ModelRef } from "@monkeydcode/llm"

// ─── ANSI ────────────────────────────────────────────────────────────────────
export const R = "\x1b[0m"
export const BOLD = "\x1b[1m"
export const DIM = "\x1b[2m"
export const YELLOW = "\x1b[33m"
export const CYAN = "\x1b[36m"
export const GREEN = "\x1b[32m"
export const RED = "\x1b[91m"
export const BLUE = "\x1b[34m"
export const MAGENTA = "\x1b[35m"
export const WHITE = "\x1b[97m"

export const SEP = `${DIM}  ${"─".repeat(70)}${R}`

// ─── Logo ─────────────────────────────────────────────────────────────────────
export const LOGO = `
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
export function printCrewRoster(): void {
    console.log(`\n${BOLD}${YELLOW}  🏴‍☠️  The Straw Hat Crew — Agent Legend${R}`)
    console.log(`${DIM}  Each crew member is a specialized AI agent. Names are from One Piece,${R}`)
    console.log(`${DIM}  but the role in brackets [ ] is what they actually do technically.${R}\n`)
    console.log(SEP)

    for (const m of Object.values(CREW)) {
        console.log(`  ${m.color}${BOLD}${m.symbol} ${m.name}${R}  ${WHITE}${BOLD}[${m.role}]${R}`)
        console.log(`  ${DIM}  ↳ ${m.what}${R}`)
        console.log(`  ${DIM}  ⚡ Activates when: ${m.trigger}${R}`)
        console.log()
    }

    console.log(SEP)
    console.log(`${DIM}  Tip: you don't need to know One Piece to use monkeyDcode.`)
    console.log(`  Just type what you need — Luffy (Orchestrator) figures out who to send.${R}\n`)
}

// ─── Help screen ──────────────────────────────────────────────────────────────
export function printInteractiveHelp(model: ModelRef, sessionId: string): void {
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
    console.log(`  ${CYAN}/model${R}   — show the active model / provider`)
    console.log(`  ${CYAN}/setup${R}   — reconfigure provider / API key`)
    console.log(`  ${CYAN}/clear${R}   — clear the screen`)
    console.log(`  ${CYAN}/status${R}  — show current agent status`)
    console.log(`  ${CYAN}/exit${R}    — quit monkeyDcode\n`)

    console.log(SEP)
    console.log(`${DIM}  monkeyDcode works with any LLM — Ollama locally or any cloud provider.${R}`)
    console.log(`${DIM}  Model: ${model.provider}/${model.id}  ·  Session: ${sessionId.slice(0, 8)}${R}\n`)
}

// ─── Header ───────────────────────────────────────────────────────────────────
export function printHeader(model: ModelRef, sessionId: string): void {
    console.clear()
    console.log(LOGO)
    console.log(SEP)
    console.log(`${DIM}  model   ${R}${CYAN}${model.provider}/${model.id}${R}`)
    console.log(`${DIM}  session ${R}${CYAN}${sessionId.slice(0, 8)}${R}`)
    console.log(`${DIM}  cwd     ${R}${CYAN}${process.cwd()}${R}`)
    console.log(SEP)

    console.log(`
  ${BOLD}Quick start:${R}
  ${DIM}Just type what you want — the agent figures out the rest.${R}

  ${GREEN}Examples:${R}
  ${DIM}  "fix the crash in login.ts"          ${R}→ ${GREEN}Zoro [Bug-Fix Agent]${R} hunts the bug
  ${DIM}  "add dark mode to the settings page" ${R}→ ${YELLOW}Nami [Feature Agent]${R} builds it
  ${DIM}  "refactor the database layer"        ${R}→ ${CYAN}Sanji [Refactor Agent]${R} restructures
  ${DIM}  paste a Python traceback             ${R}→ ${BLUE}Usopp [Debug Agent]${R} diagnoses

  ${BOLD}Commands:${R}  ${CYAN}/crew${R} ${DIM}(legend)${R}  ·  ${CYAN}/help${R} ${DIM}(usage)${R}  ·  ${CYAN}/model${R} ${DIM}(model)${R}  ·  ${CYAN}/exit${R} ${DIM}(quit)${R}
`)
    console.log(SEP)
    console.log()
}

// ─── Message helpers ──────────────────────────────────────────────────────────
export function printStatus(msg: string): void {
    process.stdout.write(`\r${DIM}  ${msg}${R}\x1b[K`)
}

export function clearStatusLine(): void {
    process.stdout.write(`\r\x1b[K`)
}

export function printUser(text: string): void {
    console.log(`\n  ${GREEN}${BOLD}you${R}`)
    console.log(`  ${text}\n`)
}

export function printAssistant(memberKey: keyof typeof CREW = "franky"): void {
    const m = CREW[memberKey]
    console.log(`\n  ${m.color}${BOLD}${m.symbol} ${m.name}${R} ${WHITE}${BOLD}[${m.role}]${R}`)
}

export function printError(msg: string): void {
    console.log(`\n  ${RED}${BOLD}💀  A Sea King appeared  ${DIM}[Runtime Error]${R}`)
    console.log(`  ${DIM}${msg}${R}\n`)
}
