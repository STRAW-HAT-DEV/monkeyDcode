import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join, dirname } from "path"
import { loadConfig, saveConfig, resolveConfigPath, DEFAULT_CONFIG, type MdcConfig } from "../src/mdc-config.ts"

// configPath() reads APPDATA (win32) / HOME (posix) at call time with no
// injection point — so tests redirect it to a scratch directory rather than
// touching the user's real config.toml. Restored in afterEach no matter what.
let scratch: string
let origAppData: string | undefined
let origHome: string | undefined

beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "mdc-config-test-"))
    origAppData = process.env.APPDATA
    origHome = process.env.HOME
    process.env.APPDATA = scratch
    process.env.HOME = scratch
})

afterEach(async () => {
    if (origAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = origAppData
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    await rm(scratch, { recursive: true, force: true })
})

test("loadConfig returns defaults (including empty mcp.servers) when no file exists", async () => {
    const config = await loadConfig()
    expect(config).toEqual(DEFAULT_CONFIG)
})

test("a local MCP server round-trips through save then load", async () => {
    const config: MdcConfig = {
        ...DEFAULT_CONFIG,
        mcp: {
            servers: {
                filesystem: {
                    type: "local",
                    command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                    env: { FOO: "bar", BAZ: "qux" },
                    enabled: true,
                    timeoutMs: 15_000,
                },
            },
        },
    }
    await saveConfig(config)
    const loaded = await loadConfig()
    expect(loaded.mcp.servers.filesystem).toEqual(config.mcp.servers.filesystem)
})

test("a remote MCP server with headers round-trips, and a disabled server stays disabled", async () => {
    const config: MdcConfig = {
        ...DEFAULT_CONFIG,
        mcp: {
            servers: {
                api: {
                    type: "remote",
                    url: "https://example.com/mcp",
                    headers: { Authorization: "Bearer secret-token" },
                    enabled: false,
                    timeoutMs: 30_000,
                },
            },
        },
    }
    await saveConfig(config)
    const loaded = await loadConfig()
    expect(loaded.mcp.servers.api).toEqual(config.mcp.servers.api)
    expect(loaded.mcp.servers.api?.enabled).toBe(false)
})

test("multiple MCP servers of mixed type all survive a save/load cycle", async () => {
    const config: MdcConfig = {
        ...DEFAULT_CONFIG,
        mcp: {
            servers: {
                a: { type: "local", command: ["echo", "hi"], enabled: true, timeoutMs: 20_000 },
                b: { type: "remote", url: "https://b.example.com", enabled: true, timeoutMs: 20_000 },
            },
        },
    }
    await saveConfig(config)
    const loaded = await loadConfig()
    expect(Object.keys(loaded.mcp.servers).sort()).toEqual(["a", "b"])
    expect(loaded.mcp.servers.a).toEqual(config.mcp.servers.a)
    expect(loaded.mcp.servers.b).toEqual(config.mcp.servers.b)
})

test("regression: providers survive a save/load cycle (previously silently wiped on every save)", async () => {
    const config: MdcConfig = {
        ...DEFAULT_CONFIG,
        providers: { groq: { baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY" } },
    }
    await saveConfig(config)
    const loaded = await loadConfig()
    expect(loaded.providers.groq).toEqual(config.providers.groq)
})

test("${VAR} in a server's headers/env is expanded from the real process env — for referencing secrets without hardcoding them", async () => {
    const original = process.env.MDC_TEST_TOKEN
    process.env.MDC_TEST_TOKEN = "expanded-secret-value"
    try {
        const path = resolveConfigPath()
        await mkdir(dirname(path), { recursive: true })
        await writeFile(
            path,
            [
                "[mcp.servers.api]",
                'type = "remote"',
                'url = "https://example.com/mcp"',
                "enabled = true",
                "timeout_ms = 20000",
                "",
                "[mcp.servers.api.headers]",
                'Authorization = "Bearer ${MDC_TEST_TOKEN}"',
            ].join("\n"),
        )
        const loaded = await loadConfig()
        expect(loaded.mcp.servers.api?.type).toBe("remote")
        if (loaded.mcp.servers.api?.type === "remote") {
            expect(loaded.mcp.servers.api.headers?.Authorization).toBe("Bearer expanded-secret-value")
        }
    } finally {
        if (original === undefined) delete process.env.MDC_TEST_TOKEN
        else process.env.MDC_TEST_TOKEN = original
    }
})

test("a ${VAR} reference to an UNSET variable is left as the literal placeholder, not silently emptied", async () => {
    delete process.env.MDC_TEST_UNSET_TOKEN
    const path = resolveConfigPath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
        path,
        [
            "[mcp.servers.api]",
            'type = "remote"',
            'url = "https://example.com/mcp"',
            "enabled = true",
            "timeout_ms = 20000",
            "",
            "[mcp.servers.api.headers]",
            'Authorization = "Bearer ${MDC_TEST_UNSET_TOKEN}"',
        ].join("\n"),
    )
    const loaded = await loadConfig()
    if (loaded.mcp.servers.api?.type === "remote") {
        expect(loaded.mcp.servers.api.headers?.Authorization).toBe("Bearer ${MDC_TEST_UNSET_TOKEN}")
    }
})

test("saveConfig does not wipe MCP servers when only an unrelated field changes", async () => {
    const withServer: MdcConfig = {
        ...DEFAULT_CONFIG,
        mcp: { servers: { srv: { type: "local", command: ["cmd"], enabled: true, timeoutMs: 20_000 } } },
    }
    await saveConfig(withServer)
    const reloaded = await loadConfig()
    const updated: MdcConfig = { ...reloaded, model: "a-different-model" }
    await saveConfig(updated)
    const final = await loadConfig()
    expect(final.model).toBe("a-different-model")
    expect(final.mcp.servers.srv).toEqual(withServer.mcp.servers.srv)
})

test("permission rules round-trip through save/load in file order", async () => {
    const config: MdcConfig = {
        ...DEFAULT_CONFIG,
        permissions: {
            rules: [
                { permission: "mcp", pattern: "*", action: "allow" },
                { permission: "mcp", pattern: "filesystem.write_file", action: "deny" },
                { permission: "run", pattern: "test", action: "ask" },
            ],
        },
    }
    await saveConfig(config)
    const loaded = await loadConfig()
    expect(loaded.permissions.rules).toEqual(config.permissions.rules)
})

test("an invalid/incomplete permission rule section is skipped, not crashed on", async () => {
    const path = resolveConfigPath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
        path,
        [
            "[permissions.rules.0]",
            'permission = "run"',
            'pattern = "test"',
            'action = "not-a-real-action"', // invalid
            "",
            "[permissions.rules.1]",
            'permission = "run"',
            // missing pattern/action entirely
        ].join("\n"),
    )
    const loaded = await loadConfig()
    expect(loaded.permissions.rules).toEqual([])
})
