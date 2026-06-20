Add proper error handling to `src/api.ts`.

The `fetchUser` and `saveUser` functions make network calls but have no error handling. Add try/catch blocks and throw meaningful typed errors.

Create an `ApiError` class with a `message` and `statusCode` field. Throw it when the response is not ok or when a network error occurs.
