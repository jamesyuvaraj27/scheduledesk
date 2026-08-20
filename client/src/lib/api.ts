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

  /** Not signed in (or the session expired). */
  get isUnauthorized() {
    return this.status === 401
  }

  /** The API itself couldn't be reached or didn't answer with data. */
  get isUnreachable() {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504
  }
}

/* -------------------------------------------------------------------------- */
/*                         Which timetable am I editing?                      */
/* -------------------------------------------------------------------------- */

/**
 * The admin shell sets this to "LIVE" or "WORKING"; it rides along on every
 * request as a header so individual call sites don't each have to remember.
 * Public pages never set it — the server defaults to LIVE for reads and
 * refuses live edits outright while a working copy exists, so a stale value
 * here can't damage anything.
 */
let activeVersion: "LIVE" | "WORKING" = "LIVE"

export function setActiveVersion(v: "LIVE" | "WORKING") {
  activeVersion = v
}

export function getActiveVersion() {
  return activeVersion
}

/** Called when the server says the session has gone. */
type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler
}

/* -------------------------------------------------------------------------- */

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {}
  if (body) headers["Content-Type"] = "application/json"
  // Public routes ignore it; admin routes use it to pick live vs working.
  if (!path.startsWith("/public/") && !path.startsWith("/auth/")) {
    headers["X-Timetable-Version"] = activeVersion
  }

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
      // The admin session is an httpOnly cookie.
      credentials: "same-origin",
    })
  } catch {
    // fetch only rejects when the request never completed — no network, DNS
    // failure, the dev server not running.
    throw new ApiError(
      "Can't reach the ScheduleDesk server. Check that it's running, then try again.",
      0
    )
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()

  // The response is only JSON if the API answered. A hosting layer in front
  // of it — a Vercel rewrite, a Render instance that's asleep or crashed, a
  // proxy timing out — answers with an HTML error page instead, and blindly
  // JSON.parsing that is where `Unexpected token '<'` came from. Say what
  // actually happened rather than showing a parser error.
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      if (res.ok) {
        throw new ApiError(
          "The server replied with a page instead of data. It may still be starting up — wait a few seconds and try again.",
          502
        )
      }
      throw new ApiError(
        describeNonJsonFailure(res.status),
        res.status || 502
      )
    }
  }

  const payload = data as { error?: string; details?: ApiErrorDetail[] } | null

  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.()
    throw new ApiError(
      payload?.error ?? `Request failed (${res.status})`,
      res.status,
      payload?.details
    )
  }

  return data as T
}

function describeNonJsonFailure(status: number): string {
  if (status === 404) {
    return "That API route doesn't exist on the server. The site and the API may be running different versions — redeploy the API."
  }
  if (status >= 500 || status === 0) {
    return "The API server isn't responding. On a free hosting plan it goes to sleep when idle and takes up to a minute to wake — wait and try again. If it keeps failing, check the API service's logs."
  }
  return `The server replied with a page instead of data (HTTP ${status}).`
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
}
