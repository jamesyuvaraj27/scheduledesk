/**
 * Room-centric views of the timetable.
 *
 * Nothing new is stored here. A class's room is already `TimetableEntry.roomId`,
 * set when the class was placed, so "allocating a room" is just pointing an
 * existing entry at a different room. That means:
 *
 *   - the room timetable is a query over entries WHERE roomId = X
 *   - the section's room-allocation row is the roomId of its own entries
 *
 * ...and the two can never disagree, because they read the same column.
 * Removing an allocation clears `roomId` and leaves the class itself alone.
 */

import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { AppError, asyncHandler, notFound, param } from "../lib/errors.js"
import { buildDayGrid, dayEndTime } from "../lib/periods.js"
import {
  assertEditable,
  resolveVersion,
  versionSpecFromRequest,
  type VersionSpec,
} from "../lib/versions.js"
import {
  validatePlacement,
  type Day,
  type EntryType,
  type PlacedEntry,
  type RoomType,
  type SchedulingContext,
} from "../lib/scheduling.js"

export const roomsRouter = Router()

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const

const ROMAN = ["", "I", "II", "III", "IV"]

/**
 * The label the user asked for: YEAR_SECTION_SUBJECT, e.g. `IV_CSM_A_CN`.
 * Built from real data — branch code, section name and subject code — never
 * hardcoded.
 */
function classLabel(e: {
  section: { year: number; name: string; branch: { code: string } }
  subject: { code: string } | null
  entryType: string
}): string {
  const year = ROMAN[e.section.year] ?? String(e.section.year)
  const what = e.subject?.code ?? e.entryType
  return `${year}_${e.section.branch.code}_${e.section.name}_${what}`.replace(
    /\s+/g,
    "_"
  )
}

/** The whole active term's scheduling context, for clash checks. */
async function loadTermContext(versionSpec?: VersionSpec) {
  const term = await prisma.academicTerm.findFirst({
    where: { isActive: true },
    include: { timeConfig: true },
  })
  if (!term || !term.timeConfig) {
    throw new AppError(
      "No active academic term with daily timings. Set one up in Term Setup first.",
      409
    )
  }

  const version = await resolveVersion(term.id, versionSpec)

  const [entries, rooms, sectionSubjects, assignments] = await Promise.all([
    prisma.timetableEntry.findMany({
      where: { versionId: version.id },
      include: {
        subject: true,
        faculty: true,
        room: true,
        section: { include: { branch: true } },
      },
      orderBy: [{ dayOfWeek: "asc" }, { startPeriod: "asc" }],
    }),
    prisma.room.findMany(),
    prisma.sectionSubject.findMany({
      where: { termId: term.id },
      include: { subject: true },
    }),
    prisma.sectionAssignment.findMany({ where: { termId: term.id } }),
  ])

  return { term, version, entries, rooms, sectionSubjects, assignments }
}

/**
 * Build a `validatePlacement` context for one section.
 *
 * `entries` covers the whole term — that's what makes faculty and room clashes
 * across other years visible — but curriculum and assignments are per-section,
 * so they're indexed and looked up for whichever section is being checked.
 * Getting this wrong makes the engine report SUBJECT_NOT_IN_CURRICULUM for a
 * class that is plainly already on the timetable.
 */
function contextForSection(
  sectionId: string,
  loaded: Awaited<ReturnType<typeof loadTermContext>>
): SchedulingContext {
  const { term, entries, rooms, sectionSubjects, assignments } = loaded

  return {
    timeConfig: term.timeConfig!,
    entries: entries.map(
      (e): PlacedEntry => ({
        id: e.id,
        sectionId: e.sectionId,
        dayOfWeek: e.dayOfWeek as Day,
        startPeriod: e.startPeriod,
        periodSpan: e.periodSpan,
        entryType: e.entryType as EntryType,
        subjectId: e.subjectId,
        facultyId: e.facultyId,
        roomId: e.roomId,
      })
    ),
    curriculum: sectionSubjects
      .filter((ss) => ss.sectionId === sectionId)
      .map((ss) => ({
        subjectId: ss.subjectId,
        subjectCode: ss.subject.code,
        weeklyTheoryHrs: ss.weeklyTheoryHrs,
        weeklyLabHrs: ss.weeklyLabHrs,
      })),
    assignments: new Map(
      assignments
        .filter((a) => a.sectionId === sectionId)
        .map((a) => [a.subjectId, a.facultyId])
    ),
    rooms: new Map(
      rooms.map((r) => [r.id, { id: r.id, name: r.name, type: r.type as RoomType }])
    ),
    names: {
      sections: new Map(
        entries.map((e) => [
          e.sectionId,
          `${ROMAN[e.section.year] ?? e.section.year} ${e.section.branch.code}-${e.section.name}`,
        ])
      ),
      faculty: new Map(
        entries.filter((e) => e.faculty).map((e) => [e.facultyId!, e.faculty!.name])
      ),
    },
  }
}

/* ------------------------------ Room timetable ---------------------------- */

roomsRouter.get(
  "/rooms/:id/timetable",
  asyncHandler(async (req, res) => {
    const roomId = param(req, "id")
    const room = await prisma.room.findUnique({ where: { id: roomId } })
    if (!room) throw notFound("Room")

    const { term, version, entries } = await loadTermContext(
      versionSpecFromRequest(req)
    )
    const cfg = term.timeConfig!
    const mine = entries.filter((e) => e.roomId === roomId)

    res.json({
      term: { id: term.id, label: term.label },
      version: { id: version.id, kind: version.kind, label: version.label },
      room,
      grid: {
        slots: buildDayGrid(cfg),
        endTime: dayEndTime(cfg),
        workingDays: cfg.workingDays,
        numPeriods: cfg.numPeriods,
      },
      entries: mine.map((e) => ({
        id: e.id,
        dayOfWeek: e.dayOfWeek,
        startPeriod: e.startPeriod,
        periodSpan: e.periodSpan,
        entryType: e.entryType,
        label: classLabel(e),
        section: {
          id: e.sectionId,
          name: e.section.name,
          year: e.section.year,
          branchCode: e.section.branch.code,
        },
        subject: e.subject ? { id: e.subject.id, code: e.subject.code, name: e.subject.name } : null,
        faculty: e.faculty
          ? { id: e.faculty.id, name: e.faculty.name, facultyNo: e.faculty.facultyNo }
          : null,
      })),
    })
  })
)

/* -------------------- What can be put in this room-period? ---------------- */

/**
 * Classes that could take this room on this day/period.
 *
 * Only real scheduled classes are offered — a section with a free period, or a
 * break/lunch column, has no entry, so there is nothing to offer. Classes that
 * already sit in another room appear too (choosing one moves it), but anything
 * that would clash is left out with the reason recorded.
 */
roomsRouter.get(
  "/rooms/:id/allocatable",
  asyncHandler(async (req, res) => {
    const roomId = param(req, "id")
    const query = z
      .object({
        dayOfWeek: z.enum(DAYS),
        startPeriod: z.coerce.number().int().min(1),
      })
      .parse(req.query)

    const room = await prisma.room.findUnique({ where: { id: roomId } })
    if (!room) throw notFound("Room")

    const loaded = await loadTermContext(versionSpecFromRequest(req))
    const { entries } = loaded

    // Every class occupying this day/period — that's the candidate set.
    const covering = entries.filter(
      (e) =>
        e.dayOfWeek === query.dayOfWeek &&
        query.startPeriod >= e.startPeriod &&
        query.startPeriod < e.startPeriod + e.periodSpan
    )

    const options = covering.map((e) => {
      const conflicts = validatePlacement(
        {
          id: e.id,
          sectionId: e.sectionId,
          dayOfWeek: e.dayOfWeek as Day,
          startPeriod: e.startPeriod,
          periodSpan: e.periodSpan,
          entryType: e.entryType as EntryType,
          subjectId: e.subjectId,
          facultyId: e.facultyId,
          roomId,
        },
        contextForSection(e.sectionId, loaded)
      )
      return {
        entryId: e.id,
        label: classLabel(e),
        entryType: e.entryType,
        periodSpan: e.periodSpan,
        startPeriod: e.startPeriod,
        currentRoom: e.room ? { id: e.room.id, name: e.room.name } : null,
        alreadyHere: e.roomId === roomId,
        available: conflicts.length === 0,
        reasons: conflicts,
      }
    })

    res.json({
      room,
      dayOfWeek: query.dayOfWeek,
      startPeriod: query.startPeriod,
      options,
    })
  })
)

/* --------------------------- Allocate / clear ----------------------------- */

/**
 * Point an existing class at a room, or clear it with `roomId: null`.
 * The class itself — its subject, faculty, day and period — is untouched,
 * so removing an allocation never removes the lesson.
 */
roomsRouter.patch(
  "/entries/:id/room",
  asyncHandler(async (req, res) => {
    const entryId = param(req, "id")
    const body = z.object({ roomId: z.string().nullable() }).parse(req.body)

    const entry = await prisma.timetableEntry.findUnique({
      where: { id: entryId },
      include: { section: { include: { branch: true } }, subject: true },
    })
    if (!entry) throw notFound("Class")

    // Room allocation is a timetable edit like any other, so it obeys the same
    // rule: the version the class belongs to has to be editable.
    const loaded = await loadTermContext(entry.versionId)
    await assertEditable(loaded.version)

    if (body.roomId) {
      const room = await prisma.room.findUnique({ where: { id: body.roomId } })
      if (!room) throw notFound("Room")

      const conflicts = validatePlacement(
        {
          id: entry.id,
          sectionId: entry.sectionId,
          dayOfWeek: entry.dayOfWeek as Day,
          startPeriod: entry.startPeriod,
          periodSpan: entry.periodSpan,
          entryType: entry.entryType as EntryType,
          subjectId: entry.subjectId,
          facultyId: entry.facultyId,
          roomId: body.roomId,
        },
        contextForSection(entry.sectionId, loaded)
      )

      if (conflicts.length > 0) {
        throw new AppError("That room can't take this class.", 409, conflicts)
      }
    }

    const updated = await prisma.timetableEntry.update({
      where: { id: entryId },
      data: { roomId: body.roomId },
      include: {
        room: true,
        subject: true,
        faculty: true,
        section: { include: { branch: true } },
      },
    })

    res.json({
      id: updated.id,
      roomId: updated.roomId,
      room: updated.room,
      label: classLabel(updated),
    })
  })
)
