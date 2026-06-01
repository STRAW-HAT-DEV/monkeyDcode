export function binarySearch(arr: number[], target: number): number {
    let low = 0
    let high = arr.length  // BUG: should be arr.length - 1

    while (low < high) {   // BUG: should be low <= high
        const mid = Math.floor((low + high) / 2)
        if (arr[mid] === target) return mid
        if (arr[mid]! < target) low = mid + 1
        else high = mid - 1
    }

    return -1
}
