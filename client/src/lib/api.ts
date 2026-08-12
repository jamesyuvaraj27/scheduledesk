/**
 * Tiny typed fetch wrapper. Vite proxies /api to the Express server in dev
 * (see vite.config.ts), so relative URLs work in both dev and production.
 */

export interface ApiErrorDetail {
  path: string
  message: string
}

export class ApiError extends Error {
  status: number
  details?: ApiErrorDetail[]

  constructor(message: string, status: number, details?: ApiErrorDetail[]) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.details = details
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) return undefined as T

  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    throw new ApiError(
      data?.error ?? `Request failed (${res.status})`,
      res.status,
      data?.details
    )
  }

  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
}
