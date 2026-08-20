# ScheduleDesk

College timetable scheduling system — manual, clash-blocked assignment with automatically derived faculty timetables. See [PLAN.md](./PLAN.md) for the full spec, data model and roadmap.

## Stack

React + Vite + TypeScript + Tailwind + shadcn-style UI (`client`) · Node + Express + TypeScript + Zod (`server`) · PostgreSQL + Prisma (`prisma/schema.prisma`).

## Setup

**Run every command from the repo root** — this is an npm workspaces project, so
`npm install` and `npm run dev` belong at the top level, not inside `client/` or `server/`.

```bash
npm run setup        # clean install, creates server/.env if missing
                     # -> now open server/.env and set DATABASE_URL
                     #    and ADMIN_PASSWORD
npm run db:migrate   # create tables (starts empty — nothing is seeded)
npm run dev          # client on :5173, API on :4000
```

`ADMIN_PASSWORD` is the password the timetable office signs in with. Without
it nobody can reach the admin side at all; the public timetable and class
adjustment pages still work.

`npm run setup` never overwrites an existing `server/.env`, so it's safe to
re-run at any time. Don't `cp server/.env.example server/.env` yourself once
`.env` exists — that replaces your real connection string with a placeholder,
and the server will then refuse to start with
*"DATABASE_URL is still the example placeholder"*.

Open http://localhost:5173.

## Who sees what

| | Public — no login | Administrator |
|---|---|---|
| Student timetable (`/`) | ✅ view | ✅ |
| Class adjustment (`/adjustment`) | ✅ view | ✅ |
| Live timetable | ✅ view | ✅ |
| Working timetable | ✗ | ✅ |
| Edit timetable, rooms, master data | ✗ | ✅ |
| Publish working → live | ✗ | ✅ |

The admin side lives under `/admin`. The gate is on the server: every route
except `/api/health`, `/api/auth/*` and `/api/public/*` requires an admin
session, so hiding buttons is never what keeps a visitor out.

## Live and working timetables

The timetable everyone is following is **live**. To prepare next week's
changes, create a **working copy** — a complete, separate set of timetable
rows that starts out identical. Editing the working copy cannot affect the
live one, because they are different rows.

```
LIVE ──used by students & faculty──┐
  │                                │
  └─ create working copy ──► WORKING ──admin edits──► publish ──► becomes LIVE
                                                                    (old live
                                                                     kept as
                                                                     history)
```

While a working copy exists the live timetable is **locked**: the server
refuses any edit aimed at it, whatever the client sends. Discard the working
copy to unlock live again.

Master data — faculty, rooms, subjects, sections, periods, days — is **shared**
by every version. There is one record per faculty member no matter which
timetable is open.

## Faculty numbers

Every faculty member has a unique number (`FAC001`, `FAC002`, …), shown as
`FAC003 — Ms. Y. Sireesha` everywhere a faculty member appears. Two people
with the same name stay separate records. Relationships still use the internal
id; the number is for humans. Leave the field blank when adding someone and
the next free number is assigned.

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
| `npm run lint --workspace=client` | Lint the client |
| `npm run db:generate` | Regenerate Prisma client after schema edits |
| `npm run db:migrate` | Create/apply a migration |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run db:reset` | Drop and recreate all tables (destructive) |
| `npm run db:deploy` | Apply pending migrations non-interactively (used by Render, not local dev) |

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
  src/lib/auth.ts       Admin session: signed cookie, requireAdmin gate
  src/lib/versions.ts   Live/Working versions — copy, publish, the live lock
  src/routes/           auth.ts, public.ts, versions.ts, masterData.ts, terms.ts,
                        curriculum.ts, timetable.ts, rooms.ts, overview.ts, importer.ts
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
- **Phase 9 — public views, admin login, timetable versions** ✅ public student timetable and class-adjustment pages needing no login, server-enforced admin authentication, live/working timetable versioning with publish and history, unique faculty numbers

**93 unit tests** (`npm test`) plus seven integration scripts covering
scheduling, importing, year reset, build status, room allocation, the
free-span / block-floor / cascade-delete behaviour, and the live/working,
public-access and faculty-number rules — see
[server/test/README.md](./server/test/README.md).

## Deployment

Server on Render, client on Vercel. See [DEPLOYMENT.md](./DEPLOYMENT.md) for exact commands and dashboard settings.

## Design notes

**Everything about timing is configuration.** Start time, period count, period length, and where break and lunch fall are stored per term. Clock times, the printed header and the valid lab windows are all computed from that — 8:00–3:00 with 50-minute periods and 9:00–5:00 with 60-minute periods are the same code path.

**Labs are as long as you say they are.** A lab covers however many consecutive periods you pick when placing it — one, three, five. There is no continuity rule left: a lab may run across the break or lunch, because the admin knows the building better than the app does. The only limit is that the block has to fit inside the day.

**Morning and afternoon periods can be different lengths.** The college runs 60-minute mornings and 50-minute afternoons, so the term stores both. The split is lunch: periods up to and including lunch use the morning length, everything after uses the afternoon length. Clock times, the printed header and the whole grid follow from that.

**Rooms are organised by block and floor.** Blocks A, L and V, floors GF/FF/SF/TF/LF, giving names like `AFF-3`. Both are stored as fields so room lists can be filtered, and a whole floor can be created in one go rather than a room at a time. A room can optionally be reserved for one year; rooms with no year set are available to everyone.

**Room allocation stores nothing new.** A class already carries the room it runs in, so allocating a room just points an existing class at a different one. That single field is read two ways: the room's own timetable (`WHERE roomId = X`) and the Room Allocation grid under each section timetable. They cannot disagree, because they are the same data. Allocation is done from the room timetable, where you can see what else is competing for the space; clearing an allocation frees the room and leaves the lesson exactly where it was.

**Deleting a subject removes it everywhere.** Faculty eligibility, every section's curriculum row, the locked-in assignments and any classes already on a timetable. The confirmation dialog fetches and shows those counts first, because it is not a recoverable action.

**Faculty timetables are never stored.** They're a query over the placed timetable entries, so they can't drift out of sync with the section timetables they come from.

**The conflict engine is pure.** `server/src/lib/scheduling.ts` takes plain data and returns plain data — no database, no HTTP. That keeps the rules that must never be wrong testable in isolation, and lets the same code answer both "is this placement legal?" and "where *could* this go?". The second question is what makes the grid clash-*blocked* rather than clash-*warning*: invalid slots are greyed out before the user clicks.

**Weekly hours are a hard rule; workload is a soft one.** A section can't be saved under or over its required hours — a timetable that doesn't deliver the syllabus isn't usable. Faculty daily load only warns, and it counts theory hours against the six-hour norm, so the valid 4-theory-plus-a-3-hour-lab day isn't flagged.

**The database starts empty.** No seed data, no demo rows. Everything is entered through the app.

**A section without a home room loses room-clash protection.** Non-lab classes are stored against the section's home room; with no room set there is nothing to compare, so two sections could silently be put in the same place. Rather than fail quietly, `validateSection` raises a warning and the dashboard flags it.

**A year reset never deletes anything.** Rolling the year creates a new term and makes it active; the previous one keeps its timetables, curriculum and assignments and can be made active again to read or print. Master data — departments, branches, sections, rooms, faculty, subjects — belongs to the college rather than the year, so it is untouched. The curriculum can optionally be carried forward, since the syllabus usually outlives the staffing; faculty assignments never are, because those are exactly what changes.

**Importing never bypasses the rules.** A sheet is read in two steps — preview shows exactly what was found and changes nothing; commit then runs every single placement through the same conflict engine the manual builder uses. Importing a sheet that would double-book a faculty member reports each collision rather than forcing it in.

**Labs split across lunch when rendered.** A lab occupies three consecutive periods, but lunch may fall between two of them — periods 4-5-6 lay out as `[P4][P5][LUNCH][P6]`. A single `colSpan={3}` would wrongly swallow the lunch column, so `gridLayout.ts` splits the block into contiguous runs and renders two cells that read as one. This is unit-tested, because it is exactly the sort of thing that breaks silently.

**A working copy is rows, not a flag.** Isolation between the live and working
timetables comes from `TimetableEntry.versionId`: they are two disjoint sets of
rows. Nothing reads "is this the live one?" per field, so there is no field
anyone can forget to check. On top of that, the server refuses edits aimed at
the live version whenever a working copy exists, which removes the last way to
touch live by accident.

**Availability is derived, never maintained.** The class-adjustment page works
out who is free by asking the live timetable who has no class in that period.
There is no availability list for anyone to keep up to date, so it cannot go
stale.

**The public API has no write routes.** `/api/public/*` is mounted before the
admin gate and rejects anything that isn't a GET. It is not a set of endpoints
that happen not to write — it is a router that cannot.
