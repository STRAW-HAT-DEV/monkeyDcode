// Filesystem safety helpers shared across packages.
// - confine(): block path traversal outside a trusted root (model output, untrusted queries).
// - withDashGuard(): block argument injection when passing file lists to a CLI.

import { isAbsolute, relative, resolve } from "path"

export class PathConfinementError extends Error {
    readonly _tag = "PathConfinementError"

    constructor(
        readonly root: string,
        readonly candidate: string,
    ) {
        super(`Path "${candidate}" resolves outside confinement root "${root}"`)
        this.name = "PathConfinementError"
    }
}

/**
 * Resolve `candidate` against `root` and assert the result stays inside `root`.
 *
 * Returns the absolute, resolved path on success. Throws {@link PathConfinementError}
 * when the candidate escapes the root via `..`, an absolute path outside the root,
 * or a different filesystem volume.
 */
export function confine(root: string, candidate: string): string {
    const resolvedRoot = resolve(root)
    const resolved = resolve(resolvedRoot, candidate)
    const rel = relative(resolvedRoot, resolved)

    // rel === "" means candidate === root, which is allowed.
    if (rel !== "" && (rel === ".." || rel.startsWith(`..${pathSep(rel)}`) || isAbsolute(rel))) {
        throw new PathConfinementError(resolvedRoot, candidate)
    }
    return resolved
}

function pathSep(rel: string): string {
    return rel.includes("\\") ? "\\" : "/"
}

/**
 * Prefix a file list with `--` so any path that begins with `-` is treated as a
 * positional argument by the CLI rather than an injected flag.
 */
export function withDashGuard(files: string[]): string[] {
    return ["--", ...files]
}
