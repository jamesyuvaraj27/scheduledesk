import "dotenv/config"

const PLACEHOLDER_MARKERS = ["your-neon-host", "user:password", "dbname"]

/**
 * Fail fast with something readable.
 *
 * Without this, a missing or placeholder DATABASE_URL lets the server boot
 * happily and then throw a Prisma stack trace on every single request, which
 * buries the actual problem.
 */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL

  if (!url) {
    exit(
      "DATABASE_URL is not set.",
      "Create server/.env with your database connection string:",
      '  DATABASE_URL="postgresql://user:pass@host/dbname?sslmode=require"'
    )
  }

  if (PLACEHOLDER_MARKERS.some((m) => url.includes(m))) {
    exit(
      "DATABASE_URL is still the example placeholder.",
      "server/.env currently points at a host that doesn't exist.",
      "Replace it with your real connection string (Neon dashboard -> Connection string)."
    )
  }

  return url
}

function exit(...lines: string[]): never {
  console.error("\n  Cannot start ScheduleDesk\n")
  for (const line of lines) console.error("  " + line)
  console.error("")
  process.exit(1)
}
