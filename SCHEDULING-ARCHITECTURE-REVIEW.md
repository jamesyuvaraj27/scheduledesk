# ScheduleDesk — Timetable Allocation Architecture Review

Grounded in your actual `prisma/schema.prisma`, `server/src/lib/scheduling.ts`,
`server/src/routes/timetable.ts` and `server/src/routes/rooms.ts` — not
generic scheduling-system theory. Headline verdict first, because it changes
how you should read everything below: **the architecture your three cases
need is already built, and it already enforces exactly the three conflicts
you listed as examples.** This is a review of what exists, not a proposal
for a rewrite. No code below — as asked.

---

## 1. Architecture recommendation

The naive way to model this is four direct relationships: Faculty↔Section,
Faculty↔Subject, Section↔Room, Room↔Timetable. That's the wrong model, and
it's not what you built. The right model — and the one your schema already
uses — is **event-centric**: one table (`TimetableEntry`) is the hub, and
every "relationship" the seven questions ask about is a *query* over that
table, not a separate relation you maintain by hand.

Concretely: `TimetableEntry` = (Section, Day, Period, EntryType,
Subject?, Faculty?, Room?). "Which sections does Faculty A teach" isn't a
stored fact anywhere — it's `WHERE facultyId = A`, grouped by `sectionId`.
"What's Room 101's week" is `WHERE roomId = 101`. This is the same pattern
every calendar/booking system uses (Google Calendar doesn't store
"User↔Room" as a direct table either — it stores Events that reference
both), and it's the correct one here because your three cases all boil down
to the same primitive repeated: *one class, at one time, needs one section,
one faculty member (derived, not chosen), and optionally one room.* A direct
many-to-many between Faculty and Section would lose the "for which subject,
at which time" context that makes Case 3 (two faculty, two sections, shared
room) unambiguous.

So: **hybrid model, correctly implemented already.** Not one-to-one
(doesn't survive Case 2 or 3), not a raw many-to-many between any two of
Faculty/Section/Room (loses time and subject context), but a central
booking record that every other relationship is derived from.

## 2. Entity relationship design

**Faculty ↔ Subject** — many-to-many, via `FacultySubject`. This is
*eligibility*, not assignment: "Faculty A is qualified to teach DBMS,"
independent of any section or term. Correctly unscoped by term — eligibility
doesn't change every semester the way curriculum hours do.

**Section ↔ Subject** — many-to-many, via `SectionSubject`, scoped by term
(`@@unique([termId, sectionId, subjectId])`). This is the curriculum:
required weekly theory/lab hours. Scoped by term because next semester's
subject list and hours differ from this one's — correct.

**Faculty ↔ Section** — this is the one worth being precise about, because
"many-to-many" is the wrong answer even though it looks superficially true
(one faculty teaches several sections; one section has several faculty).
The actual relationship is **ternary**: `SectionAssignment` maps
`(Term, Section, Subject) → Faculty`, enforced unique by
`@@unique([termId, sectionId, subjectId])`. Faculty↔Section only exists as a
*projection* of this — drop the Subject column and you get an implicit
many-to-many, but the system never stores it that way, because a raw
Faculty↔Section table couldn't express "Faculty A teaches Section A's DBMS
but not Section A's OS." Your Case 3 example (Faculty A → DBMS → Section A,
Faculty B → OS → Section A... or → Section B) is exactly what this ternary
relation is for, and it already works: nothing in the schema stops two
different `SectionAssignment` rows for the same section pointing at two
different faculty for two different subjects, or the same faculty appearing
in assignment rows for two different sections (Case 2).

**Room ↔ Timetable** — not a relationship at all, in the sense of a stored
association. `roomId` is a nullable column directly on `TimetableEntry`.
"Room 101's timetable" is `WHERE roomId = '101'`. Two sections can share
"the same room at different time slots" (your Case 2/3 phrasing) with zero
special-casing, because room occupancy is just another column checked for
overlap on the same entry table everything else lives on.

One design choice worth flagging because it's easy to miss reading the
schema alone: **faculty is never chosen at placement time.** Look at
`buildCandidate()` in `timetable.ts` — when you place a class, the
`facultyId` written to the entry comes from `ctx.assignments.get(subjectId)`,
i.e. from the `SectionAssignment` locked in during term setup, not from a
picker on the placement screen. This is deliberate and correct: it makes
"Faculty A isn't the assigned faculty for this subject" a validation error
(`FACULTY_NOT_ASSIGNED`) rather than a silent possibility, and it's what
real timetable committees do too — faculty-to-subject binding happens once,
in workload allocation, not per class.

## 3. Scheduling strategy

Precisely, what you have is **rule-based validation plus exhaustive slot
search** — not greedy, not backtracking, not a general constraint solver.
`validatePlacement()` is a deterministic list of business rules (working
day, span limits, curriculum membership, faculty assignment, room type,
then the three overlap checks) that either returns zero conflicts or a
specific list of them. `computeAvailability()` doesn't search intelligently
for a good slot — it just runs `validatePlacement()` against every
(day, period) combination in the term's grid and reports which passed. At
your actual domain size (≤6 working days × ≤~8 periods ≈ 48 combinations
per check), that brute-force approach is faster to reason about and to keep
correct than a smarter search would be, and it's instant in practice —
there is no algorithmic reason to make it cleverer.

This is the right choice for Cases 1–3, and I'd say so even if you hadn't
already built it: all three describe **human-directed placement** — an
admin picking where a specific class goes, with the system's job being "tell
me instantly if that's illegal, and show me what *is* legal." That's a
validation problem, not a search problem. Backtracking or a CP/SAT solver
(the tools people reach for in the "university timetabling problem"
literature) solve a different problem: *generate an entire term's timetable
from scratch, unattended, satisfying every constraint at once.* That's
NP-hard in general, meaningfully harder to build and to debug when it
produces a placement nobody can explain, and — importantly for how you're
optimizing right now — not what any of your three cases ask for. If you
ever want a "build the whole term in one click" feature, that's the point
where backtracking/CP-SAT earns its complexity. Don't build it speculatively;
your rule engine already generalizes cleanly to N sections and M faculty
without it, and adding a solver you don't need yet is exactly the kind of
over-research-and-delay trap you've flagged for yourself.

## 4. Conflict detection

Your three example conflicts are already implemented, server-side, not as
UI hints but as hard 409 rejections on every create/move — I checked the
exact logic:

Faculty A cannot teach two sections at once: in `validatePlacement()`'s
overlap loop, `entry.facultyId === candidate.facultyId && entry.sectionId
!== candidate.sectionId` → `FACULTY_CLASH`. Room 101 cannot host two classes
at once: same loop, `entry.roomId === candidate.roomId && entry.sectionId
!== candidate.sectionId` → `ROOM_CLASH`. Section A cannot attend two classes
at once: `entry.sectionId === candidate.sectionId` → `SECTION_CLASH`. All
three trigger only when `overlaps()` first confirms the day matches and the
period ranges intersect — a genuine interval-overlap check, not just
"same start period," so a 3-period lab correctly blocks a 1-period class
that starts in the middle of it.

Two details worth knowing about because they're the kind of thing that
looks like a bug until you see why it's there. First, the room-clash check
explicitly excludes same-section collisions (`entry.sectionId !==
candidate.sectionId`) — not a gap, a deliberate de-dup: a same-section,
same-time, same-room clash is already `SECTION_CLASH`, so this avoids
reporting one real problem as two different conflicts. Second, the conflict
context (`entries` in `SchedulingContext`) loads **every entry in the term,
across every section and year**, not just the section being edited — that's
what lets a 2nd-year placement correctly clash against a faculty member's
existing 4th-year commitment. This is the part manual Excel-based
timetabling routinely gets wrong, because nobody's cross-checking a
2nd-year sheet against a 4th-year sheet by eye.

One gap, low-severity: `WRONG_ROOM_TYPE` only special-cases LAB vs
CLASSROOM. `RoomType` also includes `LIBRARY` and `SEMINAR_HALL`, but a
`LIBRARY`-type entry isn't currently checked against a `LIBRARY`-type room
— it silently falls back to the section's home classroom via
`resolveRoomId()`, same as theory does. If your colleges actually track a
physical library/seminar hall as a distinct bookable room (rather than just
holding library hour in the usual classroom), that's worth closing; if not,
leave it — it costs nothing sitting unused.

## 5. Room allocation strategy

Hybrid, already implemented, and it's the right one — I'd recommend this
even starting from scratch. `resolveRoomId()`: every entry type except LAB
defaults to the section's `homeRoomId` unless an explicit room is given;
LAB always requires an explicit room (`MISSING_ROOM` if not). Fixed-only
fails because labs are a genuinely shared, scarce resource — you can't give
every section its own permanent lab. Dynamic-only fails because it adds
friction for zero benefit on the 90% case: a section's theory classes don't
need a fresh room lookup every single period when they always meet in the
same classroom. The hybrid gives you both: zero-friction default for the
common case, explicit allocation (via `PATCH /entries/:id/room`, checked
through the same `validatePlacement()`) for the case that actually needs
choosing. This also directly supports your Case 2/3 "same room, different
time slots" scenario — nothing about the model assumes a room belongs to
one section; it's just whichever entries currently reference it.

## 6. Scalability

Concrete numbers, because "will it scale" is more useful answered in real
row counts than in the abstract. A single college — even a large one, 6
branches × 4 years × 3 sections × ~30 periods/week — tops out around 2,000
active `TimetableEntry` rows per term. Every conflict check does one O(n)
linear scan over that array in memory (`entries.filter/find` in
`scheduling.ts`); at n=2,000 that's sub-millisecond, and it stays that way
up to at least 10–20x your realistic ceiling. This is not going to be your
bottleneck at any scale one college produces, and the composite indexes
already in the schema (`[versionId, sectionId, dayOfWeek]`,
`[versionId, facultyId, dayOfWeek]`, `[versionId, roomId, dayOfWeek]`) mean
the Postgres side isn't either.

The part that *would* need attention first, if it ever mattered: every call
to `/sections/:id/availability` and `/sections/:id/entries` re-fetches
*every* entry, room, and faculty member for the whole term
(`loadContext()`/`loadTermContext()`), not just what's relevant to the
section being edited. At your scale that's still a fast query — but it's
the thing to narrow (e.g. cache the term's entries for the request, or
scope the fetch) if you ever have many admins editing concurrently against
a cold free-tier Render/Neon instance, which is a latency problem, not a
correctness or algorithmic one. Not worth touching now; worth remembering
the name of if a client ever complains the builder feels slow.

## 7. How real colleges do this, compared

Faculty allocation in practice is usually a manual workload-committee
exercise: an HOD cross-references a faculty-eligibility matrix (your
`FacultySubject`) against a per-faculty weekly-load cap (AICTE-adjacent
norms typically land around 16–18 periods/week for a lecturer, less for
someone carrying admin load) and hands out subject-section bindings by
hand — structurally the same shape as your `SectionAssignment`, just done
in a spreadsheet instead of enforced by a unique constraint. Room
allocation is almost always fixed-home-classroom-plus-shared-labs, which is
exactly your hybrid model. Conflict checking is done by eye against a
master register, which is precisely the class of error your global
cross-section-and-year `entries` context automatically prevents — a
2nd-year/4th-year faculty double-booking is the single most common manual
scheduling mistake, and it's the one your system can't produce even by
accident. Your `ClassAdjustmentPage` (day→faculty→hour substitution
picking) also mirrors a real, specific workflow — "Faculty X is on leave,
who covers their 3rd period" — that most from-scratch timetabling tools
skip entirely because it's not glamorous, but every real college needs it
weekly.

The one thing real colleges enforce that your system doesn't yet: a
**maximum weekly load per faculty member.** You have a soft *daily* theory
warning (`DEFAULT_DAILY_THEORY_WARN = 6`) but nothing weekly, and nothing
that's a hard block rather than an advisory. This is the most realistic
gap between what you've built and how a workload committee actually
operates — see the implementation plan below if you want to close it.

## 8. Is the current Prisma schema sufficient?

**Yes, for Cases 1–3 as described — no migration needed.** I traced all
three through the actual schema and none of them require a new column,
table, or relation: Case 1 is one `SectionAssignment` row plus one
`TimetableEntry`. Case 2 is two `SectionAssignment` rows sharing a
`facultyId`, and two `TimetableEntry` rows optionally sharing a `roomId` at
non-overlapping day/period — already legal, already conflict-checked. Case
3 is the same shape with two different `facultyId` values instead of one,
optionally two different `subjectId` values. Nothing about any of them
needs a new relationship; they're all just more rows in tables you already
have.

That said, three *optional* hardenings are worth naming, none urgent, none
required by anything asked here — flagging them because you asked "is it
sufficient," not because I'd push you to build them now:

- **`Faculty.maxWeeklyLoad`** (nullable `Int`) — the one real gap identified
  in §7. Additive, non-breaking, and it slots into `validateSection()` next
  to the existing daily-theory warning with the same pattern (soft warning
  first; only make it a hard block if a college actually asks for that).
- **`Section.strength`** (nullable `Int`) — lets you advisory-warn when a
  section's headcount exceeds its room's `capacity` (already a column on
  `Room`, currently unused anywhere). Not a scheduling conflict — rooms
  aren't shared concurrently in this model, so capacity mismatch is a
  data-quality warning, not a clash — so this is genuinely low priority.
- **`WRONG_ROOM_TYPE` for LIBRARY/SEMINAR_HALL** — only worth doing if your
  colleges track a real separate library/seminar-hall building rather than
  just holding those hours in the home classroom. Ask before building;
  don't guess.

None of these block anything you described. I'd ship without them.

## 9. Recommended implementation plan

In case you decide to act on §7/§8 — sized for a single sitting each, no
code written yet as asked:

1. **Faculty weekly-load warning** (~30–45 min). Add
   `maxWeeklyLoad Int?` to `Faculty` (one migration, nullable so existing
   rows need no backfill). In `scheduling.ts`, extend
   `facultyDailyLoad()`'s companion logic with a weekly sum per faculty and
   push a warning into `validateSection()`'s `warnings` array when it
   exceeds `maxWeeklyLoad` — same non-blocking pattern as the existing daily
   check, so nothing that currently saves stops saving.
2. **Section strength vs. room capacity** (~20 min) — only if you actually
   want it. Add `strength Int?` to `Section`, surface it in Master Data's
   section form, and add one more advisory warning line next to the
   existing "no home room" warning in `validateSection()`.
3. **Library/Seminar room-type check** — skip unless a client tells you
   they track those as real separate rooms. Building it speculatively is
   exactly the over-research trap; wait for the signal.

None of this is blocking. Cases 1, 2, and 3 work today, end to end, server-
enforced, against your real schema.
