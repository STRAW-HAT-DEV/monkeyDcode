Add pagination to the `getUsers` function in `src/users.ts`.

The function currently returns all users. Add `page` and `pageSize` parameters (both numbers, default 1 and 10) and return only the slice of users for that page.

Also add a `total` field to the return value so callers know how many users exist.
