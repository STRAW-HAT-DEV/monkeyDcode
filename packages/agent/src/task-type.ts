// Task-type detection. Pure and deterministic so it's cheap, testable, and
// behaves identically regardless of the underlying model. Recognising the *kind*
// of artifact a user wants lets us scaffold it and constrain the prompt instead
// of letting a generic planner over-engineer it (e.g. turning "landing page"
// into a Handlebars template + a test file).

export type TaskType =
    | "web_page"
    | "react_component"
    | "cli_script"
    | "python_script"
    | "api_endpoint"
    | "generic"

export interface TaskTypeMatch {
    type: TaskType
    confidence: number
}

interface Rule {
    type: TaskType
    patterns: RegExp[]
}

// Order matters only for ties; the highest hit-count wins.
const RULES: Rule[] = [
    {
        type: "web_page",
        patterns: [
            /landing\s*page/i,
            /\bweb\s*site\b/i,
            /\bweb\s*page\b/i,
            /\bhome\s*page\b/i,
            /\bhtml\s*page\b/i,
            /\bportfolio\b/i,
            /\bhero\s*section\b/i,
            /\bsingle[- ]page\b/i,
        ],
    },
    {
        type: "react_component",
        patterns: [
            /react\s*component/i,
            /\.tsx\b/i,
            /\buse(State|Effect|Memo|Ref)\b/,
            /\bcomponent\b.*\b(button|modal|card|nav|navbar|form|dropdown|menu)\b/i,
        ],
    },
    {
        type: "cli_script",
        patterns: [
            /\bcli\b/i,
            /command[- ]line/i,
            /\bbash\s*script\b/i,
            /\bshell\s*script\b/i,
            /\bterminal\s*tool\b/i,
        ],
    },
    {
        type: "python_script",
        patterns: [
            /python\s*script/i,
            /\.py\b/i,
            /\bin\s+python\b/i,
        ],
    },
    {
        type: "api_endpoint",
        patterns: [
            /\bapi\s*(endpoint|route)?\b/i,
            /\bendpoint\b/i,
            /\brest(ful)?\b/i,
            /\bexpress\b/i,
            /\bfastify\b/i,
        ],
    },
]

export function detectTaskType(task: string): TaskTypeMatch {
    let best: TaskTypeMatch = { type: "generic", confidence: 0 }
    for (const rule of RULES) {
        const hits = rule.patterns.filter(p => p.test(task)).length
        if (hits === 0) continue
        // 1 hit → 0.55, 2 → 0.8, 3+ → capped at 1. Enough signal to act on.
        const confidence = Math.min(1, 0.3 + hits * 0.25)
        if (confidence > best.confidence) best = { type: rule.type, confidence }
    }
    return best
}
