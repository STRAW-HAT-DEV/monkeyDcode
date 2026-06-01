import { readFile, writeFile } from "fs"

export function readConfig(path: string, callback: (err: Error | null, data?: string) => void): void {
    readFile(path, "utf-8", (err, data) => {
        if (err) callback(err)
        else callback(null, data)
    })
}

export function writeConfig(path: string, data: string, callback: (err: Error | null) => void): void {
    writeFile(path, data, "utf-8", (err) => {
        callback(err)
    })
}
