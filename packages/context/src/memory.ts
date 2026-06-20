/** Session memory tools — retain, recall, reflect, checkpoint, rewind, handoff (plan/TOOLS.md Tier 7). */
import { readFile, writeFile, mkdir } from "fs/promises"
import { join } from "path"

const MEM_DIR = join(process.cwd(), ".monkeydcode", "memory")

async function ensureDir() {
    await mkdir(MEM_DIR, { recursive: true })
}

async function readBank(): Promise<{ facts: string[]; checkpoints: { id: string; label: string; at: string }[] }> {
    try {
        return JSON.parse(await readFile(join(MEM_DIR, "bank.json"), "utf-8"))
    } catch {
        return { facts: [], checkpoints: [] }
    }
}

async function writeBank(data: ReturnType<typeof readBank> extends Promise<infer T> ? T : never) {
    await ensureDir()
    await writeFile(join(MEM_DIR, "bank.json"), JSON.stringify(data, null, 2))
}

export async function retain(fact: string): Promise<void> {
    const bank = await readBank()
    if (!bank.facts.includes(fact)) bank.facts.push(fact)
    await writeBank(bank)
}

export async function recall(query: string): Promise<string[]> {
    const bank = await readBank()
    const q = query.toLowerCase()
    return bank.facts.filter(f => f.toLowerCase().includes(q))
}

export async function reflect(question: string): Promise<string> {
    const matches = await recall(question)
    if (matches.length === 0) return "No retained memory matches this query."
    return matches.slice(0, 5).join("\n")
}

export async function checkpoint(label: string): Promise<string> {
    const bank = await readBank()
    const id = `cp-${Date.now()}`
    bank.checkpoints.push({ id, label, at: new Date().toISOString() })
    await writeBank(bank)
    return id
}

export async function rewind(checkpointId: string): Promise<string> {
    const bank = await readBank()
    const idx = bank.checkpoints.findIndex(c => c.id === checkpointId)
    if (idx < 0) return "Checkpoint not found"
    bank.checkpoints = bank.checkpoints.slice(0, idx + 1)
    await writeBank(bank)
    return `Rewound to checkpoint ${checkpointId}`
}

export async function handoff(summary: string): Promise<{ summary: string; freshContext: boolean }> {
    await retain(summary)
    return { summary, freshContext: true }
}
