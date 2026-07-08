import { homedir } from "os"
import { join, dirname } from "path"
import { existsSync } from "fs"
import { mkdir, readFile, writeFile } from "fs/promises"

export interface MdcConfig {
    model: string
    provider: string
    providers: Record<string, { baseUrl?: string; apiKeyEnv?: string }>
    verification: {
        stages: string[]
        testTimeout: number
        smokeCommand?: string
    }
    consistency: {
        maxRetries: number
        /** Per-candidate repair attempts before falling back to a full resample.
         *  Feeding a failing candidate its own exact verification errors and
         *  asking for a minimal fix is far cheaper and more reliable — especially
         *  for weak models — than discarding it and generating from scratch. */
        maxRepairAttempts: number
        /** Opt-in: once ≥20 samples are recorded for a model, override the
         *  static temperature/repair/format tables with what has actually
         *  worked for that model on this machine (see model-capability/policy.ts).
         *  Off by default — like the Playwright screenshot judge, a
         *  behavior-changing feature should be a visible choice, not a silent
         *  default, especially since it can make benchmark runs
         *  non-reproducible mid-run as the policy kicks in. */
        selfTuning: boolean
    }
    context: {
        autoCompactEvery: number
    }
    /** Hybrid local→cloud escalation (ROADMAP.md Phase 2, P2-2): when a step
     *  exhausts repair + resample on the configured model, retry it once on
     *  a stronger escalation model before giving up. Opt-in and off by
     *  default — it requires a second provider/model to be explicitly
     *  configured, and silently calling out to a different (likely paid)
     *  provider is not a default any agent should assume permission for. */
    escalation: {
        enabled: boolean
        provider: string
        model: string
    }
}

/** Behavioral defaults only — model/provider are set by user at first run. */
export const DEFAULT_CONFIG: MdcConfig = {
    model: "",
    provider: "",
    providers: {},
    verification: {
        stages: ["syntax", "typecheck", "lint", "tests"],
        testTimeout: 120,
    },
    consistency: { maxRetries: 3, maxRepairAttempts: 2, selfTuning: false },
    context: { autoCompactEvery: 5 },
    escalation: { enabled: false, provider: "", model: "" },
}

function configPath(): string {
    if (process.platform === "win32") {
        const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
        return join(appData, "monkeydcode", "config.toml")
    }
    return join(homedir(), ".config", "monkeydcode", "config.toml")
}

/** TOML booleans are bare (`true`/`false`, no quotes) — parseTomlValue's
 *  fallback branch returns them as the literal strings "true"/"false", not a
 *  boolean, since it only special-cases arrays and integers. This normalizes
 *  either a real boolean (already-parsed default) or that string form. */
function parseBool(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") return value
    if (value === "true") return true
    if (value === "false") return false
    return fallback
}

function parseTomlValue(raw: string): string | number | string[] {
    const v = raw.trim()
    if (v.startsWith("[") && v.endsWith("]")) {
        return v
            .slice(1, -1)
            .split(",")
            .map(s => s.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean)
    }
    if (/^\d+$/.test(v)) return Number(v)
    return v.replace(/^["']|["']$/g, "")
}

function parseToml(text: string): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {}
    let section = "default"
    for (const line of text.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const sec = trimmed.match(/^\[([^\]]+)\]$/)
        if (sec) {
            section = sec[1]!
            if (!out[section]) out[section] = {}
            continue
        }
        const kv = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*=\s*(.+)$/)
        if (!kv) continue
        if (!out[section]) out[section] = {}
        out[section]![kv[1]!] = parseTomlValue(kv[2]!)
    }
    return out
}

export async function loadConfig(): Promise<MdcConfig> {
    const path = configPath()
    if (!existsSync(path)) return { ...DEFAULT_CONFIG }

    try {
        const text = await readFile(path, "utf-8")
        const parsed = parseToml(text)
        const d = parsed.default ?? {}
        const v = parsed.verification ?? {}
        const c = parsed.consistency ?? {}
        const ctx = parsed.context ?? {}
        const esc = parsed.escalation ?? {}

        const providers: MdcConfig["providers"] = {}
        for (const [key, val] of Object.entries(parsed)) {
            if (key.startsWith("providers.")) {
                const name = key.slice("providers.".length)
                providers[name] = val as MdcConfig["providers"][string]
            }
        }

        return {
            model: String(d.model ?? ""),
            provider: String(d.provider ?? ""),
            providers,
            verification: {
                stages: Array.isArray(v.stages)
                    ? (v.stages as string[])
                    : DEFAULT_CONFIG.verification.stages,
                testTimeout: Number(v.test_timeout ?? DEFAULT_CONFIG.verification.testTimeout),
                smokeCommand: v.smoke_command ? String(v.smoke_command) : undefined,
            },
            consistency: {
                maxRetries: Number(c.max_retries ?? DEFAULT_CONFIG.consistency.maxRetries),
                maxRepairAttempts: Number(
                    c.max_repair_attempts ?? DEFAULT_CONFIG.consistency.maxRepairAttempts,
                ),
                selfTuning: parseBool(c.self_tuning, DEFAULT_CONFIG.consistency.selfTuning),
            },
            context: {
                autoCompactEvery: Number(
                    ctx.auto_compact_every ?? DEFAULT_CONFIG.context.autoCompactEvery,
                ),
            },
            escalation: {
                enabled: parseBool(esc.enabled, DEFAULT_CONFIG.escalation.enabled),
                provider: String(esc.provider ?? DEFAULT_CONFIG.escalation.provider),
                model: String(esc.model ?? DEFAULT_CONFIG.escalation.model),
            },
        }
    } catch {
        return { ...DEFAULT_CONFIG }
    }
}

export function resolveConfigPath(): string {
    return configPath()
}

function quoteToml(s: string): string {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

export async function saveConfig(config: MdcConfig): Promise<void> {
    const path = configPath()
    await mkdir(dirname(path), { recursive: true })

    const lines = [
        "# monkeyDcode user config — model/provider set at first run",
        "[default]",
        `model = ${quoteToml(config.model)}`,
        `provider = ${quoteToml(config.provider)}`,
        "",
        "[verification]",
        `stages = [${config.verification.stages.map(quoteToml).join(", ")}]`,
        `test_timeout = ${config.verification.testTimeout}`,
        "",
        "[consistency]",
        `max_retries = ${config.consistency.maxRetries}`,
        `max_repair_attempts = ${config.consistency.maxRepairAttempts}`,
        `self_tuning = ${config.consistency.selfTuning}`,
        "",
        "[context]",
        `auto_compact_every = ${config.context.autoCompactEvery}`,
        "",
        "[escalation]",
        `enabled = ${config.escalation.enabled}`,
        `provider = ${quoteToml(config.escalation.provider)}`,
        `model = ${quoteToml(config.escalation.model)}`,
        "",
    ]

    await writeFile(path, lines.join("\n"), "utf-8")
}

