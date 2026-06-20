export function computeFibonacci(n: number): number {
    if (n <= 1) return n
    return computeFibonacci(n - 1) + computeFibonacci(n - 2)
}
