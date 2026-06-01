Add input validation to `src/validator.ts`.

Implement a `validateUser` function that checks:
- `name`: must be a non-empty string, max 100 chars
- `email`: must be a valid email format (contains @ and a dot after it)
- `age`: must be a number between 0 and 150 (inclusive)

Return `{ valid: true }` on success, or `{ valid: false, errors: string[] }` listing what failed.
