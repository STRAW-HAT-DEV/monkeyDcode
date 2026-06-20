Refactor `src/logger.ts` from class inheritance to composition.

The current code uses inheritance (`FileLogger extends BaseLogger`). Refactor to use composition — `FileLogger` should accept a `writer` function as a dependency rather than extending `BaseLogger`.

The public API must stay the same: `new FileLogger(path)` with a `.log(message)` method.
