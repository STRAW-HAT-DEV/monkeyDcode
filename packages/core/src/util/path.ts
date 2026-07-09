import { mkdir } from "fs/promises"
import { dirname } from "path"

/**
 * Recursively create `dir`, tolerating the paths that Bun's `mkdir` mishandles.
 *
 * Bun 1.3.x throws `EEXIST` for `mkdir(".", { recursive: true })` even though
 * recursive mode is supposed to be a no-op when the directory already exists.
 * `dirname()` returns "." for a bare filename, so any code that does
 * `mkdir(dirname(file), { recursive: true })` before writing a file at the
 * project root would crash. "" (ENOENT) is skipped for the same reason — both
 * mean "current directory", which always exists.
 */
export async function mkdirp(dir: string): Promise<void> {
  if (dir === "" || dir === ".") return
  await mkdir(dir, { recursive: true })
}

/** Ensure the parent directory of `file` exists before writing to it. */
export async function ensureParentDir(file: string): Promise<void> {
  await mkdirp(dirname(file))
}

export function getFilename(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[/\\]+$/, "")
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] ?? ""
}

export function getDirectory(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[/\\]+$/, "")
  const parts = trimmed.split(/[/\\]/)
  return parts.slice(0, parts.length - 1).join("/") + "/"
}

export function getFileExtension(path: string | undefined) {
  if (!path) return ""
  const parts = path.split(".")
  return parts[parts.length - 1]
}

export function getFilenameTruncated(path: string | undefined, maxLength: number = 20) {
  const filename = getFilename(path)
  if (filename.length <= maxLength) return filename
  const lastDot = filename.lastIndexOf(".")
  const ext = lastDot <= 0 ? "" : filename.slice(lastDot)
  const available = maxLength - ext.length - 1 // -1 for ellipsis
  if (available <= 0) return filename.slice(0, maxLength - 1) + "…"
  return filename.slice(0, available) + "…" + ext
}

export function truncateMiddle(text: string, maxLength: number = 20) {
  if (text.length <= maxLength) return text
  const available = maxLength - 1 // -1 for ellipsis
  const start = Math.ceil(available / 2)
  const end = Math.floor(available / 2)
  return text.slice(0, start) + "…" + text.slice(-end)
}
