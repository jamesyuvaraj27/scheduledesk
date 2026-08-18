/**
 * Guard for the integration scripts that assume an EMPTY database.
 *
 * `integration.mjs`, `integration-import.mjs`, `integration-reset.mjs` and
 * `integration-overview.mjs` were written against a fresh install: they create
 * a term with `makeActive: true`, invent departments and rooms with plain
 * names, and delete by assuming they own everything they find.
 *
 * Run against a database that already holds a real timetable, they steal
 * active-term status from the live term and leave fixtures behind. That has
 * happened. So they now refuse to start unless the database is empty.
 *
 * `integration-newfeatures.mjs` and `integration-rooms.mjs` do NOT need this —
 * they namespace everything they create and restore the active term.
 */
export async function requireEmptyDatabase(base) {
  const counts = {}
  for (const resource of ["departments", "sections", "subjects", "faculty", "terms"]) {
    const res = await fetch(`${base}/${resource}`)
    if (!res.ok) {
      console.error(`Could not read /${resource} — is the server running?`)
      process.exit(1)
    }
    counts[resource] = (await res.json()).length
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) return

  console.error(
    [
      "",
      "This script needs an EMPTY database and the one it is pointed at is not:",
      ...Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `  ${n} ${k}`),
      "",
      "Running it would deactivate the live academic term and leave test rows",
      "behind. Point API= at a scratch database, or clear this one first:",
      "",
      "  CONFIRM_WIPE=yes node test/reset-db.mjs   (destroys everything)",
      "",
    ].join("\n")
  )
  process.exit(1)
}
