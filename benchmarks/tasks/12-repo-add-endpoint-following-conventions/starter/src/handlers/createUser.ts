import { jsonResponse, errorResponse, type HttpResponse } from "../http"
import { addUser } from "../db"

export function createUser(req: { body: { name?: string } }): HttpResponse {
    const name = req.body.name
    if (!name || typeof name !== "string" || name.trim() === "") {
        return errorResponse("name is required", 400)
    }
    const user = addUser(name.trim())
    return jsonResponse(user, 201)
}
