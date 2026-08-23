/**
 * Merge Classes — combining sections as a POST-ASSIGNMENT operation.
 *
 * Combined sections and shared rooms are one mechanism (`TimetableEntry.
 * sharedSlotId`, see `sharedSlots.ts`) reached two different ways:
 *
 *   - "combine at placement" (`timetable.ts`'s `shareWithEntryId`,
 *     `rooms.ts`'s `PATCH /entries/:id/room` with `shareWithEntryId`) — offered
 *     the moment a placement would otherwise clash. Untouched by this file.
 *
 *   - Merge Classes (this file) — the office builds both sections' timetables
 *     as ordinary, independent entries first (`scheduling.ts`'s
 *     `sameSubjectTwin` is what allows that without a clash), then comes back
 *     later, picks the two existing entries, and explicitly says "put these
 *     in one room together."
 *
 * Both end up as the exact same shape in the database — two TimetableEntry
 * rows sharing a tag, in the same room. Nothing here introduces a new
 * timetable architecture or duplicates Faculty/Room/Section master data.
 */

import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { AppError, asyncHandler, notFound, param } from "../lib/errors.js"
import {
  assertEditable,
  resolveVersion,
  versionSpecFromRequest,
} from "../lib/versions.js"
import { validatePlacement, type Candidate, type Day, type EntryType } from "../lib/scheduling.js"
import { mergeExistingEntries, unmergeGroup } from "../lib/sharedSlots.js"
import { loadTermContext, contextForSection } from "./rooms.js"

export const mergeRouter = Router()

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const
const ROMAN = ["", "I", "II", "III", "IV"]

const sectionLabel = (s: { year: number; name: string; branch: { code: string } }) =>
  `${ROMAN[s.year] ?? s.year} ${s.branch.code}-${s.name}`

/* ------------------ What could be merged at this day/period? -------------- */

/**
 * Every THEORY/LAB class whose OWN start period is this day+period, across
 * every section/year — the pool the "Class 1" / "Class 2" pickers choose
 * from. Activities (no subject, no faculty) never qualify — there is nothing
 * for the merge rule (same subject, same faculty) to compare.
 */
mergeRouter.get(
  "/merge/options",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        dayOfWeek: z.enum(DAYS),
        startPeriod: z.coerce.number().int().min(1),
      })
      .parse(req.query)

    const loaded = await loadTermContext(versionSpecFromRequest(req))

    const candidates = loaded.entries.filter(
      (e) =>
        e.dayOfWeek === query.dayOfWeek &&
        e.startPeriod === query.startPeriod &&
        (e.entryType === "THEORY" || e.entryType === "LAB") &&
        e.subjectId &&
        e.facultyId
    )

    // Already-merged partners, so an alreadyMerged option can say who it's
    // merged with — looked up within this same slot, since a merge partner
    // is always at the same day/period by definition.
    const labelById = new Map(candidates.map((e) => [e.id, sectionLabel(e.section)]))

    const options = candidates.map((e) => {
      const alreadyMerged = Boolean(e.sharedSlotId)
      const mergedWith = alreadyMerged
        ? candidates.find((o) => o.id !== e.id && o.sharedSlotId === e.sharedSlotId)
        : undefined

      const compatibleWith = alreadyMerged
        ? []
        : candidates
            .filter(
              (o) =>
                o.id !== e.id &&
                !o.sharedSlotId &&
                o.sectionId !== e.sectionId &&
                o.subjectId === e.subjectId &&
                o.facultyId === e.facultyId &&
                o.periodSpan === e.periodSpan &&
                o.entryType === e.entryType
            )
            .map((o) => o.id)

      return {
        entryId: e.id,
        section: {
          id: e.sectionId,
          name: e.section.name,
          year: e.section.year,
          branchCode: e.section.branch.code,
        },
        subject: e.subject
          ? { id: e.subject.id, code: e.subject.code, name: e.subject.name }
          : null,
        faculty: e.faculty
          ? { id: e.faculty.id, name: e.faculty.name, facultyNo: e.faculty.facultyNo }
          : null,
        room: e.room ? { id: e.room.id, name: e.room.name } : null,
        entryType: e.entryType,
        periodSpan: e.periodSpan,
        alreadyMerged,
        mergedWithLabel: mergedWith ? labelById.get(mergedWith.id) ?? null : null,
        compatibleWith,
      }
    })

    res.json({
      dayOfWeek: query.dayOfWeek,
      startPeriod: query.startPeriod,
      options,
    })
  })
)

/* --------------------------------- Merge ---------------------------------- */

const mergeSchema = z.object({
  entryIdA: z.string(),
  entryIdB: z.string(),
  roomId: z.string(),
})

mergeRouter.post(
  "/merge",
  asyncHandler(async (req, res) => {
    const body = mergeSchema.parse(req.body)

    const existingA = await prisma.timetableEntry.findUnique({
      where: { id: body.entryIdA },
    })
    if (!existingA) throw notFound("The first class")

    const term = await prisma.academicTerm.findFirstOrThrow({
      where: { id: existingA.termId },
    })
    const version = await resolveVersion(term.id, existingA.versionId)
    await assertEditable(version)

    const room = await prisma.room.findUnique({ where: { id: body.roomId } })
    if (!room) throw notFound("Room")

    // Structural checks (existence, version, day/period/span/type, subject,
    // faculty, different section, neither already merged) plus the room
    // move itself. Does NOT yet check the destination room's type or any
    // third section already sitting in it — that's what the full
    // `validatePlacement` pass below is for.
    const { sharedSlotId, a, b } = await mergeExistingEntries(
      body.entryIdA,
      body.entryIdB,
      body.roomId
    )

    const loaded = await loadTermContext(version.id)
    const candidateFor = (e: typeof a): Candidate => ({
      id: e.id,
      sectionId: e.sectionId,
      dayOfWeek: e.dayOfWeek as Day,
      startPeriod: e.startPeriod,
      periodSpan: e.periodSpan,
      entryType: e.entryType as EntryType,
      subjectId: e.subjectId,
      facultyId: e.facultyId,
      roomId: body.roomId,
      sharedSlotId,
    })

    const conflicts = [
      ...validatePlacement(candidateFor(a), contextForSection(a.sectionId, loaded)),
      ...validatePlacement(candidateFor(b), contextForSection(b.sectionId, loaded)),
    ]

    if (conflicts.length) {
      // Put both entries back exactly as they were — a refused merge must
      // not leave its tag or its room change behind.
      await unmergeGroup(sharedSlotId)
      throw new AppError("That merge isn't allowed.", 409, conflicts)
    }

    const [updatedA, updatedB] = await prisma.$transaction([
      prisma.timetableEntry.findUniqueOrThrow({
        where: { id: a.id },
        include: { subject: true, faculty: true, room: true, section: { include: { branch: true } } },
      }),
      prisma.timetableEntry.findUniqueOrThrow({
        where: { id: b.id },
        include: { subject: true, faculty: true, room: true, section: { include: { branch: true } } },
      }),
    ])

    res.status(201).json({ sharedSlotId, a: updatedA, b: updatedB })
  })
)

/* -------------------------------- Unmerge ---------------------------------- */

mergeRouter.post(
  "/entries/:id/unmerge",
  asyncHandler(async (req, res) => {
    const entryId = param(req, "id")
    const existing = await prisma.timetableEntry.findUnique({ where: { id: entryId } })
    if (!existing) throw notFound("Class")
    if (!existing.sharedSlotId) {
      throw new AppError("This class isn't merged with anything.", 422)
    }

    const term = await prisma.academicTerm.findFirstOrThrow({
      where: { id: existing.termId },
    })
    const version = await resolveVersion(term.id, existing.versionId)
    await assertEditable(version)

    const sharedSlotId = existing.sharedSlotId
    // Snapshot BEFORE unmerging — `roomId`/`preMergeRoomId`/`sharedSlotId`
    // as they stood pre-unmerge, so a refused unmerge can be put back
    // exactly, the same optimistic-then-rollback pattern used everywhere
    // else this tag is written.
    const before = await prisma.timetableEntry.findMany({ where: { sharedSlotId } })

    const restored = await unmergeGroup(sharedSlotId)

    const loaded = await loadTermContext(version.id)
    const conflicts = restored.flatMap((e) => {
      const newRoomId = e.preMergeRoomId ?? e.roomId
      const candidate: Candidate = {
        id: e.id,
        sectionId: e.sectionId,
        dayOfWeek: e.dayOfWeek as Day,
        startPeriod: e.startPeriod,
        periodSpan: e.periodSpan,
        entryType: e.entryType as EntryType,
        subjectId: e.subjectId,
        facultyId: e.facultyId,
        roomId: newRoomId,
        sharedSlotId: null,
      }
      return validatePlacement(candidate, contextForSection(e.sectionId, loaded))
    })

    if (conflicts.length) {
      await prisma.$transaction(
        before.map((e) =>
          prisma.timetableEntry.update({
            where: { id: e.id },
            data: {
              roomId: e.roomId,
              preMergeRoomId: e.preMergeRoomId,
              sharedSlotId: e.sharedSlotId,
            },
          })
        )
      )
      throw new AppError(
        "Unmerging would leave a room clash behind — resolve that room allocation first.",
        409,
        conflicts
      )
    }

    const fresh = await prisma.timetableEntry.findMany({
      where: { id: { in: restored.map((e) => e.id) } },
      include: { subject: true, faculty: true, room: true, section: { include: { branch: true } } },
    })
    res.json({ entries: fresh })
  })
)

/* ---------------------------- Currently merged ----------------------------- */

/**
 * Every currently-merged pair, grouped by tag — the "currently merged" list
 * for the Merge Classes page's Unmerge affordance. Restricted to groups that
 * are genuinely combined sections (same subject + same faculty on every
 * member) rather than shared rooms — the derivation the schema comment
 * describes — since Merge Classes only ever creates the former.
 */
mergeRouter.get(
  "/merge/active",
  asyncHandler(async (req, res) => {
    const loaded = await loadTermContext(versionSpecFromRequest(req))
    const tagged = loaded.entries.filter((e) => e.sharedSlotId)

    const groups = new Map<string, typeof tagged>()
    for (const e of tagged) {
      const key = e.sharedSlotId!
      const list = groups.get(key) ?? []
      list.push(e)
      groups.set(key, list)
    }

    const active = [...groups.entries()]
      .filter(([, members]) => {
        const [first, ...rest] = members
        return (
          members.length >= 2 &&
          first.subjectId &&
          first.facultyId &&
          rest.every((m) => m.subjectId === first.subjectId && m.facultyId === first.facultyId)
        )
      })
      .map(([sharedSlotId, members]) => {
        const first = members[0]
        return {
          sharedSlotId,
          dayOfWeek: first.dayOfWeek,
          startPeriod: first.startPeriod,
          periodSpan: first.periodSpan,
          entryType: first.entryType,
          subject: first.subject
            ? { id: first.subject.id, code: first.subject.code, name: first.subject.name }
            : null,
          faculty: first.faculty
            ? { id: first.faculty.id, name: first.faculty.name, facultyNo: first.faculty.facultyNo }
            : null,
          room: first.room ? { id: first.room.id, name: first.room.name } : null,
          sections: members.map((m) => ({
            id: m.sectionId,
            name: m.section.name,
            year: m.section.year,
            branchCode: m.section.branch.code,
            // The entry id — not the section id — is what Unmerge needs
            // (`POST /entries/:id/unmerge` takes any one member's entry).
            entryId: m.id,
          })),
        }
      })

    res.json({ active })
  })
)
