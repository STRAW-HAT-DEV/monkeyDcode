export interface HttpResponse {
    status: number
    body: unknown
}

export function jsonResponse(body: unknown, status = 200): HttpResponse {
    return { status, body }
}

export function errorResponse(message: string, status = 400): HttpResponse {
    return { status, body: { error: message } }
}
