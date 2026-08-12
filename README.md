# ScheduleDesk

College timetable scheduling system — manual, clash-blocked assignment with automatically derived faculty timetables. See [PLAN.md](./PLAN.md) for the full spec, data model and roadmap.

## Stack

React + Vite + TypeScript + Tailwind + shadcn-style UI (`client`) · Node + Express + TypeScript + Zod (`server`) · PostgreSQL + Prisma (`prisma/schema.prisma`).

## Setup

**Run every command from the repo root** — this is an npm workspaces project, so
`npm install` and `npm run dev` belong at the top level, not inside `client/` or `server/`.

```bash
npm run setup        # clean install, creates server/.env if missing
                     # -> now open server/.env and paste your DATABASE_URL
npm run db:migrate   # create tables (starts empty — nothing is seeded)
npm run dev          # client on :5173, API on :4000
```

`npm run setup` never overwrites an existing `server/.env`, so it's safe to
re-run at any time. Don't `cp server/.env.example server/.env` yourself once
`.env` exists — that replaces your real connection string with a placeholder,
and the server will then refuse to start with
*"DATABASE_URL is still the example placeholder"*.

Open http://localhost:5173.

### If something won't start

Almost every startup failure is a stale `node_modules`. Run:

```bash
npm run setup
```

That deletes every `node_modules` and lockfile in the repo and reinstalls from scratch.
It fixes both of the common errors:

- **"Cannot find native binding"** — native binaries (esbuild, rollup) are platform-specific,
  so a `node_modules` tree or lockfile copied from another machine or OS won't work.
- **"Cannot find package 'zod'"** — dependencies were added after your last install.

If instead you see **"Can't reach database server"** or **"DATABASE_URL is still the
example placeholder"**, the problem is `server/.env`, not your install — put the real
connection string back.

Don't commit or copy `node_modules` or `package-lock.json` between machines.

## Scripts (from repo root)

| Script | What it does |
|---|---|
| `npm run setup` | Wipe all installs and reinstall cleanly — fixes most startup errors |
| `npm run dev` | Client + API together |
| `npm run build` | Production build of both |
| `npm run typecheck` | Typecheck both workspaces |
| `npm test` | Unit tests: conflict engine (server) + grid layout (client) |
| `npm run db:generate` | Regenerate Prisma client after schema edits |
| `npm run db:migrate` | Create/apply a migration |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run db:reset` | Drop and recreate all tables (destructive) |

## Structure

```
client/    React app
  src/components/ui/    Small UI primitives (button, input, dialog, table…)
  src/components/       CrudSection — shared shell for master-data screens
  src/hooks/            Generic list/create/update/delete query hooks
  src/lib/              API client, shared types
  src/components/timetable/  Grid layout maths + the shared timetable table
  src/pages/            One file per screen
server/    Express API
  src/lib/periods.ts    Period-grid + lab-window computation
  src/lib/scheduling.ts The conflict engine — pure, no DB, fully unit-tested
  src/lib/importer.ts   Reads existing timetable sheets — also pure and tested
  src/lib/errors.ts     Central error handling, friendly DB error messages
  src/routes/           masterData.ts, terms.ts, curriculum.ts, timetable.ts, importer.ts
  test/                 Integration script + notes
prisma/    schema.prisma + migrations
scripts/   clean-install.mjs
```

## Current status

- **Phase 0 — scaffold** ✅
- **Phase 1 — master data + term setup** ✅ departments, branches, sections, rooms, subjects, faculty, faculty-subject eligibility, academic terms, editable daily timings with live period-grid preview
- **Phase 2 — curriculum & assignment** ✅ per-section subject list with required weekly theory/lab hours, faculty chosen per subject (restricted to eligible faculty), section readiness tracking, faculty workload view
- **Phase 3 — conflict engine** ✅ faculty / room / section clash detection across all years, lab-window rules, room-type rules, curriculum & assignment consistency, weekly-hour validation, slot-availability API
- **Phase 4 — timetable builder UI** ✅ pick a subject or activity, then only legal slots are clickable; blocked cells greyed with the reason on hover; 3-period labs placed in one click; live per-subject progress
- **Phase 5 — section + faculty views** ✅ printable section sheet matching the office layout (two-row time header, merged break/lunch columns, subject/faculty legend, room sub-grid) and the derived faculty timetable with free periods
- **Phase 6 — print** ✅ print stylesheet plus a page that prints every section's timetable in one pass. "Save as PDF" in the browser's print dialog produces a single file, so no server-side PDF dependency is needed
- **Phase 7 — academic year reset** ✅ roll into a new term without losing anything: master data untouched, the old term archived intact and re-openable, curriculum optionally carried forward, faculty assignments deliberately not
- **Phase 8 — polish** ✅ dashboard driven by real per-section build status (what to do next for each section, with progress), print-all page, and a warning when a section has no home room
- **Import** ✅ read an existing Excel/CSV timetable sheet into a section, creating the subjects, faculty, curriculum hours and assignments it implies

All eight phases are complete. **87 unit tests** (`npm test`) plus four integration
scripts covering scheduling, importing, year reset and build status — see
[server/test/README.md](./server/test/README.md).

## Design notes

**Everything about timing is configuration.** Start time, period count, period length, and where break and lunch fall are stored per term. Clock times, the printed header and the valid lab windows are all computed from that — 8:00–3:00 with 50-minute periods and 9:00–5:00 with 60-minute periods are the same code path.

**Labs are three continuous periods.** Lunch does not break that continuity (it isn't a teaching period), but the mid-morning break does. Valid lab start periods are derived from the time config rather than hardcoded.

**Faculty timetables are never stored.** They're a query over the placed timetable entries, so they can't drift out of sync with the section timetables they come from.

**The conflict engine is pure.** `server/src/lib/scheduling.ts` takes plain data and returns plain data — no database, no HTTP. That keeps the rules that must never be wrong testable in isolation, and lets the same code answer both "is this placement legal?" and "where *could* this go?". The second question is what makes the grid clash-*blocked* rather than clash-*warning*: invalid slots are greyed out before the user clicks.

**Weekly hours are a hard rule; workload is a soft one.** A section can't be saved under or over its required hours — a timetable that doesn't deliver the syllabus isn't usable. Faculty daily load only warns, and it counts theory hours against the six-hour norm, so the valid 4-theory-plus-a-3-hour-lab day isn't flagged.

**The database starts empty.** No seed data, no demo rows. Everything is entered through the app.

**A section without a home room loses room-clash protection.** Non-lab classes are stored against the section's home room; with no room set there is nothing to compare, so two sections could silently be put in the same place. Rather than fail quietly, `validateSection` raises a warning and the dashboard flags it.

**A year reset never deletes anything.** Rolling the year creates a new term and makes it active; the previous one keeps its timetables, curriculum and assignments and can be made active again to read or print. Master data — departments, branches, sections, rooms, faculty, subjects — belongs to the college rather than the year, so it is untouched. The curriculum can optionally be carried forward, since the syllabus usually outlives the staffing; faculty assignments never are, because those are exactly what changes.

**Importing never bypasses the rules.** A sheet is read in two steps — preview shows exactly what was found and changes nothing; commit then runs every single placement through the same conflict engine the manual builder uses. Importing a sheet that would double-book a faculty member reports each collision rather than forcing it in.

**Labs split across lunch when rendered.** A lab occupies three consecutive periods, but lunch may fall between two of them — periods 4-5-6 lay out as `[P4][P5][LUNCH][P6]`. A single `colSpan={3}` would wrongly swallow the lunch column, so `gridLayout.ts` splits the block into contiguous runs and renders two cells that read as one. This is unit-tested, because it is exactly the sort of thing that breaks silently.
