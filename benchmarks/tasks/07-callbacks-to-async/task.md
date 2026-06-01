Convert the callback-based functions in `src/fs-utils.ts` to return Promises instead.

The functions `readConfig` and `writeConfig` currently use Node-style error-first callbacks. Convert them to async functions that return Promises. Keep the same behavior — just change the interface.
