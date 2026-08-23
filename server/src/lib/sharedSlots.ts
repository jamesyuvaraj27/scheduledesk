/**
 * Deliberately-shared timetable slots.
 *
 * Two mechanisms, one underlying tag:
 *
 *   Combine at placement (`joinSharedSlot` below, wired through
 *     `shareWithEntryId` in `timetable.ts`/`rooms.ts`) — offered the moment
 *     a placement would otherwise clash; places the second entry directly
 *     into the shared room from the start. Subject/faculty-agnostic: this is
 *     the ONLY way to get a same-faculty pair sharing a room, since a
 *     same-faculty pair can no longer be placed independently first (see
 *     `facultyShareAllowed` in `scheduling.ts`).
 *
 *   Merge Classes (`validateMergePair`/`mergeExistingEntries`/
 *     `unmergeGroup` below, routed through `server/src/routes/merge.ts`) —
 *     an explicit, later, administrative room-sharing operation: the office
 *     builds both sections' timetables as ordinary independent entries
 *     first, then comes back and picks two already-placed classes to put in
 *     one room together. Any subject/faculty combination is allowed here —
 *     the two entries keep their own individual subject and faculty
 *     unchanged; only the room is shared.
 *
 * Both stay ordinary `TimetableEntry` rows, one per section, exactly as
 * before. Nothing is duplicated in master data: one faculty row, one room
 * row, one row per section. The only addition is a tag saying "these rows
 * share this hour on purpose", which is what the conflict engine looks at.
 * `preMergeRoomId` (set only by Merge Classes, never by combine-at-placement)
 * is what tells the two mechanisms apart afterwards, when that matters (see
 * `GET /merge/active` in `merge.ts`).
 */

import { randomUUID } from "node:crypto"
import { prisma } from "./prisma.js"
import { AppError, notFound } from "./errors.js"

/** What the joining entry looks like, for the compatibility checks below. */
export interface SharingPlacement {
  /** Omitted when the joining entry is still being created. */
  entryId?: string
  versionId: string
  dayOfWeek: string
  startPeriod: number
  periodSpan: number
  /** The room the joining entry will end up in. */
  roomId: string | null
}

/**
 * Attach to the slot `targetEntryId` occupies, and return the tag to store.
 *
 * The target is tagged too if it wasn't already — the first share is what
 * turns an ordinary entry into a shared one, and both sides must carry the
 * same value or the engine sees no share at all.
 *
 * Callers pass the tag into `validatePlacement` and then persist it. This
 * function deliberately does NOT decide whether the placement is legal: it
 * only establishes the relationship. Whether the result is allowed is still
 * the conflict engine's call, which is what keeps a faculty double-booking
 * from being waved through just because someone clicked "share".
 */
export async function joinSharedSlot(
  targetEntryId: string,
  placement: SharingPlacement
): Promise<string> {
  const target = await prisma.timetableEntry.findUnique({
    where: { id: targetEntryId },
  })
  if (!target) throw notFound("The class to share with")

  if (placement.entryId && target.id === placement.entryId) {
    throw new AppError("A class can't share a slot with itself.", 422)
  }

  // Same timetable — sharing across the live copy and the working copy would
  // be meaningless, and would leak an edit-in-progress into the live sheet.
  if (target.versionId !== placement.versionId) {
    throw new AppError(
      "That class belongs to a different version of the timetable.",
      422
    )
  }

  // The whole claim being made is "these occupy the same hour", so they have
  // to actually occupy the same hour. A partial overlap (a 1-period class
  // against the middle of a 3-period lab) is not a share; it is a clash
  // wearing a share's clothes, and it would leave the grid unrenderable.
  if (
    target.dayOfWeek !== placement.dayOfWeek ||
    target.startPeriod !== placement.startPeriod ||
    target.periodSpan !== placement.periodSpan
  ) {
    throw new AppError(
      "Both classes have to cover exactly the same day and periods to share a slot.",
      422
    )
  }

  // A shared slot is a shared ROOM. Two classes in different rooms have
  // nothing to share and need no exemption.
  if (!placement.roomId || target.roomId !== placement.roomId) {
    throw new AppError(
      "Both classes have to be in the same room to share a slot.",
      422
    )
  }

  if (target.sharedSlotId) return target.sharedSlotId

  const tag = randomUUID()
  await prisma.timetableEntry.update({
    where: { id: target.id },
    data: { sharedSlotId: tag },
  })
  return tag
}

/**
 * Drop a slot tag that no longer means anything.
 *
 * A "share" needs at least two participants. Once removing or moving an
 * entry leaves a single tagged row behind, that row is just an ordinary
 * class again, and leaving the tag on it would quietly exempt whatever got
 * placed there next from the room and faculty checks.
 */
export async function pruneSharedSlot(sharedSlotId: string | null): Promise<void> {
  if (!sharedSlotId) return

  const remaining = await prisma.timetableEntry.findMany({
    where: { sharedSlotId },
    select: { id: true },
  })

  if (remaining.length <= 1) {
    await prisma.timetableEntry.updateMany({
      where: { sharedSlotId },
      data: { sharedSlotId: null },
    })
  }
}

/* -------------------------------------------------------------------------- */
/*                        Merge Classes (post-assignment)                     */
/* -------------------------------------------------------------------------- */

/**
 * Two already-placed entries loaded and confirmed mergeable — two different
 * sections' classes at the same day/period, ready to share a room. Subject
 * and faculty are NOT required to match — Merge Classes is a room-sharing
 * operation, not a "these are really one class" declaration; each entry
 * keeps its own subject and faculty exactly as placed.
 */
export interface MergeablePair {
  a: NonNullable<Awaited<ReturnType<typeof prisma.timetableEntry.findUnique>>>
  b: NonNullable<Awaited<ReturnType<typeof prisma.timetableEntry.findUnique>>>
}

/**
 * Load and validate two EXISTING entries as a Merge Classes candidate.
 *
 * Structural checks only — existence, version, exact day/period/span match,
 * same `entryType` (a THEORY and a LAB entry could never share one valid
 * destination room anyway — `validatePlacement`'s WRONG_ROOM_TYPE rule
 * requires a LAB room for LAB and a non-LAB room for THEORY, which are
 * mutually exclusive — so rejecting the mismatch here is just a clearer,
 * earlier error than letting it fail downstream), different section, neither
 * already merged. Deliberately does NOT require matching subject or faculty
 * — see `MergeablePair` above. This is also deliberately narrower than
 * `validatePlacement`: it does not check the destination room or
 * third-party ROOM_CLASH, because that needs the whole-term
 * `SchedulingContext` the route layer already knows how to build (see
 * `server/src/routes/merge.ts`) — this only confirms the PAIR itself is a
 * legitimate merge target, mirroring the pairwise checks `joinSharedSlot`
 * already does for the "combine at placement" flow.
 */
export async function validateMergePair(
  entryIdA: string,
  entryIdB: string
): Promise<MergeablePair> {
  if (entryIdA === entryIdB) {
    throw new AppError("Choose two different classes to merge.", 422)
  }

  const [a, b] = await Promise.all([
    prisma.timetableEntry.findUnique({ where: { id: entryIdA } }),
    prisma.timetableEntry.findUnique({ where: { id: entryIdB } }),
  ])
  if (!a) throw notFound("The first class")
  if (!b) throw notFound("The second class")

  if (a.versionId !== b.versionId) {
    throw new AppError(
      "Both classes have to belong to the same version of the timetable.",
      422
    )
  }
  if (
    a.dayOfWeek !== b.dayOfWeek ||
    a.startPeriod !== b.startPeriod ||
    a.periodSpan !== b.periodSpan
  ) {
    throw new AppError(
      "Both classes have to cover exactly the same day and periods to merge.",
      422
    )
  }
  if (a.entryType !== b.entryType) {
    throw new AppError("Both classes have to be the same kind (theory or lab).", 422)
  }
  if (a.sectionId === b.sectionId) {
    throw new AppError(
      "Merging needs two different sections — this is the same section twice.",
      422
    )
  }
  if (a.sharedSlotId) {
    throw new AppError(
      "The first class is already merged with something else. Unmerge it first.",
      422
    )
  }
  if (b.sharedSlotId) {
    throw new AppError(
      "The second class is already merged with something else. Unmerge it first.",
      422
    )
  }

  return { a, b }
}

/**
 * Merge two existing, independent entries into one combined occurrence: both
 * move into `roomId` and both carry a fresh shared-slot tag.
 *
 * Each entry's PREVIOUS room is remembered on `preMergeRoomId` before it's
 * overwritten, so Unmerge can put it back. Does not itself check ROOM_CLASH
 * against a third section already sitting in the destination room — the
 * caller (see `merge.ts`) re-validates with the full conflict engine after
 * this and rolls back on failure, the same optimistic-tag-then-validate
 * pattern `joinSharedSlot` callers already use elsewhere.
 */
export async function mergeExistingEntries(
  entryIdA: string,
  entryIdB: string,
  roomId: string
): Promise<{ sharedSlotId: string; a: MergeablePair["a"]; b: MergeablePair["b"] }> {
  const { a, b } = await validateMergePair(entryIdA, entryIdB)
  const tag = randomUUID()

  await prisma.$transaction([
    prisma.timetableEntry.update({
      where: { id: a.id },
      data: { preMergeRoomId: a.roomId, roomId, sharedSlotId: tag },
    }),
    prisma.timetableEntry.update({
      where: { id: b.id },
      data: { preMergeRoomId: b.roomId, roomId, sharedSlotId: tag },
    }),
  ])

  return { sharedSlotId: tag, a, b }
}

/**
 * Undo a merge: every entry carrying `sharedSlotId` returns to the room it
 * held before Merge Classes moved it (falling back to staying put if, for
 * some reason, no prior room was recorded), and the tag clears.
 *
 * Does not itself re-validate the restored rooms — a room allocated to a
 * different class after the merge could make a restore illegal again, so the
 * caller (see `merge.ts`) checks the restored state with the full conflict
 * engine before committing, exactly as `mergeExistingEntries` does for the
 * forward direction.
 */
export async function unmergeGroup(
  sharedSlotId: string
): Promise<MergeablePair["a"][]> {
  const entries = await prisma.timetableEntry.findMany({ where: { sharedSlotId } })
  if (entries.length === 0) return []

  await prisma.$transaction(
    entries.map((e) =>
      prisma.timetableEntry.update({
        where: { id: e.id },
        data: { roomId: e.preMergeRoomId ?? e.roomId, preMergeRoomId: null, sharedSlotId: null },
      })
    )
  )

  return entries
}
