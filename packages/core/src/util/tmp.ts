// Temp-directory helpers. Always create unpredictable, user-private temp dirs
// under os.tmpdir() to avoid predictable-path / symlink races (TOCTOU).

import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

/**
 * Create a fresh, randomly-named temp directory under the OS temp dir.
 * `fs.mkdtemp` creates the directory with mode 0700 (owner-only) on POSIX.
 */
export async function makeTempDir(prefix = "mdc-"): Promise<string> {
    return mkdtemp(join(tmpdir(), prefix))
}

/**
 * Run `fn` with a fresh temp directory, removing the directory (and its contents)
 * afterwards even if `fn` throws.
 */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>, prefix = "mdc-"): Promise<T> {
    const dir = await makeTempDir(prefix)
    try {
        return await fn(dir)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}
