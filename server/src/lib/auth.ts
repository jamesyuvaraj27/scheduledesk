/**
 * Admin authentication.
 *
 * One shared password for the timetable office, held in ADMIN_PASSWORD. On
 * success the server issues a signed, httpOnly cookie; every mutating route
 * is behind `requireAdmin`, so hiding a button in the UI is never what keeps
 * a public visitor out — the API refuses them.
 *
 * No new dependencies: the token is an HMAC over an expiry timestamp using
 * node's own crypto, and the cookie header is parsed by hand.
 */

import crypto from "node:crypto"
import type { NextFunction, Request, Response } from "express"
import { AppError } from "./errors.js"

export const ADMIN_COOKIE = "sd_admin"

/** Sessions last a working week; the office shouldn't log in every morning. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (secret && secret.length >= 16) return secret

  // Derive one from the admin password rather than refusing to boot. It means
  // sessions drop when the password changes, which is the correct behaviour
  // anyway.
  const fallback = process.env.ADMIN_PASSWORD
  if (fallback) return crypto.createHash("sha256").update(fallback).digest("hex")

  return "scheduledesk-insecure-development-secret"
}

export function adminPasswordIsConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length > 0)
}

/** Constant-time compare so a wrong password can't be found a byte at a time. */
export function passwordMatches(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? ""
  if (!expected) return false

  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function issueToken(): string {
  const expiresAt = Date.now() + SESSION_TTL_MS
  const payload = `admin.${expiresAt}`
  const signature = crypto
    .createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("hex")
  return `${payload}.${signature}`
}

export function tokenIsValid(token: string | undefined): boolean {
  if (!token) return false

  const parts = token.split(".")
  if (parts.length !== 3) return false

  const [role, expiresAt, signature] = parts
  if (role !== "admin") return false

  const expected = crypto
    .createHmac("sha256", sessionSecret())
    .update(`${role}.${expiresAt}`)
    .digest("hex")

  const given = Buffer.from(signature)
  const want = Buffer.from(expected)
  if (given.length !== want.length) return false
  if (!crypto.timingSafeEqual(given, want)) return false

  return Number(expiresAt) > Date.now()
}

/** Minimal cookie-header parser — avoids pulling in cookie-parser. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie
  if (!header) return undefined

  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

export function isAdmin(req: Request): boolean {
  if (tokenIsValid(readCookie(req, ADMIN_COOKIE))) return true

  // Convenience for scripts and the integration tests: the same secret can be
  // sent as a bearer token instead of a cookie.
  const header = req.headers.authorization
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return tokenIsValid(header.slice(7).trim())
  }
  return false
}

export function setAdminCookie(res: Response, token: string): void {
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // In both dev and production the browser talks to /api on the same origin
    // it loaded the page from (Vite proxies in dev, Vercel rewrites to Render
    // in production), so this stays a first-party cookie and `lax` is right.
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  })
}

export function clearAdminCookie(res: Response): void {
  res.clearCookie(ADMIN_COOKIE, { path: "/" })
}

/**
 * Gate for everything that reads or writes college data. Mounted once, in
 * index.ts, in front of every admin router — so a route added later is
 * protected by default rather than by remembering to protect it.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (isAdmin(req)) return next()
  next(new AppError("Please sign in as an administrator to do that.", 401))
}
