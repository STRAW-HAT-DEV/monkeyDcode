// Session-scoped permission rules — GAPS.md Part 2, C4.
//
// Gates the two model-supplied-input surfaces the tool loop exposes: RUN
// diagnostics (permission "run", pattern = command name, e.g. "test") and MCP
// tool calls (permission "mcp", pattern = "<server>.<tool>"). Reuses
// core/permission.ts's evaluate() directly rather than reimplementing rule
// matching — that module is small, dependency-free, and already correct.
//
// Cached the same way mcp-context.ts caches the MCP manager: config is read
// once per process, not once per tool call.

import { loadConfig } from "@monkeydcode/core/mdc-config"
import type { Ruleset } from "@monkeydcode/core/permission"
import { Wildcard } from "@monkeydcode/core/util/wildcard"

let cached: Promise<Ruleset> | null = null

export function getPermissionRules(): Promise<Ruleset> {
    if (!cached) {
        cached = loadConfig()
            .then(config => config.permissions.rules)
            .catch(() => [])
    }
    return cached
}

export interface PermissionCheck {
    allowed: boolean
    reason?: string
}

/**
 * True default-allow: a request that matches NO configured rule is allowed,
 * full stop — same as an empty ruleset. Only a rule that actually matches
 * (found via the same most-specific-wins `findLast` core/permission.ts's own
 * `evaluate()` uses) can refuse it, via "deny" or "ask" (a non-interactive
 * batch agent has no one to ask mid-task, so "ask" fails safe as a refusal).
 *
 * This deliberately does NOT call core/permission.ts's `evaluate()` despite
 * reusing its Rule/Ruleset types: `evaluate()` returns a *synthetic*
 * `{ action: "ask", pattern: "*" }` sentinel when nothing matches, which is
 * shape-identical to a real user-authored "ask everything" rule — there is
 * no way to tell "nothing matched" from "an ask-everything rule matched" once
 * that value comes back. Using it here would mean one surgical rule like
 * `{permission:"run", pattern:"test", action:"deny"}` — clearly meant to
 * block just test execution — would *also* silently deny every other
 * unrelated RUN command and MCP tool the moment any rule exists at all. That
 * is a dangerous, surprising violation of least-astonishment for a
 * permissions feature, so this reimplements the matching directly instead.
 */
export function checkPermission(rules: Ruleset, permission: string, pattern: string): PermissionCheck {
    const rule = rules.findLast(r => Wildcard.match(permission, r.permission) && Wildcard.match(pattern, r.pattern))
    if (!rule || rule.action === "allow") return { allowed: true }
    return {
        allowed: false,
        reason: `blocked by permission rule "${rule.permission}:${rule.pattern}" → ${rule.action}`,
    }
}
