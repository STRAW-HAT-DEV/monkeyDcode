#!/usr/bin/env bun
/**
 * Verification pipeline CLI tool.
 * Usage: bun run packages/consistency/src/verification/verify-tool.ts [files...]
 */
import { run, formatSummary } from "./pipeline.ts"

const files = process.argv.slice(2)
const projectRoot = process.cwd()

if (files.length === 0) {
    console.error("Usage: verify-tool.ts <file1> [file2...]")
    process.exit(1)
}

const result = await run(files, projectRoot)
console.log(formatSummary(result))
process.exit(result.passed ? 0 : 1)
