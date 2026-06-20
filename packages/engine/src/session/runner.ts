// Step 4 — Clean session runner.
// Owns: session lifecycle, SQLite persistence, multi-turn LLM calls.
// Uses @monkeydcode/llm directly — no @ts-nocheck needed.

import { Database } from "bun:sqlite"
import { randomUUID } from "crypto"
import { mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { LLM } from "@monkeydcode/llm"
import type { Message, ModelRef } from "@monkeydcode/llm"

const DB_DIR = join(homedir(), ".local", "share", "monkeydcode")
const DB_PATH = join(DB_DIR, "sessions.db")

function getDb(): Database {
    mkdirSync(DB_DIR, { recursive: true })
    const db = new Database(DB_PATH, { create: true })
    db.run("PRAGMA journal_mode=WAL")
    db.run(`
        CREATE TABLE IF NOT EXISTS mdc_session (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            project_root TEXT NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (unixepoch())
        )
    `)
    db.run(`
        CREATE TABLE IF NOT EXISTS mdc_message (
            id          TEXT PRIMARY KEY,
            session_id  TEXT NOT NULL REFERENCES mdc_session(id) ON DELETE CASCADE,
            role        TEXT NOT NULL,
            content     TEXT NOT NULL,
            created_at  INTEGER NOT NULL DEFAULT (unixepoch())
        )
    `)
    return db
}

export interface Session {
    readonly id: string
    readonly title: string
    readonly projectRoot: string
}

function createSession(projectRoot: string, title?: string): Session {
    const db = getDb()
    const id = randomUUID()
    const sessionTitle = title ?? `Session ${new Date().toISOString()}`
    db.run(
        "INSERT INTO mdc_session (id, title, project_root) VALUES (?, ?, ?)",
        [id, sessionTitle, projectRoot],
    )
    return { id, title: sessionTitle, projectRoot }
}

function getHistory(sessionId: string): Message[] {
    const db = getDb()
    const rows = db
        .query("SELECT role, content FROM mdc_message WHERE session_id = ? ORDER BY created_at")
        .all(sessionId) as Array<{ role: string; content: string }>
    return rows.map((r) => ({
        role: r.role as Message["role"],
        content: r.content,
    }))
}

// Plain async — no Effect import needed. LLM.generateAsync handles it internally.
async function chat(
    sessionId: string,
    userMessage: string,
    model: ModelRef,
): Promise<string> {
    const db = getDb()

    db.run(
        "INSERT INTO mdc_message (id, session_id, role, content) VALUES (?, ?, ?, ?)",
        [randomUUID(), sessionId, "user", userMessage],
    )

    const messages = getHistory(sessionId)
    const response = await LLM.generateAsync({ model, messages })

    db.run(
        "INSERT INTO mdc_message (id, session_id, role, content) VALUES (?, ?, ?, ?)",
        [randomUUID(), sessionId, "assistant", response.text],
    )

    return response.text
}

async function* streamChat(
    sessionId: string,
    userMessage: string,
    model: ModelRef,
): AsyncGenerator<string> {
    const db = getDb()

    db.run(
        "INSERT INTO mdc_message (id, session_id, role, content) VALUES (?, ?, ?, ?)",
        [randomUUID(), sessionId, "user", userMessage],
    )

    const messages = getHistory(sessionId)
    let fullText = ""

    for await (const event of LLM.stream({ model, messages })) {
        if (event.type === "text_delta") {
            fullText += event.delta
            yield event.delta
        }
        if (event.type === "done") {
            db.run(
                "INSERT INTO mdc_message (id, session_id, role, content) VALUES (?, ?, ?, ?)",
                [randomUUID(), sessionId, "assistant", fullText],
            )
        }
        if (event.type === "error") {
            throw event.error
        }
    }
}

function logMessage(sessionId: string, role: Message["role"], content: string): void {
    const db = getDb()
    db.run(
        "INSERT INTO mdc_message (id, session_id, role, content) VALUES (?, ?, ?, ?)",
        [randomUUID(), sessionId, role, content],
    )
}

export const Runner = { createSession, getHistory, chat, streamChat, logMessage }
