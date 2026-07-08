export interface User {
    id: number
    name: string
}

const users = new Map<number, User>([
    [1, { id: 1, name: "Ada" }],
    [2, { id: 2, name: "Grace" }],
])

let nextId = 3

export function findUser(id: number): User | undefined {
    return users.get(id)
}

export function addUser(name: string): User {
    const user: User = { id: nextId++, name }
    users.set(user.id, user)
    return user
}

export function deleteUserById(id: number): boolean {
    return users.delete(id)
}

export function allUsers(): User[] {
    return [...users.values()]
}
