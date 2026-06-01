export interface User {
    id: number
    name: string
    email: string
}

const USERS: User[] = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
}))

export function getUsers(): User[] {
    return USERS
}
