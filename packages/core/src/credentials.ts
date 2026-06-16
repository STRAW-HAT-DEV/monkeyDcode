import { homedir } from "os"
import { join, dirname } from "path"
import { existsSync } from "fs"
import { mkdir, readFile, writeFile } from "fs/promises"

export interface ProviderCredentials {
    apiKey?: string
    baseUrl?: string
}

function dataDir(): string {
    if (process.platform === "win32") {
        const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
        return join(appData, "monkeydcode")
    }
    return join(homedir(), ".config", "monkeydcode")
}

export function credentialsPath(): string {
    return join(dataDir(), "credentials.json")
}

export async function loadCredentials(): Promise<Record<string, ProviderCredentials>> {
    const path = credentialsPath()
    if (!existsSync(path)) return {}
    try {
        const text = await readFile(path, "utf-8")
        return JSON.parse(text) as Record<string, ProviderCredentials>
    } catch {
        return {}
    }
}

export async function saveCredentials(creds: Record<string, ProviderCredentials>): Promise<void> {
    const path = credentialsPath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(creds, null, 2), { mode: 0o600 })
}

export async function setProviderCredentials(
    provider: string,
    update: ProviderCredentials,
): Promise<void> {
    const creds = await loadCredentials()
    creds[provider] = { ...creds[provider], ...update }
    await saveCredentials(creds)
}

export function hasProviderSecret(
    provider: string,
    creds: Record<string, ProviderCredentials>,
    envKeys: string[] = [],
): boolean {
    if (provider === "ollama") return true
    if (creds[provider]?.apiKey) return true
    return envKeys.some(k => Boolean(process.env[k]))
}
