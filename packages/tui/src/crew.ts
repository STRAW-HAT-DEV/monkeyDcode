// ─── Straw Hat Crew ─────────────────────────────────────────────────────────
// Each crew member = a specialized sub-agent.
// The crew name is the One Piece character. The role is what they actually do.

export const CREW = {
    luffy: {
        name: "Luffy",
        role: "Orchestrator",
        title: "Captain · Orchestrator",
        color: "\x1b[91m",
        symbol: "🏴‍☠️",
        trigger: "Every message — he decides who to send",
        what: "Reads your message, picks the right crew member, and kicks off the mission.",
        tagline: "I'm gonna be King of the Coding Agents!",
    },
    zoro: {
        name: "Zoro",
        role: "Bug-Fix Agent",
        title: "Swordsman · Bug-Fix Agent",
        color: "\x1b[32m",
        symbol: "⚔️ ",
        trigger: "\"fix\", \"bug\", \"broken\", \"crash\", \"error\"",
        what: "Reproduces the bug with a failing test first, then cuts the root cause. Never patches symptoms.",
        tagline: "Nothing happened. (bug deleted)",
    },
    nami: {
        name: "Nami",
        role: "Feature Agent",
        title: "Navigator · Feature Agent",
        color: "\x1b[33m",
        symbol: "🗺️ ",
        trigger: "\"add\", \"build\", \"implement\", \"create\", \"new feature\"",
        what: "Clarifies the spec, plans the route, builds scaffold first then implementation, writes tests.",
        tagline: "I've already mapped the perfect route.",
    },
    usopp: {
        name: "Usopp",
        role: "Debug Agent",
        title: "Sniper · Debug Agent",
        color: "\x1b[34m",
        symbol: "🎯 ",
        trigger: "Stack traces, tracebacks, \"why is this\", \"not working\"",
        what: "Generates hypotheses, tests each one from most to least likely, fixes the confirmed cause.",
        tagline: "I sniped the root cause from 8000 meters.",
    },
    sanji: {
        name: "Sanji",
        role: "Refactor Agent",
        title: "Cook · Refactor Agent",
        color: "\x1b[36m",
        symbol: "🦵 ",
        trigger: "\"refactor\", \"clean up\", \"restructure\", \"reorganize\"",
        what: "Reads first, touches second. Preserves all existing behavior — verified before and after.",
        tagline: "This code needed restructuring. I obliged.",
    },
    robin: {
        name: "Robin",
        role: "Review Agent",
        title: "Archaeologist · Review Agent",
        color: "\x1b[35m",
        symbol: "🌸 ",
        trigger: "Automatically runs after every task",
        what: "3-round Actor-Critic-Consensus review. Finds bugs, security holes, missing edge cases.",
        tagline: "I can kill you in 30 ways. I found 3 bugs.",
    },
    franky: {
        name: "Franky",
        role: "Build Agent",
        title: "Shipwright · Build Agent",
        color: "\x1b[96m",
        symbol: "🔧 ",
        trigger: "Runs every plan step — called by Luffy, Nami, Zoro, Usopp, Sanji",
        what: "Executes the actual code changes. Uses multi-temperature sampling + verification pipeline.",
        tagline: "SUPER! Built and verified.",
    },
    chopper: {
        name: "Chopper",
        role: "Context Memory",
        title: "Doctor · Context Memory",
        color: "\x1b[95m",
        symbol: "🦌 ",
        trigger: "Always active in the background",
        what: "Tracks goals, completed steps, constraints. Retrieves relevant code context before every change.",
        tagline: "I remember everything about this project.",
    },
} as const

export type CrewMember = keyof typeof CREW

// ─── Status messages ─────────────────────────────────────────────────────────

export const STATUS = {
    idle:       "⚓ Waiting at the Grand Line...",
    classify:   "🎩 Luffy (Orchestrator): What kinda adventure is this??",
    planning:   "🗺️  Nami (Feature Agent): Plotting the course...",
    building:   "🔧 Franky (Build Agent): SUPER! Building...",
    verifying:  "⚡ Robin (Review Agent): Running Observation Haki — verification...",
    typecheck:  "⚡ Haki check — typecheck...",
    lint:       "🗡️  Zoro (Bug-Fix): Polishing the blade — lint...",
    syntax:     "📖 Robin (Review): Scanning for syntax errors...",
    tests:      "⚓ Running the gauntlet — tests...",
    reviewing:  "🌸 Robin (Review Agent): Hana Hana no Mi — Code Review!",
    bugfix:     "⚔️  Zoro (Bug-Fix Agent): Three-sword style — BUG HUNT!",
    feature:    "🗺️  Nami (Feature Agent): Charting the course to new features...",
    refactor:   "🦵 Sanji (Refactor Agent): Black Leg Style — restructuring!",
    debug:      "🎯 Usopp (Debug Agent): Sniping the root cause from 8000 meters...",
    done:       "🏴‍☠️  Mission complete. I'm gonna be King of the Coding Agents!",
    error:      "💀 A Sea King appeared — something went wrong",
    retry:      "💪 Gear Second! Retrying at max speed...",
} as const

// ─── Tool display names ───────────────────────────────────────────────────────

export const TOOL_NAMES: Record<string, string> = {
    read:           "📖 Robin (Review) reads",
    write:          "✍️  Franky (Build) writes",
    edit:           "🗡️  Zoro (Bug-Fix) edits",
    grep:           "🔍 Usopp (Debug) scouts",
    glob:           "🗺️  Nami (Feature) scans",
    bash:           "🔧 Franky (Build) runs",
    verify:         "🛡️  Verification pipeline (syntax→typecheck→lint→tests)",
    typecheck:      "⚡ Typecheck — Haki check",
    lint:           "🗡️  Lint — blade polish",
    "bun test":     "⚓ Tests — battle gauntlet",
    lsp_hover:      "🌸 Robin (Review): LSP hover inspect",
    lsp_definition: "📖 Robin (Review): LSP go-to-definition",
    lsp_references: "🔍 Usopp (Debug): LSP find-references",
    webfetch:       "🌊 Den Den Mushi — web fetch",
}

export function toolDisplay(toolName: string): string {
    return TOOL_NAMES[toolName] ?? `🔧 ${toolName}`
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

export function progressBar(current: number, total: number, width = 20): string {
    if (total === 0) return ""
    const pct = Math.min(1, current / total)
    const filled = Math.round(pct * width)
    const bar = "⚓".repeat(filled) + "·".repeat(width - filled)
    return `GOMU GOMU NO... [${bar}] ${Math.round(pct * 100)}%  step ${current}/${total}`
}
