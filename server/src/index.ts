import express from "express"
import cors from "cors"
import { requireDatabaseUrl } from "./lib/env.js"
import { masterDataRouter } from "./routes/masterData.js"
import { termsRouter } from "./routes/terms.js"
import { curriculumRouter } from "./routes/curriculum.js"
import { timetableRouter } from "./routes/timetable.js"
import { importRouter } from "./routes/importer.js"
import { overviewRouter } from "./routes/overview.js"
import { errorHandler } from "./lib/errors.js"

// Checked before anything else so a bad connection string fails loudly at
// startup instead of on every request.
requireDatabaseUrl()

const app = express()
const PORT = Number(process.env.PORT ?? 4000)

app.use(cors())
app.use(express.json())

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" })
})

app.use("/api/terms", termsRouter)
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
