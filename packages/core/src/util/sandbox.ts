// Best-effort process sandboxing — GAPS.md Part 2, C3.
//
// monkeyDcode spawns real OS processes in two places that matter for this:
// the tool loop's RUN diagnostics (tool-loop.ts) and locally-configured MCP
// servers (packages/mcp's stdio transport) — the latter is genuinely
// untrusted, user-installed third-party code. Two independent protections,
// applied together:
//
//  1. Environment allowlisting (works identically on every OS, verified
//     here): by default, a spawned process gets a SMALL, functional
//     environment — not the parent's full env, which routinely contains
//     LLM provider API keys that have nothing to do with `bun test` or a
//     filesystem MCP server. A caller opts specific extra vars IN
//     explicitly (e.g. an MCP server's own configured `env` block) rather
//     than everything leaking through by default.
//
//  2. OS-level process sandboxing where a sandboxer is actually available:
//     bubblewrap (bwrap) on Linux, sandbox-exec on macOS. Both restrict
//     filesystem writes and (by default) disable network access for the
//     wrapped process. Detected via Bun.which(), so a command degrades to
//     "unsandboxed, but env-allowlisted" instead of failing when the
//     sandboxer binary isn't installed — same "degrade, never crash" stance
//     as every other optional capability in this codebase (screenshot.ts,
//     browser-check.ts, python-bridge).
//
// Windows has no simple userland equivalent to bwrap/sandbox-exec (real
// isolation there means WSL or a full Windows Sandbox VM — well beyond what
// a library can set up transparently). This is stated plainly, not silently
// downgraded and left undocumented: on Windows, `kind` is always "none" and
// only protection #1 (env allowlisting) applies. That is still a real,
// meaningful reduction in what a spawned process can see and reach, even
// though it is not filesystem/network isolation.

export type SandboxKind = "bwrap" | "sandbox-exec" | "none"

export interface SandboxOptions {
    cwd: string
    /** Most diagnostics (typecheck, test, git) need no network. MCP servers
     *  that legitimately call out (e.g. a GitHub server) should set this. */
    allowNetwork?: boolean
    /** Extra environment variables to add on top of the base allowlist —
     *  the explicit-opt-in mechanism (e.g. an MCP server's configured `env`). */
    extraEnv?: Record<string, string>
}

export interface SandboxedCommand {
    /** The actual argv to spawn — either the original command or one
     *  wrapped in bwrap/sandbox-exec. */
    command: string[]
    /** The env to spawn it with — always allowlisted, regardless of `kind`. */
    env: Record<string, string>
    kind: SandboxKind
    /** Human-readable note on what protection is actually in effect —
     *  surfaced in telemetry/debug output, never silently swallowed. */
    note: string
}

// Vars needed for basic process functioning on each OS — resolving
// binaries, writing temp files, finding the home directory. Nothing here is
// a credential.
const BASE_ALLOWLIST = [
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "LANG",
    "LC_ALL",
] as const

let cachedKind: SandboxKind | null = null

/** Detects an available OS-level sandboxer. Cached — the answer can't change
 *  mid-process, and Bun.which() is a real filesystem/PATH lookup each call. */
export function detectSandboxCapability(): SandboxKind {
    if (cachedKind !== null) return cachedKind
    if (process.platform === "linux" && Bun.which("bwrap")) {
        cachedKind = "bwrap"
    } else if (process.platform === "darwin" && Bun.which("sandbox-exec")) {
        cachedKind = "sandbox-exec"
    } else {
        cachedKind = "none"
    }
    return cachedKind
}

/** Only exposed for tests — real code should never need to override
 *  detection, but a test must be able to exercise all three branches of
 *  buildSandboxedCommand() regardless of what's actually installed on the
 *  machine running the suite. */
export function _setDetectedKindForTest(kind: SandboxKind | null): void {
    cachedKind = kind
}

function allowlistedEnv(extra?: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {}
    for (const key of BASE_ALLOWLIST) {
        const value = process.env[key]
        if (value !== undefined) env[key] = value
    }
    return { ...env, ...extra }
}

/**
 * Pure command-construction logic — given a command and options, decide
 * what to actually execute and with what environment. Deliberately
 * side-effect-free (no spawning here) so the wrapping logic itself is fully
 * unit-testable without needing bwrap/sandbox-exec installed, on any OS,
 * including the one this was developed on (Windows — neither sandboxer
 * exists there, so this function's Linux/macOS branches can only be verified
 * by direct code inspection plus this pure-logic test coverage, not by a
 * live wrapped execution; that limitation is inherent to not having a Linux
 * or macOS machine available, not a gap in this function's testing).
 */
export function buildSandboxedCommand(command: string[], options: SandboxOptions): SandboxedCommand {
    const env = allowlistedEnv(options.extraEnv)
    const kind = detectSandboxCapability()

    if (kind === "bwrap") {
        const netArgs = options.allowNetwork ? [] : ["--unshare-net"]
        const wrapped = [
            "bwrap",
            "--ro-bind", "/", "/",
            "--dev", "/dev",
            "--proc", "/proc",
            "--bind", options.cwd, options.cwd,
            "--tmpfs", "/tmp",
            ...netArgs,
            "--die-with-parent",
            "--",
            ...command,
        ]
        return {
            command: wrapped,
            env,
            kind,
            note: `sandboxed via bubblewrap (${options.allowNetwork ? "network allowed" : "network disabled"}, ` +
                `filesystem read-only outside ${options.cwd})`,
        }
    }

    if (kind === "sandbox-exec") {
        const networkClause = options.allowNetwork ? "" : "(deny network*)"
        const profile = `(version 1)(allow default)${networkClause}(deny file-write* (subpath "/") (with no-report))(allow file-write* (subpath "${options.cwd}"))(allow file-write* (subpath "/tmp"))`
        const wrapped = ["sandbox-exec", "-p", profile, ...command]
        return {
            command: wrapped,
            env,
            kind,
            note: `sandboxed via sandbox-exec (${options.allowNetwork ? "network allowed" : "network disabled"}, ` +
                `writes confined to ${options.cwd} and /tmp)`,
        }
    }

    return {
        command,
        env,
        kind: "none",
        note: process.platform === "win32"
            ? "no OS-level sandbox available on Windows (env allowlisting only — see sandbox.ts header)"
            : "no sandboxer (bwrap/sandbox-exec) found on PATH (env allowlisting only)",
    }
}

export interface SandboxedExecResult {
    stdout: string
    stderr: string
    exitCode: number
    sandbox: SandboxedCommand
}

/** Run `command` through buildSandboxedCommand() and actually execute it,
 *  capturing output. The one place in this module with a side effect —
 *  kept separate from buildSandboxedCommand() precisely so that pure
 *  function can be unit-tested without spawning anything. */
export async function execSandboxed(command: string[], options: SandboxOptions): Promise<SandboxedExecResult> {
    const sandbox = buildSandboxedCommand(command, options)
    const proc = Bun.spawn(sandbox.command, {
        cwd: options.cwd,
        env: sandbox.env,
        stdout: "pipe",
        stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { stdout, stderr, exitCode, sandbox }
}
