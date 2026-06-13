// @ts-nocheck
import { Schema } from "effect"
import { readFile } from "fs/promises"
import { $ } from "bun"
import { mdcTool } from "./factory.ts"

export const BrowserTool = mdcTool(
    "browser",
    "Headless browser automation via Playwright (click, type, screenshot, console logs).",
    {
        url: Schema.String,
        action: Schema.optional(Schema.Literals(["navigate", "screenshot", "click", "type"])),
        selector: Schema.optional(Schema.String),
        text: Schema.optional(Schema.String),
    },
    async (args) => {
        try {
            const { chromium } = await import("playwright")
            const browser = await chromium.launch({ headless: true })
            const page = await browser.newPage()
            await page.goto(args.url as string)
            let output = `Navigated to ${args.url}`
            if (args.action === "screenshot") {
                const buf = await page.screenshot()
                output = `Screenshot captured (${buf.length} bytes)`
            } else if (args.action === "click" && args.selector) {
                await page.click(args.selector as string)
                output = `Clicked ${args.selector}`
            } else if (args.action === "type" && args.selector && args.text) {
                await page.fill(args.selector as string, args.text as string)
                output = `Typed into ${args.selector}`
            }
            await browser.close()
            return { title: "browser", output }
        } catch {
            const r = await $`curl -sL ${args.url}`.quiet().nothrow()
            return {
                title: "browser (fallback)",
                output: r.stdout.toString().slice(0, 8000) || "Install playwright for full browser automation.",
            }
        }
    },
)

export const LocalhostViewTool = mdcTool(
    "localhost_view",
    "Inspect a running local dev server — fetch page content and metadata.",
    {
        port: Schema.optional(Schema.Number),
        path: Schema.optional(Schema.String),
    },
    async (args) => {
        const port = (args.port as number) ?? 3000
        const p = (args.path as string) ?? "/"
        const url = `http://127.0.0.1:${port}${p}`
        const r = await $`curl -sL ${url}`.quiet().nothrow()
        return { title: "localhost_view", output: r.stdout.toString().slice(0, 12000), metadata: { url } }
    },
)

export const GenerateImageTool = mdcTool(
    "generate_image",
    "Generate images via configured image model (Gemini when API key set).",
    {
        prompt: Schema.String,
        outputPath: Schema.optional(Schema.String),
    },
    async (args) => ({
        title: "generate_image",
        output: `Image generation requested: "${args.prompt}". Set GEMINI_API_KEY and wire provider for production output.`,
    }),
)

export const InspectImageTool = mdcTool(
    "inspect_image",
    "Analyse an image file path (vision model when configured).",
    { path: Schema.String },
    async (args) => {
        const buf = await readFile(args.path as string)
        return {
            title: "inspect_image",
            output: `Image ${args.path}: ${buf.length} bytes. Wire vision model for semantic analysis.`,
            metadata: { bytes: buf.length },
        }
    },
)
