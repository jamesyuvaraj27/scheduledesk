# Combined Sections — schema & conflict-detection design

Companion to `SCHEDULING-ARCHITECTURE-REVIEW.md`. Same ground rule: no code
yet, this is the design. I re-verified the exact creation path in
`timetable.ts` (`buildCandidate()`, `POST /sections/:id/entries`) before
writing this, not just `scheduling.ts` from last time.

## Verdict

**The schema is ~95% there. One nullable column, one new small table, and
one guard clause in the conflict engine — nothing else changes.** Both
scenarios you described are the *same* underlying gap: today, two
`TimetableEntry` rows that intentionally share a faculty and/or a room at
the same time are indistinguishable from an accidental double-booking, so
the engine correctly-by-its-current-rules rejects both. The fix isn't new
relationships — it's teaching the engine the difference between "this
clash is a mistake" and "this clash is the point."

## What already works, unmodified

Everything about *why* combined sections are representable is already true
of your schema, because — as covered last time — `TimetableEntry` is a
booking record, and a booking record doesn't care how many *other* records
share its room. Concretely: each section in a combined group still needs
its own `SectionSubject` (curriculum hours) and `SectionAssignment`
(subject → faculty) row, exactly as it does today for any subject — there
is nothing special to configure. If two sections combine for the same
subject with the same faculty, that's just two ordinary `SectionAssignment`
rows that happen to point at the same `facultyId`, which is already legal
(it's Case 2 from the last review). `validateSection()`'s weekly-hour
accounting needs zero changes either: each section's `TimetableEntry` row
is still its own complete record, so it counts toward that section's
curriculum hours exactly like any other class. Every read path — the
section grid, the faculty grid, the room grid, the public pages, the print
pages — needs zero changes, because a combined entry is still a normal,
complete `TimetableEntry` from each of those queries' point of view. It'll
just correctly show up in *multiple* sections' grids, and in the shared
room's grid, automatically.

## Exactly where it breaks today

I traced this against the real overlap loop in `validatePlacement()`. If
you tried to create Section B's class today at the same day/period/room/
faculty as Section A's already-placed class, here's precisely what fires,
and why it's currently correct behavior for the case it was written for:

```
entry.facultyId === candidate.facultyId && entry.sectionId !== candidate.sectionId
  → FACULTY_CLASH   ("Faculty A is teaching Section X at that time.")

entry.roomId === candidate.roomId && entry.sectionId !== candidate.sectionId
  → ROOM_CLASH      ("Room 101 is in use by Section X at that time.")
```

Both fire, both correctly by the rule as written today ("no faculty/room
double-booked across different sections"), and both are exactly the two
false positives that need to become "fine, this is intentional" for your
two scenarios. Nothing else in `validatePlacement()` needs to change —
`SECTION_CLASH`, `WRONG_ROOM_TYPE`, `SUBJECT_NOT_IN_CURRICULUM`,
`FACULTY_NOT_ASSIGNED` all stay exactly as strict as they are now, and
should.

## Recommended schema change

One new, small, optional table:

```
CombinedSession
  id        String   @id @default(cuid())
  termId    String
  createdAt DateTime @default(now())
```

Deliberately minimal — it does not own day/period/room/span. Those stay on
each `TimetableEntry`, exactly where they are now. This table exists purely
to be a stable **tag identity** that member entries point at, and to give
you a natural home for a future "list all combined sessions" admin view
without scanning for repeated attribute combinations. It is *not* a second
source of truth for scheduling facts — that distinction matters, because a
table that also stored room/day/period would force every room-grid,
faculty-grid, and conflict-check query to learn a second code path (JOIN
through the group for combined entries, read directly for everything else).
Keeping it tag-only means the conflict engine, and every rendering page,
keeps treating `TimetableEntry` as the single complete record it already
is.

One new nullable column on the existing table:

```
TimetableEntry.combinedSessionId  String?
  → CombinedSession (onDelete: SetNull)
```

Nullable, no backfill, fully additive. Every existing row gets `NULL` and
is completely unaffected. `onDelete: SetNull` rather than `Cascade` is the
deliberate choice — deleting the *grouping* should decouple the member
classes, not delete each section's actual lesson. (After a `SetNull`
dissolve, the formerly-combined entries would very likely now clash against
each other on room/faculty, correctly — dissolving a combined group is not
supposed to silently leave two classes stacked in one room; the admin
would need to actually move one.)

## Recommended conflict-engine change

Add `combinedSessionId?: string | null` to both `PlacedEntry` and
`Candidate` in `scheduling.ts`. Then, in the overlap loop, both the
`FACULTY_CLASH` and `ROOM_CLASH` branches get one extra guard: skip the
clash when both sides carry the same non-null `combinedSessionId`.
`SECTION_CLASH` gets no guard at all — a section still cannot appear twice
in the same slot, combined or not, because a section attending two classes
at once is never legal regardless of why.

This single rule is why it correctly covers *both* of your scenarios
without separate logic for each:

- **One faculty, one subject, many sections, one room:** every member entry
  shares `facultyId` *and* `combinedSessionId`. The guard suppresses
  `FACULTY_CLASH` between them (intended) and `ROOM_CLASH` between them
  (intended). `SECTION_CLASH` still fires if the same section is
  accidentally added twice.
- **Two faculty, two subjects, many sections, one room:** member entries
  split into two `facultyId` groups but share one `combinedSessionId`.
  `ROOM_CLASH` is suppressed between *all* of them (intended — that's the
  whole point of "same room"). `FACULTY_CLASH` was never going to fire
  between the two faculty's entries anyway, since that check already
  requires matching `facultyId` — so the guard doesn't even need to treat
  this case specially. One rule, both scenarios, no branching on "which
  kind of combined session is this."

**Why this is provably non-breaking:** the guard only ever activates when
*both* sides of a comparison have a non-null, equal `combinedSessionId`.
Every entry that exists today has `combinedSessionId = NULL`, and every
entry created through the ordinary single-section flow will continue to
have `NULL` unless explicitly combined. For any pair where either side is
`NULL`, the new guard is a no-op and the exact conflict logic that exists
today runs unchanged. `computeAvailability()` needs no separate change
either — it's built entirely on top of `validatePlacement()`, so the guard
applies there automatically the moment a candidate carries the right
`combinedSessionId`.

## How creation actually works

The important realization here, from re-reading `timetable.ts`: **this
doesn't need a new creation subsystem.** `POST /sections/:id/entries`
already funnels every placement through one shared helper,
`buildCandidate()`, which already does the right thing — it derives
`facultyId` from that section's own `SectionAssignment`, never from the
request body. A "combine" operation is that same helper, called for a
second (third, fourth…) section, with three differences: the day, period,
span and room are taken from the *target* entry being joined rather than
freely chosen, the resulting candidate is stamped with the target's
`combinedSessionId` (minting a new `CombinedSession` row on the first join,
reusing it on subsequent ones) before `validatePlacement()` runs, and the
result is created inside the same transaction as the `CombinedSession` row
when one is being created for the first time.

Concretely, one new endpoint — `POST /entries/:id/combine`, body
`{ sectionId, subjectId? }` — where `subjectId` is required only for the
two-subject scenario (omit it to inherit the target's subject for the
single-subject case). Internally it's: look up the target entry → resolve
the joining section's own faculty assignment for whichever subject applies
(same rule `buildCandidate()` already enforces, so `FACULTY_NOT_ASSIGNED`
still protects you if that section's curriculum isn't configured for it
yet) → build a candidate with the target's day/period/span/room and the new
`combinedSessionId` → validate → create. No parallel code path, no new
rules module — the existing `buildCandidate()` + `validatePlacement()` +
`prisma.timetableEntry.create()` sequence, reused. Leaving a combined
group is even less: it's the existing `DELETE /entries/:id`, unchanged —
removing one member row simply removes that section's participation.

## What does not need to change

Worth stating explicitly, since "does this break anything" was the actual
ask: `validateSection()`, every GET route that renders a grid
(`/sections/:id/timetable`, `/faculty/:id/timetable`, `/rooms/:id/
timetable`, the public and print-all endpoints), `SectionAssignment`,
`SectionSubject`, `FacultySubject`, the LIVE/WORKING version split, and the
Delete-All-Data transaction ordering all need zero changes. The version
split in particular "just works": since a combine operation always reads
and writes through the same `loadContext()`/version resolution every other
entry mutation already uses, you can't accidentally combine a LIVE entry
with a WORKING one — they're never in the same query's candidate pool to
begin with.

## Guardrails worth building in, not enforcing at the database level

Room and time equality across a combined group ("same room, same slot") is
a *creation-time business rule*, not a schema constraint — the same style
already used for "only labs can span multiple periods." The combine
endpoint enforces it by construction (it takes the room/day/period from the
target entry, it doesn't accept new ones), rather than a Postgres CHECK
constraint trying to keep N denormalized rows in sync. This also means
nothing stops a future, deliberate case where a college *wants* the room to
differ (unlikely, but the schema doesn't have to forbid it to prevent
accidental drift — the UI does, by never exposing that field on a join).

One thing to flag back to the previous review, now more relevant: combined
sessions are exactly the scenario where `Section.strength` vs
`Room.capacity` (the optional hardening I flagged as low-priority last
time) starts to matter more — combining sections is specifically an
action that increases how many students are in one room. Still not
required to ship this, but worth keeping in mind if you build one of these
two features before the other.

## Implementation plan

1. **Migration** (~10 min): add `CombinedSession` model, add
   `TimetableEntry.combinedSessionId` (nullable, `onDelete: SetNull`), one
   index on `(combinedSessionId)`.
2. **Conflict engine** (~20 min): add the field to `PlacedEntry`/
   `Candidate`, add the one guard clause to the `FACULTY_CLASH` and
   `ROOM_CLASH` branches, extend `scheduling.test.ts` with the two cases
   from this conversation plus one negative test (same `combinedSessionId`
   still blocks a genuine `SECTION_CLASH`).
3. **`POST /entries/:id/combine`** (~45–60 min): the join endpoint
   described above, reusing `buildCandidate()`; wrap the
   `CombinedSession`-create-if-new + `TimetableEntry`-create in one
   `prisma.$transaction`.
4. **UI** (~1–2 hrs, separate sitting): a "Combine with another section"
   action on a placed class, section picker limited to sections without a
   conflict at that slot (this can literally reuse the existing
   `/rooms/:id/allocatable`-style pattern — "what could occupy this slot" —
   pointed at sections instead of entries). Cosmetic follow-on, not
   required for correctness: a small badge on `ClassCell` naming the other
   combined section(s), so nobody looking at Section B's grid is confused
   about why a class appears with no independent booking history.

Steps 1–3 are the actual "does this work" answer; step 4 is what makes it
usable. Say the word and I'll build 1–3 now.
