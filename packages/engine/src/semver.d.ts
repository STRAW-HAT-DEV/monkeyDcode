declare module "semver" {
    export function satisfies(version: string, range: string): boolean
    export function valid(version: string | null): string | null
    export function coerce(version: string): { version: string } | null
}
