# Multi-mode scheduling (NORMAL / COMBINED_SECTION / SHARED_ROOM) — architecture review

You asked me not to just agree. I didn't. Two things below are genuine
problems — one in your proposal, one in my *own* prior recommendation
(`COMBINED-SECTIONS-DESIGN.md`) — found by actually tracing both new modes
against the real overlap loop and the real grid-rendering code, not by
re-describing the proposal back to you. This document supersedes the
data-ownership part of that earlier one; I say exactly where and why below.

## Verdict up front

Your core instinct — a parent grouping entity, created before validation,
that tells the conflict engine "this overlap is intentional" — is the right
shape. But as specified, it has one real correctness bug once SHARED_ROOM
exists, and your "declare intent before creation" workflow requirement (which
I think is the right call) actually invalidates part of my own earlier
design, not yours. And there's a rendering gap neither of us has named yet
that will bite on day one of shipping SHARED_ROOM specifically. Fix those
three things and this is a good, minimal, non-invasive design — not a
"looks fine, ship it" verdict, an actually-checked one.

## 1. The bug: a group-wide exemption is wrong once two faculty can share a room

Walk through what a naive rule does. Suppose the exemption is "same
non-null group id → skip both `ROOM_CLASH` and `FACULTY_CLASH` between the
pair," which is what a straightforward reading of your proposal — and my
own prior recommendation — implies. Now suppose a data-entry mistake (or a
legitimate future case you haven't described) puts **the same faculty**
into two different sub-classes of one SHARED_ROOM group — Faculty Ravi
teaching both DBMS to AIML-A *and*, by mistake, OS to AIML-C, in the same
room, same slot, same group. That is not shareable. One person cannot
deliver two different lectures at once, even standing in the same hall. A
group-wide exemption would silently let this through, because it only
checks "same group," not "is this actually the same class."

The fix is one word narrower than "same group": exempt `ROOM_CLASH`
whenever both entries share a group (that's the entire point of grouping —
the room is deliberately shared, full stop). Exempt `FACULTY_CLASH` only
when both entries share a group **and** the same `facultyId` **and** the
same `subjectId` — i.e., only when the two entries are actually
*the same class*, replicated once per participating section. That
condition is precisely what COMBINED_SECTION produces (same faculty, same
subject, every member row) and precisely what SHARED_ROOM never produces
between its distinct sub-classes (different faculty, different subject).
`SECTION_CLASH` gets no exemption at all, in either mode — a section
genuinely cannot be in two places, combined or shared or not.

The useful consequence: **the conflict engine never needs to read `mode`.**
One rule, expressed only in terms of fields the engine already has
(`facultyId`, `subjectId`, plus the new group id), correctly produces
COMBINED_SECTION's behavior, correctly produces SHARED_ROOM's behavior, and
correctly still catches the pathological case that a mode-blind "same
group, skip everything" rule would have missed. This is also why I'm
confident a single generic model is right (§4) rather than two — the
distinguishing logic isn't a mode switch, it's just "do the entries in
front of me happen to agree on faculty and subject."

## 2. Where I'm revising my own earlier design

`COMBINED-SECTIONS-DESIGN.md` recommended a *tag-only* group — no room,
day, period, or span on the parent row, those staying only on each member
`TimetableEntry`, kept consistent purely by API discipline ("the join
endpoint takes its slot from the target entry, never accepts a new one").
That was the right call **for the workflow I was assuming at the time**:
place one class normally, then let a second section "join" it after the
fact.

Your "declare intent before creation" requirement is a different workflow,
and it changes the right answer. If the admin picks Room + Mode (and
implicitly the slot) *first*, before any member class exists, there is no
"target entry" to derive the slot from — the slot is a property of the
session being declared, not of some first member that happens to exist
first. That means the parent **should** own the canonical room, day,
period and span this time. I was wrong to rule that out last time; I
wasn't wrong about the risk (drift between a parent's fields and its
members' copies) — that risk is exactly why, below, I still recommend each
member row keep its own denormalized copy, written once at creation and
never independently editable. Centralizing ownership on the parent doesn't
mean removing the copy from the child — it means the child's copy has an
authoritative source to be validated against, instead of an informal
"please keep these in sync" convention. That combination (parent owns the
canonical value; child keeps a synced copy for read-path compatibility) is
what makes this genuinely additive rather than a retrofit of the first
design.

## 3. Alternatives considered and rejected

Worth showing the rejects, not just the pick — you asked whether there's a
simpler or more scalable approach, and the honest way to answer that is to
name what I actually compared this against.

**A boolean `allowsSharedRoom` flag, no grouping table at all.** Simpler —
one column, no new table, no FK. Rejected: a flag can't express *who* a
given entry is allowed to share with, only *that* it's willing to share
with someone. If three unrelated entries in the same room at the same slot
all happened to carry the flag for three different, unrelated reasons, this
design can't tell an intentional pair from an accidental triple-booking
that only looks intentional because everyone opted in independently. A
group identifier is the minimum structure that can actually answer "is
*this specific* overlap the one that was declared," and that's not
optional complexity — it's the actual requirement.

**A `sectionIds: String[]` array column on `TimetableEntry` instead of one
row per section.** This is the one genuinely competitive alternative, and
worth taking seriously since it avoids a new table entirely. Rejected,
because it fails your own stated priorities harder than the multi-row
design does: every existing query in this codebase — the section grid,
`validateSection()`'s curriculum-hour accounting, both public endpoints,
every print page — filters with `WHERE sectionId = X`, a plain relational
equality Prisma handles natively. An array column turns every one of those
into "is X a member of this array," a fundamentally different query shape
that Prisma doesn't express as cleanly and that changes code which
currently works and doesn't need to. The multi-row design's biggest
property, and the reason I'm recommending it again here, is that it
requires **zero changes to any query that already works** — `sectionId`
stays a plain foreign key on every row, a combined class is just one of
several rows matching an existing filter, indistinguishable in shape from
an ordinary booking. That's the property that actually serves
maintainability, simplicity, and minimal tech debt simultaneously, not a
tie-breaker among otherwise-equal options.

**Relaxing room-clash detection generally, e.g. a config toggle.** Not
seriously considered — it would destroy the engine's value for the 95% of
bookings that are NORMAL and must never share a room. Mentioned only
because a "simpler approach" question deserves an answer for why the
obviously-too-simple option is wrong, not silence.

## 4. Generic `SessionGroup`, not two separate models

One model, both modes, for the reason established in §1: the conflict
engine's actual logic doesn't branch on mode, so there's no correctness
reason to have two backing tables. `mode` is still worth storing — not for
the engine, but for three things I want to be explicit about, since one of
them is a "hidden complexity" you specifically asked me to surface:

**Creation-time validation ergonomics.** A COMBINED_SECTION group should
reject a member whose subject or faculty doesn't match the group's first
member (that's the definition of the mode); a SHARED_ROOM group should
allow independent subject/faculty per member. This is a shallow, one-line
application check per mode, not a reason to fork the model.

**Future substitution logic.** ScheduleDesk already has a class-adjustment
feature (day → faculty → hour substitution). When that eventually needs to
handle a faculty absence hitting a grouped class, it has to know: for
COMBINED_SECTION, substituting means replacing the *whole group at once*
(it's one physical lecture; you wouldn't cover it for AIML-A and leave
AIML-B's copy stale). For SHARED_ROOM, substituting means replacing *only
the one affected sub-class* — Kumar's OS class in the shared hall is
unaffected by Ravi being out. That's a real behavioral fork a future
feature needs, and it needs `mode` to make the call correctly rather than
guessing from data shape.

**Future faculty-load reporting.** I flagged a faculty-weekly-load
enhancement as good future work in the first review doc. The moment either
of these modes ships, that future feature has a trap waiting in it: naively
summing `TimetableEntry` rows per faculty per week would over-count a
combined class once per participating section — three combined sections
would read as three periods taught instead of one. That feature, whenever
you build it, needs to count *distinct groups* (plus ungrouped singles),
not raw rows, per faculty per slot. Noting it now so it isn't a surprise
bug discovered after that feature ships.

## 5. The rendering gap — the actual "hidden complexity" here

This is the finding I'd flag hardest, because it's the one place where
"this needs no other changes" (which is true almost everywhere else) is
false, and it's false in a way that will visibly break a page if shipped
without it.

Every timetable grid in this app — section, faculty, room, and every print
page — is built by the same two pieces: `gridLayout.ts`'s `buildDayCells()`
and `TimetableTable`'s cell renderer. Both assume **at most one entry
occupies a given (day, period) cell.** That assumption is currently true
everywhere, because today at most one entry ever can occupy one cell — it's
the exact invariant the conflict engine enforces. The moment either new
mode exists, it's no longer true, and *where* it stops being true differs
by mode and by which grid you're looking at:

- **Section grids** — unaffected, both modes. A section only ever has one
  row for itself at a given slot, group or not. No change needed here,
  ever.
- **Faculty grid** — unaffected by SHARED_ROOM (different faculty, no
  collision), but breaks under COMBINED_SECTION: Faculty Ravi's own weekly
  query (`WHERE facultyId = Ravi`) returns *N* rows for that one slot, one
  per participating section, and the grid tries to put N entries in one
  cell.
  - **Room grid** — breaks under **both** modes. A room's own query
  (`WHERE roomId = LH-101`) returns multiple rows for that slot regardless
  of which mode produced them.

Print inherits this automatically and for free, in both directions: the
same `TimetableTable` component that six print pages already reuse means
you don't write six separate fixes, but it also means you can't ship
without touching it — `print-all-rooms` and `print-all-faculty` will
silently show only one of several classes (whichever `buildDayCells`
happens to pick) if this isn't addressed before either mode goes live.

**The fix:** generalize the cell shape from "one entry" to "a list of
entries" in `gridLayout.ts` and `TimetableTable`, once, and every grid and
print page that already imports `TimetableTable` inherits the fix for
free — this is the same "one shared component, no drift" property that
made `ClassCell` worth building in the first place. For the room grid,
where SHARED_ROOM's two sub-classes are genuinely different content, this
needs a real "render both" treatment. For the faculty grid under
COMBINED_SECTION specifically, the N rows are identical in everything but
`sectionId`, so a cheaper interim version is legitimate if you want to ship
COMBINED_SECTION's UI before doing the full generalization: dedupe by group
id before the rows ever reach `buildDayCells`, showing one cell annotated
with the section list. That interim shortcut does **not** work for
SHARED_ROOM's room view, where the two sub-classes are genuinely distinct
and both need to be visible — so SHARED_ROOM cannot ship without the real
fix, only COMBINED_SECTION can defer it.

## 6. Per-mode impact

**NORMAL** — Database: no change, `sessionGroupId` stays `NULL`. Prisma: no
change. Scheduling: no change. Conflict detection: no change — every
existing check runs exactly as today because the new guard only activates
when both sides are grouped. UI: no change. Print: no change. Maintenance:
zero ongoing cost; this mode is what "no `SessionGroup` row exists" means,
not a state anything has to actively preserve.

**COMBINED_SECTION** — Database: one new `SessionGroup` row + N
`TimetableEntry` rows sharing `sessionGroupId`, all with matching
`subjectId`/`facultyId`/`roomId`/`dayOfWeek`/`startPeriod`/`periodSpan`.
Prisma: additive only — new model, new nullable FK, no change to any
existing model's shape. Scheduling: `buildCandidate()` reused unmodified;
the create path becomes "N candidates, batch-validated against each other
plus the term," not a new algorithm. Conflict detection: the §1 rule —
`ROOM_CLASH` and `FACULTY_CLASH` both correctly suppressed between members
(they share faculty and subject by definition of the mode);
`SECTION_CLASH` and `WRONG_ROOM_TYPE` untouched. UI: needs the "declare
group, then pick N sections" creation flow (§7), plus the faculty/room-grid
dedupe from §5. Print: inherited for free from the `TimetableTable` fix,
same caveat. Maintenance: low — every section-level view, curriculum-hour
accounting, and public/print endpoint needs zero awareness this mode
exists; it only surfaces where §5 said it would.

**SHARED_ROOM** — Database: one `SessionGroup` row + N `TimetableEntry`
rows sharing only `sessionGroupId`/`roomId`/`dayOfWeek`/`startPeriod`/
`periodSpan` — `subjectId` and `facultyId` legitimately differ per member.
Prisma: identical shape to COMBINED_SECTION — same model, same FK, no
mode-specific columns needed. Scheduling: same batch-create path,
parameterized by mode only for the creation-form validation rule in §4.
Conflict detection: `ROOM_CLASH` suppressed between members;
`FACULTY_CLASH` *not* suppressed unless two members coincidentally share
both faculty and subject (correctly rare, and correctly still blocked when
it would mean one person teaching twice at once); `WRONG_ROOM_TYPE` stays
fully enforced — if the shared room is a `LAB`-type room, a `THEORY`
sub-class in it still fails exactly as it would today, deliberately not
exempted. UI: the "compose several independent classes into one room+slot"
form is a materially different form from COMBINED_SECTION's, not a
variant of it — budget it as separate UI work. Print: same
`TimetableTable` dependency as COMBINED_SECTION, but here the room grid
needs the *real* multi-entry-cell fix, not the dedupe shortcut (§5).
Maintenance: same low ongoing cost as COMBINED_SECTION, with one added
watch-item — the future substitution feature (§4) must treat this mode's
groups as independently-substitutable per member, not as one unit.

## 7. Recommended database model

```
SessionGroup
  id          String            @id @default(cuid())
  termId      String
  versionId   String            // scoped to LIVE/WORKING exactly like TimetableEntry —
                                 // a WORKING-copy group must never leak into a LIVE query
  mode        SessionGroupMode  // COMBINED_SECTION | SHARED_ROOM — NORMAL has no row
  roomId      String            // required — both modes are inherently room-centric
  dayOfWeek   DayOfWeek
  startPeriod Int
  periodSpan  Int
  createdAt   DateTime          @default(now())

  entries     TimetableEntry[]
```

```
TimetableEntry   (existing model, one new column)
  ...
  sessionGroupId  String?        // → SessionGroup, onDelete: SetNull
```

`onDelete: SetNull`, not `Cascade` — dissolving a group is an organizational
un-grouping, not a delete of the underlying classes. Each entry keeps its
own `roomId`/`dayOfWeek`/`startPeriod`/`periodSpan`, written once at
creation from the parent's values and never independently editable while
grouped (enforced at the API layer, §9) — this is what keeps every existing
query (`WHERE roomId = X`, `WHERE facultyId = X`, `WHERE sectionId = X`)
completely unaware anything changed.

## 8. Recommended conflict-detection model

Add `sessionGroupId?: string | null` to both `PlacedEntry` and `Candidate`
in `scheduling.ts`. In the existing overlap loop:

- `ROOM_CLASH`: skip when `candidate.sessionGroupId` is non-null and equals
  `entry.sessionGroupId`.
- `FACULTY_CLASH`: skip when the above **and** `candidate.subjectId ===
  entry.subjectId`. (`facultyId` already has to match for this branch to
  run at all, per the existing code — this just adds the subject check on
  top of it.)
- `SECTION_CLASH`, `WRONG_ROOM_TYPE`, `SUBJECT_NOT_IN_CURRICULUM`,
  `FACULTY_NOT_ASSIGNED`: untouched, no exemption, in either mode.

Nothing else in `scheduling.ts` changes. `computeAvailability()` needs no
separate update — it's built entirely on `validatePlacement()`, so the
guard applies there automatically once a candidate carries the right
`sessionGroupId`.

## 9. Recommended UI workflow

Matches your "declare intent before creation" instinct, made concrete:

1. A new flow, separate from the existing single-class placement screen —
   "Create shared session." Admin picks Room, Day, Period(s)/span, and
   Mode. Nothing is persisted yet.
2. **COMBINED_SECTION path:** pick one Subject, multi-select the
   participating Sections. Faculty is *not* picked here either — same
   invariant as NORMAL placement, derived per section from that section's
   own `SectionAssignment` for the chosen subject (which must already
   exist for every selected section, exactly as it must today for any
   subject). Submit creates the `SessionGroup` and all N member entries in
   one transaction, each validated against the term's existing entries
   plus its as-yet-uncommitted siblings in the same batch.
3. **SHARED_ROOM path:** compose two or more independent rows, each a
   normal (Section, Subject) pick with faculty auto-derived the same way.
   Same one-transaction batch creation.
4. **Editing:** moving a group (room/day/period/span) is a single
   "move whole group" action that updates the parent and every member's
   denormalized copy together, then re-validates all members at the new
   slot. A direct `PATCH` to one grouped entry's room/day/period is
   rejected (400) — it has to go through the group. Adding a member later
   reuses step 2/3's validation, parameterized by the existing group
   instead of minting a new one. Removing a member is the existing
   `DELETE /entries/:id`, unchanged; if that was the last member, the
   group can auto-dissolve as a cleanup nicety, not a requirement.

## 10. Recommended implementation order

1. **Schema** (~20–30 min): `SessionGroup` model, `TimetableEntry.
   sessionGroupId`. Purely additive migration.
2. **Conflict engine** (~30–45 min): the §8 fields and guard. This is the
   correctness-critical step — write the regression test for the §1 bug
   explicitly (same group, same faculty, *different* subject → `FACULTY_
   CLASH` must still fire), not just the two happy-path cases.
3. **Batch-create endpoint** (~1 hr): `POST /session-groups`, reusing
   `buildCandidate()` per member, transactional, validating each candidate
   against the term plus its uncommitted siblings.
4. **Room/faculty grid fix** (~1–2 hrs): the §5 generalization. Do the real
   fix, not the dedupe shortcut, if you're building both modes close
   together — the shortcut only pays for itself if COMBINED_SECTION ships
   meaningfully before SHARED_ROOM does.
5. **Creation UI — COMBINED_SECTION** (~1–2 hrs): the simpler of the two
   forms.
6. **Creation UI — SHARED_ROOM** (~1–2 hrs): can genuinely wait for a
   separate sitting; nothing above depends on it existing.
7. Later, optional: group-aware class adjustment, group-aware faculty-load
   reporting, the "combined with X" cosmetic badge on `ClassCell`.

## 11. Final recommendation

Build the schema and conflict engine (steps 1–2, and step 4's real fix) for
**both** modes now, not just COMBINED_SECTION. This isn't "build
everything because more is better" — it's that steps 1, 2, and 4 cost
almost exactly the same whether you're building for one mode or two,
because neither the table shape nor the conflict rule nor the rendering fix
branches on mode (that was the whole finding in §1 and §5). The only real
per-mode cost is the creation UI, which is genuinely separable and fine to
phase — ship COMBINED_SECTION's form first, since it's the simpler of the
two, and let SHARED_ROOM's form follow whenever you next have a sitting for
it. What I'd actively avoid is building COMBINED_SECTION's engine logic
first as if it were mode-specific, then discovering the §1 exemption bug
only once SHARED_ROOM forces the issue — that's exactly the retrofit-debt
scenario your own priorities list is trying to rule out, and it's avoidable
for zero extra cost by writing the subject-aware guard from the start.

So: NORMAL + COMBINED_SECTION + SHARED_ROOM, one generic `SessionGroup`
model, built together at the foundation layer, shipped incrementally at the
UI layer. Not a different design from what you proposed — a corrected and
completed version of it.
