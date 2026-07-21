import { test, expect, afterEach } from "bun:test"
import { buildSandboxedCommand, detectSandboxCapability, _setDetectedKindForTest } from "../src/util/sandbox.ts"

afterEach(() => {
    _setDetectedKindForTest(null) // restore real detection for other tests/files
})

// ─── detection (real, on whatever OS this actually runs on) ────────────────

test("detectSandboxCapability returns a valid, cached kind for this real machine", () => {
    const kind = detectSandboxCapability()
    expect(["bwrap", "sandbox-exec", "none"]).toContain(kind)
    expect(detectSandboxCapability()).toBe(kind) // cached — same answer twice
})

test("on Windows (this development machine), detection is honestly 'none' — no false claim of sandboxing", () => {
    if (process.platform !== "win32") return
    expect(detectSandboxCapability()).toBe("none")
})

// ─── buildSandboxedCommand: pure logic, all three branches forced via the
// test-only override so each is exercised regardless of the host OS ────────

test("env is always allowlisted — a secret-looking var never survives into the spawned env", () => {
    const original = process.env.MDCODE_TEST_FAKE_SECRET
    process.env.MDCODE_TEST_FAKE_SECRET = "sk-should-never-appear"
    try {
        _setDetectedKindForTest("none")
        const result = buildSandboxedCommand(["echo", "hi"], { cwd: "/tmp/project" })
        expect(result.env.MDCODE_TEST_FAKE_SECRET).toBeUndefined()
        expect(Object.values(result.env)).not.toContain("sk-should-never-appear")
    } finally {
        if (original === undefined) delete process.env.MDCODE_TEST_FAKE_SECRET
        else process.env.MDCODE_TEST_FAKE_SECRET = original
    }
})

test("extraEnv is explicitly allowed through — the opt-in mechanism (e.g. an MCP server's own config)", () => {
    _setDetectedKindForTest("none")
    const result = buildSandboxedCommand(["node", "server.js"], {
        cwd: "/tmp/project",
        extraEnv: { GITHUB_TOKEN: "explicit-opt-in-value" },
    })
    expect(result.env.GITHUB_TOKEN).toBe("explicit-opt-in-value")
})

test("kind 'none': command passes through unmodified, with an honest note", () => {
    _setDetectedKindForTest("none")
    const result = buildSandboxedCommand(["bun", "test"], { cwd: "/proj" })
    expect(result.command).toEqual(["bun", "test"])
    expect(result.kind).toBe("none")
    expect(result.note).toContain("no")
})

test("kind 'bwrap': wraps the command, unshares network by default, binds cwd read-write", () => {
    _setDetectedKindForTest("bwrap")
    const result = buildSandboxedCommand(["bun", "run", "typecheck"], { cwd: "/home/user/proj" })
    expect(result.command[0]).toBe("bwrap")
    expect(result.command).toContain("--unshare-net")
    expect(result.command).toContain("/home/user/proj")
    // the original command must survive intact at the end, after "--"
    const sep = result.command.indexOf("--")
    expect(result.command.slice(sep + 1)).toEqual(["bun", "run", "typecheck"])
    expect(result.note).toContain("network disabled")
})

test("kind 'bwrap' with allowNetwork: does NOT unshare network", () => {
    _setDetectedKindForTest("bwrap")
    const result = buildSandboxedCommand(["node", "mcp-server.js"], { cwd: "/proj", allowNetwork: true })
    expect(result.command).not.toContain("--unshare-net")
    expect(result.note).toContain("network allowed")
})

test("kind 'sandbox-exec': wraps with -p and a profile that confines writes to cwd", () => {
    _setDetectedKindForTest("sandbox-exec")
    const result = buildSandboxedCommand(["bun", "test"], { cwd: "/Users/me/proj" })
    expect(result.command[0]).toBe("sandbox-exec")
    expect(result.command[1]).toBe("-p")
    const profile = result.command[2]!
    expect(profile).toContain("/Users/me/proj")
    expect(profile).toContain("deny network")
    // original command survives at the end
    expect(result.command.slice(3)).toEqual(["bun", "test"])
})

test("kind 'sandbox-exec' with allowNetwork: profile has no network-denial clause", () => {
    _setDetectedKindForTest("sandbox-exec")
    const result = buildSandboxedCommand(["curl", "https://example.com"], { cwd: "/proj", allowNetwork: true })
    expect(result.command[2]).not.toContain("deny network")
})

test("the wrapped command never drops or reorders the caller's original argv", () => {
    for (const kind of ["none", "bwrap", "sandbox-exec"] as const) {
        _setDetectedKindForTest(kind)
        const result = buildSandboxedCommand(["git", "diff", "HEAD", "--stat"], { cwd: "/proj" })
        const joined = result.command.join(" ")
        expect(joined).toContain("git diff HEAD --stat")
    }
})
