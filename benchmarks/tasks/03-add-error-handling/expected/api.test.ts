import { test, expect, mock, beforeEach } from "bun:test"
import { fetchUser, saveUser, ApiError } from "../src/api"

beforeEach(() => {
    global.fetch = mock(async (url: string, opts?: RequestInit) => {
        if (url.includes("/users/404")) {
            return { ok: false, status: 404, json: async () => ({}) } as Response
        }
        if (url.includes("/users/1")) {
            return { ok: true, status: 200, json: async () => ({ id: 1, name: "Alice" }) } as Response
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response
    })
})

test("ApiError class exists with message and statusCode", () => {
    const err = new ApiError("not found", 404)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe("not found")
    expect(err.statusCode).toBe(404)
})

test("fetchUser throws ApiError on non-ok response", async () => {
    await expect(fetchUser(404)).rejects.toBeInstanceOf(ApiError)
})

test("fetchUser returns user on success", async () => {
    const user = await fetchUser(1)
    expect(user.id).toBe(1)
    expect(user.name).toBe("Alice")
})

test("saveUser does not throw on success", async () => {
    await expect(saveUser({ id: 1, name: "Alice" })).resolves.toBeUndefined()
})
