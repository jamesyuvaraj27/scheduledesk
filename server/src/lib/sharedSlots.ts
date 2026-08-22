/**
 * Deliberately-shared timetable slots.
 *
 * Two arrangements the college genuinely wants, which plain clash detection
 * would otherwise refuse:
 *
 *   Combined section — one teacher takes one subject to two sections at once,
 *     in one room. CSM-A and CSM-B both get DBMS / Ravi / AFF-1 at Mon P1.
 *
 *   Shared room — two independent classes run in one room at one time.
 *     CSM-A gets DBMS / Ravi and CSM-B gets OS / Priya, both in AFF-1.
 *
 * Both stay ordinary `TimetableEntry` rows, one per section, exactly as
 * before. Nothing is duplicated in master data: one Ravi, one AFF-1, one
 * CSM-A, one CSM-B. The only addition is a tag saying "these rows share
 * this hour on purpose", which is what the conflict engine looks at.
 *
 * The distinction between the two cases is never stored, because it is
 * already implied by the rows themselves — same faculty and same subject
 * reads as a combined class, anything else reads as a shared room — and a
 * stored mode could contradict the data it describes.
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
