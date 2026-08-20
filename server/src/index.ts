import express from "express"
import cors from "cors"
import { requireDatabaseUrl } from "./lib/env.js"
import { requireAdmin } from "./lib/auth.js"
import { authRouter } from "./routes/auth.js"
import { publicRouter } from "./routes/public.js"
import { masterDataRouter } from "./routes/masterData.js"
import { termsRouter } from "./routes/terms.js"
import { curriculumRouter } from "./routes/curriculum.js"
import { timetableRouter } from "./routes/timetable.js"
import { versionsRouter } from "./routes/versions.js"
import { importRouter } from "./routes/importer.js"
import { overviewRouter } from "./routes/overview.js"
import { roomsRouter } from "./routes/rooms.js"
import { errorHandler } from "./lib/errors.js"

// Checked before anything else so a bad connection string fails loudly at
// startup instead of on every request.
requireDatabaseUrl()

const app = express()
const PORT = Number(process.env.PORT ?? 4000)

// CORS_ORIGIN is a comma-separated allowlist (e.g. the Vercel frontend URL).
// Unset = allow any origin, which keeps local dev working with no config.
const allowedOrigins = process.env.CORS_ORIGIN?.split(",")
  .map((o) => o.trim())
  .filter(Boolean)

app.use(
  cors(
    allowedOrigins?.length
      ? { origin: allowedOrigins, credentials: true }
      : { origin: true, credentials: true }
  )
)
app.use(express.json())

if (!process.env.ADMIN_PASSWORD) {
  console.warn(
    "\n  ADMIN_PASSWORD is not set — nobody can sign in to the admin side.\n" +
      "  Add ADMIN_PASSWORD to the server environment and restart.\n"
  )
}

/* ------------------------------------------------------------------ */
/*  Open routes                                                        */
/* ------------------------------------------------------------------ */

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" })
})

app.use("/api/auth", authRouter)

// Read-only student timetable and class-adjustment lookup. No login.
app.use("/api/public", publicRouter)

/* ------------------------------------------------------------------ */
/*  Everything past this line requires an administrator session         */
/* ------------------------------------------------------------------ */

// One gate, mounted in front of every admin router — so a route added later
// is protected because of where it sits, not because somebody remembered to
// protect it. Hiding buttons in the UI is never what keeps anyone out.
app.use("/api", requireAdmin)

app.use("/api/terms", termsRouter)
// Mounted before masterData/timetable so /rooms/:id/timetable and
// /entries/:id/room resolve here rather than matching their :id routes.
app.use("/api", roomsRouter)
app.use("/api", versionsRouter)
app.use("/api", overviewRouter)
app.use("/api", importRouter)
app.use("/api", timetableRouter)
app.use("/api", curriculumRouter)
app.use("/api", masterDataRouter)

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" })
})

app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`ScheduleDesk API listening on http://localhost:${PORT}`)
})
