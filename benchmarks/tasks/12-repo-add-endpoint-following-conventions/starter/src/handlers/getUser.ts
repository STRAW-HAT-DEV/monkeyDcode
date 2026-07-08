import { jsonResponse, errorResponse, type HttpResponse } from "../http"
import { findUser } from "../db"

export function getUser(req: { params: { id: string } }): HttpResponse {
    const id = Number(req.params.id)
    const user = findUser(id)
    if (!user) return errorResponse(`User ${id} not found`, 404)
    return jsonResponse(user)
}
