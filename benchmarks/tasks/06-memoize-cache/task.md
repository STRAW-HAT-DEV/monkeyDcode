Add memoization to the expensive `computeFibonacci` function in `src/fib.ts`.

The function works correctly but is very slow for large inputs because it recalculates everything from scratch each time. Add a cache so repeated calls with the same argument return immediately.

Do not change the function signature or behavior — only add caching.
