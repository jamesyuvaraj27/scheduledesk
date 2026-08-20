import { Router } from "express"
import { z } from "zod"
import { AppError, asyncHandler } from "../lib/errors.js"
import {
  adminPasswordIsConfigured,
  clearAdminCookie,
  isAdmin,
  issueToken,
  passwordMatches,
  setAdminCookie,
} from "../lib/auth.js"

export const authRouter = Router()

/**
 * Who am I? The client calls this on load to decide whether to show the admin
 * shell or the public one. It is deliberately the only auth route that a
 * signed-out visitor gets a 200 from.
 */
authRouter.get("/me", (req, res) => {
  res.json({
    admin: isAdmin(req),
    passwordConfigured: adminPasswordIsConfigured(),
  })
})

/** Failed attempts are slowed down so the password can't be brute-forced. */
let recentFailures = 0
let lockedUntil = 0

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { password } = z
      .object({ password: z.string().min(1, "Enter the administrator password") })
      .parse(req.body)

    if (!adminPasswordIsConfigured()) {
      throw new AppError(
        "No administrator password is set on the server. Set ADMIN_PASSWORD in the server environment and restart it.",
        503
      )
    }

    if (Date.now() < lockedUntil) {
      throw new AppError(
        "Too many failed attempts. Wait a minute and try again.",
        429
      )
    }

    if (!passwordMatches(password)) {
      recentFailures += 1
      if (recentFailures >= 5) {
        lockedUntil = Date.now() + 60_000
        recentFailures = 0
      }
      throw new AppError("That password isn't right.", 401)
    }

    recentFailures = 0
    const token = issueToken()
    setAdminCookie(res, token)
    // Returned as well as set, so non-browser callers (the integration tests,
    // any future script) can use the bearer form.
    res.json({ admin: true, token })
  })
)

authRouter.post("/logout", (_req, res) => {
  clearAdminCookie(res)
  res.json({ admin: false })
})
