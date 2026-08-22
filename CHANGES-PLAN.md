# ScheduleDesk — 2026-08-22 changes, as built

Built on top of `30d7190`. All 12 requested items are implemented and verified.
Nothing was applied to your Neon database — every test below ran against a
throwaway Postgres in a sandbox.

## Your three decisions, and what they changed

| Decision | Answer | Effect |
|---|---|---|
| Delete All Data | *"present let the data be there dont interrupt"* | **Built, never run.** The endpoint and the gated dialog exist; your Neon data is untouched. Read §7 before you first click it. |
| Room timetables below section grids | Remove public + print, **keep admin** | Public and Print-all lost theirs. `SectionTimetablePage`'s Room Allocation grid stays as an admin working aid. |
| Sports colour | Skip | No Prisma enum change, no migration. Seven session colours, not eight. |

**No Prisma schema change and no migration were needed for anything.**

---

## 1 + 12. Faculty identifiers are admin-only now

`Faculty.facultyNo` (FAC001…) is the only human-facing faculty identifier this
schema has — there is no separate employee number or internal code. It is now
stripped **at the server**, in `server/src/routes/public.ts`, so it is absent
from the JSON entirely — not hidden by CSS, not filtered in the browser. It
isn't in view-source or the network tab either.

- `facultyLabel()` returns the bare name.
- The class-adjustment list is ordered by **name**, since ordering by an
  invisible number would look arbitrary.
- `PublicFacultyRef` and a new `PublicLegendRow` in `types.ts` no longer carry
  the field, so TypeScript flagged every render site.
- `faculty.id` (an opaque cuid) stays — the adjustment page needs a handle to
  select someone by. It is never displayed.

Admin views are untouched: `facultyNo` still appears on Master Data, the
faculty timetable, the room dialog and every print sheet behind the login.

**Verified** by walking the entire JSON tree of all four public endpoints for
the key `facultyNo`, rather than checking the two or three fields I happened to
remember. Zero hits on any of them.

## 2 + 8. One grid per section, everything inside the cell

New `client/src/components/timetable/ClassCell.tsx`, used by the public grid,
the admin section sheet, the faculty sheet and all three print pages — so those
five surfaces cannot drift apart again.

```
CN
Dr. Subbaiah
AFF-1
```

Faculty names are abbreviated to honorific + last word (`Dr. K. Venkata
Subbaiah` → `Dr. Subbaiah`), matching the format in your examples. Full names
stay in the subject/faculty legend under the grid. Cells grew from 44px to
~56px; deleting the room sub-grid more than pays that back, so each printed
sheet is *shorter* than before.

Removed: `RoomWeekGrid.tsx`, `roomTimetable` from `/public/sections/:id/timetable`
and from `/print/sections`, and the `SectionHomeRoomTimetable` type.

## 3. Dashboard order

`DashboardPage.tsx` rebuilt as: **Master Data → Academic Settings → Timetable
Builder → Timetables → Reports → Reset Academic Year.** The "Getting started"
checklist stays pinned above all of it while setup is incomplete — it's a
blocker, not a section.

## 4. Sections → Year filter

Client-only; `GET /sections` already accepted `?year=`. Labels read "1st Year …
4th Year". Filtering happens server-side, so picking a year fetches that year
rather than downloading everything and hiding most of it.

## 5 + 6. Print all faculty / Print all room timetables

Two new endpoints in `overview.ts` — `GET /print/faculty`, `GET /print/rooms` —
each loading the term once and slicing it in memory rather than making the
browser call the per-faculty endpoint fourteen times against a sleeping
free-tier instance.

Two new pages at `/admin/print/faculty` and `/admin/print/rooms`, one page per
faculty member/room, `break-before: page` between them. Faculty and rooms with
no classes are skipped by default; a checkbox brings them back. Buttons added
to the Faculty page, the Rooms page, the existing Print page and the dashboard.

## 7. Delete All Data ⚠️ built but never run

`POST /api/terms/delete-all`, behind the existing admin cookie gate, plus two
more gates:

1. the admin password, checked with the same `passwordMatches()` helper the
   login uses — one source of truth, no new secret;
2. the exact phrase `DELETE ALL DATA`, case-sensitive and untrimmed.

Then thirteen `deleteMany` calls in one `prisma.$transaction([...])`, ordered
leaves-inward because several FKs on this schema are RESTRICT, not CASCADE:

```
entries → assignments → curriculum → eligibility → versions → timeConfig
→ terms → sections → subjects → faculty → rooms → branches → departments
```

`GET /api/terms/delete-all-preview` returns the exact row counts, shown in the
dialog before you type anything. After deleting, the endpoint re-counts and
returns a 500 rather than reporting success if anything survived — that catches
a future table being added to the schema and forgotten here.

UI: a red "Danger zone" card at the bottom of the Reset Year page, collapsed
behind a disclosure, well away from the button you press every June.

**Before you ever click it: take a Neon branch.** Your database holds real
college data and this is designed to be unrecoverable. And note that Academic
Year Reset already gives you a clean term while keeping master data and
history — that is the right tool almost every time.

## 9. Colour coding

Seven CSS custom properties in `index.css`, registered in `@theme inline` so
Tailwind emits `bg-tt-lab` etc., with a full dark-mode set. One module
(`entryStyles.ts`) maps session → colour; one component (`TimetableLegend.tsx`)
draws the key. Both are used by admin, public and print.

Theory blue · Lab green · Library cyan · Seminar purple · Counselling orange ·
Break grey · Lunch dark grey.

Each cell also gets a coloured left edge — not decoration: on a mono laser
printer every pastel fill collapses to a similar grey, and the edge keeps the
types apart by density. The legend lists only the colours actually on that
sheet.

## 10. Printing

`PrintFitPage` gained a **minimum scale floor of 0.55**. Previously it would
shrink a tall sheet until it fit, however unreadable that made it — a silent
failure. Below the floor it stops and allows a second page, because two legible
pages beat one unreadable one. Applied to all six printed surfaces.

## 11. Responsive

- Admin nav: nine links collapsed into a menu button below `lg`, replacing the
  horizontally-scrolling strip that hid most of them behind a gesture nobody
  knows is there.
- `Dialog`: capped at `100dvh - 2rem` with its own scroll and a pinned header —
  a long form's submit button used to be unreachable on a phone, because a
  native `<dialog>` doesn't scroll its overflow and the page behind it is inert.
- `html, body { overflow-x: clip }` — `clip`, not `hidden`, so it doesn't become
  a scroll container and break `position: sticky`.
- Grids scroll inside their own box; the page itself never scrolls sideways.

---

## Verification

All of this ran against a throwaway Postgres 16 in the sandbox, never Neon.

| Check | Result |
|---|---|
| `npm run typecheck --workspace=server` | clean |
| `npx tsc -b client` | clean |
| `npm run typecheck:test --workspace=client` | clean |
| `vite build` (production) | clean — 465 kB main + 341 kB lazy import chunk |
| Server unit tests | **81 / 81** |
| Client unit tests | **12 / 12** |
| `integration.mjs` | 26 / 26 |
| `integration-import.mjs` | 24 / 24 |
| `integration-reset.mjs` | 22 / 22 |
| `integration-overview.mjs` | 19 / 19 |
| `integration-rooms.mjs` | 30 / 30 |
| `integration-newfeatures.mjs` | 28 / 28 |
| `integration-versions-public.mjs` | **58 / 58** |
| `integration-visibility-deleteall.mjs` *(new)* | **60 / 60** |
| Browser click-through, 14 pages | no console errors, no failed requests, nothing blank |
| Mobile 390×844, 4 pages | 0px horizontal overflow on every one |

Plus two things worth calling out because they test assumptions rather than code:

- **The colour utilities really compile.** `bg-tt-theory`, `border-l-tt-lab-ink`
  and the rest were grepped out of the built CSS bundle — a Tailwind v4 token
  that isn't registered fails silently as a missing class, not an error.
- **The rollback is real, not assumed.** A deliberately wrong-order delete was
  run inside one Postgres transaction: the first statement succeeded, the second
  hit the FK, and the whole thing rolled back with every row intact. Partial
  deletion genuinely cannot happen.

### Two pre-existing test failures, fixed

`integration-versions-public.mjs`'s Test 3 still asserted the **original**
class-adjustment API — `selectedClass`, `availableFaculty`, per-slot `isTarget`,
`label: "FREE"` — all replaced on 2026-08-21 when that page was reworked to
day → faculty → hour with tiered candidates. Rewritten against the current
shape. These predate this session; they were not caused by the visibility
change.

---

## Still yours to do

1. **`npm run dev` and click through.** I drove a real browser here, but against
   sandbox data — your 221 real classes will stress the print fit harder than
   my 17.
2. **Print one of each** (section / faculty / room) and check the page count.
   The 0.55 floor means a genuinely huge grid will now take two pages instead of
   shrinking to nothing.
3. **Delete `_to_delete/` at the repo root.** It holds `RoomWeekGrid.tsx`, two
   scratch tarballs, and that stray mis-quoted-commit file that was already in
   your tree. The bridge can't delete files, only move them.
4. **`git fetch origin`.** See the note below.
5. **Take a Neon branch** before Delete All Data goes anywhere near production.

## One thing that went wrong, and what it means for your repo

A shell command I ran to copy files onto your disk had a broken `&&` chain: when
its `tar` step failed, the loop that followed still ran, but with the working
directory left at your project root. It truncated files to zero bytes as it
walked the tree before the 45-second timeout stopped it — everything from
`.gitignore` through `DEPLOYMENT.md` alphabetically, which was all of `client/`,
a few root files, and `.git`'s own top-level metadata.

Recovered in full:

- **`.git/objects` was untouched** — all 315 objects intact, none truncated.
  `HEAD`, `config`, `index`, the refs and the reflogs were rebuilt by hand from
  commit `30d71906a7acd5707a63c9b7a08a18d4d86c2adb`, which is your real tip.
- Every zeroed tracked file was restored from HEAD with `git cat-file`, verified
  by `git ls-files | test -s` finding no empty file left.
- All 25 of this session's files were re-written through the file bridge and
  checksum-matched byte-for-byte against my copies.

Two consequences you should know about:

- **`.git/config` was rewritten from scratch.** The remote, fetch refspec and
  the `main` branch tracking are back, but any *local* `user.name` /
  `user.email` you had set for this repo is gone — commits will use your global
  identity. Set them again if that repo used a different one.
- **`.git/logs` (the reflog) is empty**, and `refs/remotes/origin/main` was
  written to the same SHA as local `main`. Run **`git fetch origin`** once to
  resync the remote-tracking ref to reality.

Your commit history, all branches and every object are intact. Nothing was
pushed and nothing was committed — the working tree is yours to review.
