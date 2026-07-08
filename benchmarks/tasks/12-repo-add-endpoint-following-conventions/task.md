Add a `deleteUser` handler in `src/handlers/deleteUser.ts`.

Follow the exact same conventions as the existing handlers (`src/handlers/getUser.ts` and `src/handlers/createUser.ts`):
- Use `jsonResponse`/`errorResponse` from `../http` to build the response.
- Use `deleteUserById` from `../db` to perform the deletion.
- Export a function named `deleteUser` accepting `{ params: { id: string } }`.
- Return status 404 (via `errorResponse`) if the user does not exist.
- Return status 200 with body `{ deleted: true }` if the deletion succeeds.
