export interface UserInput {
    name: unknown
    email: unknown
    age: unknown
}

export type ValidationResult =
    | { valid: true }
    | { valid: false; errors: string[] }

export function validateUser(input: UserInput): ValidationResult {
    // TODO: implement validation
    throw new Error("Not implemented")
}
