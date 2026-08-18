# Tests

## Unit tests — `npm test` (from the repo root)

Pure logic, no database:

- `src/lib/periods.test.ts` — period grid and lab-window rules
- `src/lib/scheduling.test.ts` — the conflict engine
- `src/lib/importer.test.ts` — reading existing timetable sheets
- `client/src/components/timetable/gridLayout.test.ts` — grid cell layout

## Integration scripts

These hit the real API and **write real rows**. Start the app first
(`npm run dev`), then run one from the `server` directory:

```bash
node test/integration.mjs         # scheduling, clashes, faculty timetables
node test/integration-import.mjs  # reading an existing sheet
node test/integration-reset.mjs   # academic year reset and term history
node test/integration-overview.mjs # build status and print-all
```

Point `DATABASE_URL` at a scratch database, not one holding real timetables.

To clear up afterwards:

```bash
CONFIRM_WIPE=yes node test/reset-db.mjs
```

That empties every table. It is not the same as **Academic Year Reset** in the
app, which keeps your master data and archives the old term.

## Which scripts are safe to run

`integration-newfeatures.mjs` and `integration-rooms.mjs` are **namespaced**:
everything they create is prefixed (`ZZ*` codes, block `V` rooms numbered from
900, `TEST-*` terms), they only delete ids they created themselves, and they
restore whichever term was active before they started. They are safe to run
against a database that holds a real timetable.

`integration.mjs`, `integration-import.mjs`, `integration-reset.mjs` and
`integration-overview.mjs` are **not**. They were written against a fresh
install: they create a term with `makeActive: true` and use plain names like
"Room 204" and "Sai Sir". Run against live data they steal active-term status
and leave fixtures behind. They now call `requireEmptyDatabase()` from
`guard.mjs` and refuse to start unless the database is empty — point `API=` at
a scratch database to run them.

Note that the 170-second cap on a single command can kill a run mid-cleanup.
If that happens, the fixtures listed above are what to look for.
