import { homedir } from "os"
import { join } from "path"
import { existsSync } from "fs"
import { readFile, writeFile } from "fs/promises"
import { ensureParentDir } from "./util/path.ts"
import type { Rule as PermissionRule } from "./permission.ts"

// Deliberately NOT imported from @monkeydcode/mcp: that package depends on
// this one (sandbox.ts, for wrapping locally-spawned MCP servers), so core
// importing back from mcp would be a circular package dependency. core is
// the dependency-free foundation many packages build on — this small,
// structural duplication (same shape @monkeydcode/mcp/config exports) keeps
// it that way. Precedent: packages/mcp/src/config.ts itself duplicates the
// local/remote shape from packages/engine's opencode-derived config rather
// than depending on it, for the identical reason.
export interface McpLocalServerConfig {
    type: "local"
    command: string[]
    env?: Record<string, string>
    enabled: boolean
    timeoutMs: number
}
export interface McpRemoteServerConfig {
    type: "remote"
    url: string
    headers?: Record<string, string>
    enabled: boolean
    timeoutMs: number
}
export type McpServerConfig = McpLocalServerConfig | McpRemoteServerConfig
const DEFAULT_MCP_TIMEOUT_MS = 20_000

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
    /** MCP servers the agent's tool loop may call during recon (ROADMAP:
     *  close the Open Interpreter capability gap — see GAPS.md Part 2, C1).
     *  A closed menu, same invariant as the tool loop's RUN commands: model
     *  text can only select a server/tool that's already in this map — it
     *  can never introduce a new one. Empty by default; the agent behaves
     *  identically to today until the user configures a server. */
    mcp: {
        servers: Record<string, McpServerConfig>
    }
    /** Fine-grained allow/deny rules for RUN diagnostics and MCP tool calls
     *  (GAPS.md Part 2, C4). Empty by default — an unconfigured agent behaves
     *  exactly as it did before this existed. True default-allow: a request
     *  that matches no rule here is allowed regardless of how many OTHER
     *  rules exist (see permissions.ts's checkPermission) — a surgical
     *  `{permission:"run", pattern:"test", action:"deny"}` blocks only test
     *  execution, it does not silently deny every other RUN command/MCP
     *  tool. Write an explicit `pattern: "*"` rule if you want a denylist
     *  or allowlist model instead. */
    permissions: {
        rules: PermissionRule[]
    }
    /** Web search (GAPS.md Part 1, gap #6) — off by default (provider: ""),
     *  same "bring your own key, visible opt-in" posture as escalation and
     *  every LLM provider. Only "brave" is supported: it has a documented
     *  REST API, unlike scraping a search engine's HTML, which is fragile
     *  and breaks silently. Shape kept here (not imported from
     *  @monkeydcode/agent/web-search) for the same reason mcp.servers'
     *  shape is duplicated rather than imported from @monkeydcode/mcp. */
    webSearch: {
        provider: "brave" | ""
        apiKeyEnv: string
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
    mcp: { servers: {} },
    permissions: { rules: [] },
    webSearch: { provider: "", apiKeyEnv: "" },
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

/** Scans `[mcp.servers.<name>]` (+ nested `.env` / `.headers` sub-tables) out
 *  of the flat section map produced by parseToml — the same dotted-section
 *  convention already used for `[providers.<name>]`, generalized to two
 *  levels since a server also needs its own sub-table of key/value pairs. */
function parseMcpServers(parsed: Record<string, Record<string, unknown>>): Record<string, McpServerConfig> {
    const servers: Record<string, McpServerConfig> = {}
    const PREFIX = "mcp.servers."

    for (const [key, section] of Object.entries(parsed)) {
        if (!key.startsWith(PREFIX)) continue
        const rest = key.slice(PREFIX.length)
        if (rest.includes(".")) continue // handled below as a sub-table
        const name = rest
        if (!name) continue

        const type = String(section.type ?? "")
        const enabled = parseBool(section.enabled, true)
        const timeoutMs = Number(section.timeout_ms ?? DEFAULT_MCP_TIMEOUT_MS)
        const envSection = parsed[`${PREFIX}${name}.env`]
        const headersSection = parsed[`${PREFIX}${name}.headers`]

        if (type === "local") {
            const command = Array.isArray(section.command) ? (section.command as string[]) : []
            if (command.length === 0) continue
            servers[name] = {
                type: "local",
                command,
                env: envSection ? mapToStrings(envSection) : undefined,
                enabled,
                timeoutMs,
            }
        } else if (type === "remote") {
            const url = String(section.url ?? "")
            if (!url) continue
            servers[name] = {
                type: "remote",
                url,
                headers: headersSection ? mapToStrings(headersSection) : undefined,
                enabled,
                timeoutMs,
            }
        }
    }
    return servers
}

const VALID_ACTIONS = new Set(["allow", "deny", "ask"])

/** Scans `[permissions.rules.<name>]` sections — same dotted-section
 *  convention as `[mcp.servers.<name>]`. `<name>` is just a unique label
 *  (e.g. "1", "deny-writes"); ordering in the file is preserved so the
 *  most-specific-wins `evaluate()` semantics in permission.ts behave as the
 *  user would expect from reading the file top to bottom. */
function parsePermissionRules(parsed: Record<string, Record<string, unknown>>): PermissionRule[] {
    const rules: PermissionRule[] = []
    const PREFIX = "permissions.rules."

    for (const [key, section] of Object.entries(parsed)) {
        if (!key.startsWith(PREFIX)) continue
        const permission = String(section.permission ?? "")
        const pattern = String(section.pattern ?? "")
        const action = String(section.action ?? "")
        if (!permission || !pattern || !VALID_ACTIONS.has(action)) continue
        rules.push({ permission, pattern, action: action as PermissionRule["action"] })
    }
    return rules
}

/** Expands `${VAR_NAME}` to the current process env value, so an MCP server's
 *  `env`/`headers` config can reference a secret (e.g. `Bearer ${GITHUB_TOKEN}`)
 *  instead of requiring it hardcoded in cleartext in config.toml. A reference
 *  to an unset variable is left as the literal `${VAR_NAME}` — silently
 *  substituting an empty string would turn a broken auth header into one that
 *  looks superficially present, which is worse than an obviously-wrong value. */
function expandEnvRefs(value: string): string {
    return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, (match, name: string) => process.env[name] ?? match)
}

function mapToStrings(section: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(section)) out[k] = expandEnvRefs(String(v))
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
        const ws = parsed.web_search ?? {}

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
            mcp: { servers: parseMcpServers(parsed) },
            permissions: { rules: parsePermissionRules(parsed) },
            webSearch: {
                provider: ws.provider === "brave" ? "brave" : "",
                apiKeyEnv: String(ws.api_key_env ?? ""),
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

// loadConfig's providers.* reader casts the raw parsed section straight to
// MdcConfig["providers"][string] with no key remapping — so the keys written
// here MUST match the interface's own casing (baseUrl/apiKeyEnv), not the
// snake_case used by [verification]/[consistency]'s dedicated field mapping.
function providerSection(name: string, entry: MdcConfig["providers"][string]): string[] {
    const lines = [`[providers.${name}]`]
    if (entry.baseUrl) lines.push(`baseUrl = ${quoteToml(entry.baseUrl)}`)
    if (entry.apiKeyEnv) lines.push(`apiKeyEnv = ${quoteToml(entry.apiKeyEnv)}`)
    lines.push("")
    return lines
}

function permissionRuleSection(name: string, rule: PermissionRule): string[] {
    return [
        `[permissions.rules.${name}]`,
        `permission = ${quoteToml(rule.permission)}`,
        `pattern = ${quoteToml(rule.pattern)}`,
        `action = ${quoteToml(rule.action)}`,
        "",
    ]
}

function mcpServerSection(name: string, server: McpServerConfig): string[] {
    const lines = [`[mcp.servers.${name}]`, `type = ${quoteToml(server.type)}`]
    if (server.type === "local") {
        lines.push(`command = [${server.command.map(quoteToml).join(", ")}]`)
    } else {
        lines.push(`url = ${quoteToml(server.url)}`)
    }
    lines.push(`enabled = ${server.enabled}`, `timeout_ms = ${server.timeoutMs}`, "")

    if (server.type === "local" && server.env && Object.keys(server.env).length > 0) {
        lines.push(`[mcp.servers.${name}.env]`)
        for (const [k, v] of Object.entries(server.env)) lines.push(`${k} = ${quoteToml(v)}`)
        lines.push("")
    }
    if (server.type === "remote" && server.headers && Object.keys(server.headers).length > 0) {
        lines.push(`[mcp.servers.${name}.headers]`)
        for (const [k, v] of Object.entries(server.headers)) lines.push(`${k} = ${quoteToml(v)}`)
        lines.push("")
    }
    return lines
}

export async function saveConfig(config: MdcConfig): Promise<void> {
    const path = configPath()
    await ensureParentDir(path)

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
        "[web_search]",
        `provider = ${quoteToml(config.webSearch.provider)}`,
        `api_key_env = ${quoteToml(config.webSearch.apiKeyEnv)}`,
        "",
        ...Object.entries(config.providers).flatMap(([name, entry]) => providerSection(name, entry)),
        ...Object.entries(config.mcp.servers).flatMap(([name, server]) => mcpServerSection(name, server)),
        // Array, not a map — order matters for evaluate()'s most-specific-wins
        // semantics, so rules are keyed by position, not by a user-given name.
        ...config.permissions.rules.flatMap((rule, i) => permissionRuleSection(String(i), rule)),
    ]

    await writeFile(path, lines.join("\n"), "utf-8")
}

