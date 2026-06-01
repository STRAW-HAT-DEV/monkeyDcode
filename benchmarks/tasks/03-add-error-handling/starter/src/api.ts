export interface User {
    id: number
    name: string
}

export async function fetchUser(id: number): Promise<User> {
    const res = await fetch(`https://api.example.com/users/${id}`)
    return res.json()
}

export async function saveUser(user: User): Promise<void> {
    await fetch("https://api.example.com/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user),
    })
}
