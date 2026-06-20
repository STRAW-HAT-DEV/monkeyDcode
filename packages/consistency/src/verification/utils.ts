/** Run an async stage with a timeout; returns failure result on timeout. */
export async function runWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    onTimeout: () => T,
): Promise<T> {
    if (timeoutMs <= 0) return fn()

    return Promise.race([
        fn(),
        new Promise<T>(resolve => setTimeout(() => resolve(onTimeout()), timeoutMs)),
    ])
}
