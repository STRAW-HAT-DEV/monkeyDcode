import { test, expect } from "bun:test"
import { deleteUser } from "../src/handlers/deleteUser"
import { addUser } from "../src/db"

test("deletes an existing user and returns 200 with { deleted: true }", () => {
    const user = addUser("Temp User")
    const res = deleteUser({ params: { id: String(user.id) } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ deleted: true })
})

test("returns 404 for a user that doesn't exist", () => {
    const res = deleteUser({ params: { id: "999999" } })
    expect(res.status).toBe(404)
})
