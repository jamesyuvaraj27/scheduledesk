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
