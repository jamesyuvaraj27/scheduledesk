/**
 * Signs the integration scripts in as an administrator.
 *
 * Every admin API now needs a session, so rather than rewriting hundreds of
 * fetch calls these scripts import this module for its side effect: it logs in
 * once with ADMIN_PASSWORD and attaches the returned bearer token to every
 * subsequent request to the API.
 *
 * Public routes (/api/public, /api/health, /api/auth) ignore the header, so
 * this is safe to have on for all of them.
 */

const BASE = process.env.API ?? "http://localhost:4000/api"
const PASSWORD = process.env.ADMIN_PASSWORD ?? "dev-admin"

const res = await fetch(`${BASE}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: PASSWORD }),
})

if (!res.ok) {
  console.error(
    `\n  Could not sign in as administrator at ${BASE}.\n` +
      `  Set ADMIN_PASSWORD to the same value the server is using` +
      ` (currently trying "${PASSWORD}").\n`
  )
  process.exit(1)
}

const { token } = await res.json()

// Kept so a test can deliberately send a request with no credentials — that
// is how the admin-security checks prove the API refuses public visitors.
const original = globalThis.fetch
globalThis.__rawFetch = original
globalThis.fetch = (input, init = {}) => {
  const url = typeof input === "string" ? input : (input?.url ?? "")
  if (!url.includes("/api")) return original(input, init)

  const headers = new Headers(init.headers ?? {})
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`)
  return original(input, { ...init, headers })
}

export const adminToken = token
