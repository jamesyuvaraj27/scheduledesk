import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { AppError, asyncHandler, notFound, param } from "../lib/errors.js"
import { buildDayGrid, dayEndTime } from "../lib/periods.js"
import {
  computeAvailability,
  validatePlacement,
  validateSection,
  isActivity,
  type Candidate,
  type Day,
  type EntryType,
  type PlacedEntry,
  type RoomType,
  type SchedulingContext,
} from "../lib/scheduling.js"

export const timetableRouter = Router()

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const
const ENTRY_TYPES = ["THEORY", "LAB", "LIBRARY", "SEMINAR", "COUNSELING"] as const

/**
 * Assemble everything the conflict engine needs. Note that `entries` covers
 * the WHOLE term across every section and year — that's what lets a 2nd-year
 * placement be checked against a faculty member's existing 3rd/4th-year
 * commitments.
 */
async function loadContext(sectionId: string) {
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

  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    include: { branch: { include: { department: true } }, homeRoom: true },
  })
  if (!section) throw notFound("Section")

  const [entries, sectionSubjects, assignments, rooms, faculty, allSections] =
    await Promise.all([
      prisma.timetableEntry.findMany({
        where: { termId: term.id },
        include: {
          subject: true,
          faculty: true,
          room: true,
          section: { include: { branch: true } },
        },
      }),
      prisma.sectionSubject.findMany({
        where: { termId: term.id, sectionId },
        include: { subject: true },
      }),
      prisma.sectionAssignment.findMany({
        where: { termId: term.id, sectionId },
      }),
      prisma.room.findMany(),
      prisma.faculty.findMany(),
      prisma.section.findMany({ include: { branch: true } }),
    ])

  const ctx: SchedulingContext = {
    timeConfig: term.timeConfig,
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
    curriculum: sectionSubjects.map((ss) => ({
      subjectId: ss.subjectId,
      subjectCode: ss.subject.code,
      weeklyTheoryHrs: ss.weeklyTheoryHrs,
      weeklyLabHrs: ss.weeklyLabHrs,
    })),
    assignments: new Map(assignments.map((a) => [a.subjectId, a.facultyId])),
    rooms: new Map(
      rooms.map((r) => [r.id, { id: r.id, name: r.name, type: r.type as RoomType }])
    ),
    names: {
      faculty: new Map(faculty.map((f) => [f.id, f.name])),
      sections: new Map(
        allSections.map((s) => [s.id, `${s.branch.code}-${s.name} (Yr ${s.year})`])
      ),
      subjects: new Map(sectionSubjects.map((ss) => [ss.subjectId, ss.subject.code])),
    },
  }

  return { term, section, ctx, richEntries: entries }
}

/**
 * The room an entry should use. Rooms are fixed per section — only labs
 * move — so everything except a lab defaults to the section's home room.
 */
function resolveRoomId(
  entryType: EntryType,
  explicitRoomId: string | null | undefined,
  homeRoomId: string | null
): string | null {
  if (entryType === "LAB") return explicitRoomId ?? null
  return explicitRoomId ?? homeRoomId
}

/* ------------------------- Read a section's grid ------------------------- */

timetableRouter.get(
  "/sections/:id/timetable",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const { term, section, ctx, richEntries } = await loadContext(sectionId)
    const cfg = ctx.timeConfig

    const mine = richEntries.filter((e) => e.sectionId === sectionId)
    const validation = validateSection(sectionId, ctx, {
      hasHomeRoom: Boolean(section.homeRoomId),
    })

    res.json({
      term: { id: term.id, label: term.label },
      section,
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
        subject: e.subject,
        faculty: e.faculty,
        room: e.room,
      })),
      // The legend printed under the timetable: subject code -> faculty.
      legend: ctx.curriculum.map((c) => {
        const facultyId = ctx.assignments.get(c.subjectId)
        return {
          subjectId: c.subjectId,
          code: c.subjectCode,
          facultyName: facultyId ? (ctx.names?.faculty?.get(facultyId) ?? null) : null,
        }
      }),
      validation,
    })
  })
)

/* ---------------------- Where could this class go? ----------------------- */

/**
 * Powers the clash-blocked picker. The client asks "I want to place subject X
 * (or a library hour) — where can it go?" and gets back every slot with a
 * flag and, when blocked, the reason.
 */
timetableRouter.get(
  "/sections/:id/availability",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const query = z
      .object({
        entryType: z.enum(ENTRY_TYPES),
        subjectId: z.string().optional(),
        roomId: z.string().optional(),
        entryId: z.string().optional(),
        // How many consecutive periods the lab should cover. Labs are no
        // longer pinned to a fixed span — the admin chooses.
        periodSpan: z.coerce.number().int().min(1).max(12).optional(),
      })
      .parse(req.query)

    const { section, ctx } = await loadContext(sectionId)

    const facultyId = query.subjectId
      ? (ctx.assignments.get(query.subjectId) ?? null)
      : null

    const base: Omit<Candidate, "dayOfWeek" | "startPeriod"> = {
      id: query.entryId,
      sectionId,
      periodSpan: query.entryType === "LAB" ? (query.periodSpan ?? 1) : 1,
      entryType: query.entryType,
      subjectId: query.subjectId ?? null,
      facultyId,
      roomId: resolveRoomId(query.entryType, query.roomId, section.homeRoomId),
    }

    res.json({
      periodSpan: base.periodSpan,
      facultyId,
      roomId: base.roomId,
      slots: computeAvailability(base, ctx),
    })
  })
)

/* --------------------------- Place / move / drop ------------------------- */

const entrySchema = z.object({
  dayOfWeek: z.enum(DAYS),
  startPeriod: z.number().int().min(1),
  entryType: z.enum(ENTRY_TYPES),
  subjectId: z.string().nullish(),
  roomId: z.string().nullish(),
  /** Consecutive periods covered. Only meaningful for labs; others are 1. */
  periodSpan: z.number().int().min(1).max(12).optional(),
})

timetableRouter.post(
  "/sections/:id/entries",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const body = entrySchema.parse(req.body)
    const { term, section, ctx } = await loadContext(sectionId)

    const candidate = buildCandidate(sectionId, body, section.homeRoomId, ctx)
    const conflicts = validatePlacement(candidate, ctx)
    if (conflicts.length) {
      throw new AppError("That placement isn't allowed.", 409, conflicts)
    }

    const created = await prisma.timetableEntry.create({
      data: {
        termId: term.id,
        sectionId,
        dayOfWeek: candidate.dayOfWeek,
        startPeriod: candidate.startPeriod,
        periodSpan: candidate.periodSpan,
        entryType: candidate.entryType,
        subjectId: candidate.subjectId ?? null,
        facultyId: candidate.facultyId ?? null,
        roomId: candidate.roomId ?? null,
      },
      include: { subject: true, faculty: true, room: true },
    })

    res.status(201).json(created)
  })
)

timetableRouter.patch(
  "/entries/:id",
  asyncHandler(async (req, res) => {
    const entryId = param(req, "id")
    const existing = await prisma.timetableEntry.findUnique({ where: { id: entryId } })
    if (!existing) throw notFound("Timetable entry")

    const body = entrySchema.partial().parse(req.body)
    const { section, ctx } = await loadContext(existing.sectionId)

    const merged = {
      dayOfWeek: body.dayOfWeek ?? (existing.dayOfWeek as (typeof DAYS)[number]),
      startPeriod: body.startPeriod ?? existing.startPeriod,
      entryType: body.entryType ?? (existing.entryType as EntryType),
      subjectId: body.subjectId !== undefined ? body.subjectId : existing.subjectId,
      roomId: body.roomId !== undefined ? body.roomId : existing.roomId,
    }

    const candidate = buildCandidate(
      existing.sectionId,
      merged,
      section.homeRoomId,
      ctx,
      entryId
    )
    const conflicts = validatePlacement(candidate, ctx)
    if (conflicts.length) {
      throw new AppError("That move isn't allowed.", 409, conflicts)
    }

    const updated = await prisma.timetableEntry.update({
      where: { id: entryId },
      data: {
        dayOfWeek: candidate.dayOfWeek,
        startPeriod: candidate.startPeriod,
        periodSpan: candidate.periodSpan,
        entryType: candidate.entryType,
        subjectId: candidate.subjectId ?? null,
        facultyId: candidate.facultyId ?? null,
        roomId: candidate.roomId ?? null,
      },
      include: { subject: true, faculty: true, room: true },
    })

    res.json(updated)
  })
)

timetableRouter.delete(
  "/entries/:id",
  asyncHandler(async (req, res) => {
    await prisma.timetableEntry.delete({ where: { id: param(req, "id") } })
    res.status(204).end()
  })
)

/** Clear a whole section's timetable — useful when restarting a build. */
timetableRouter.delete(
  "/sections/:id/entries",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const term = await prisma.academicTerm.findFirst({ where: { isActive: true } })
    if (!term) throw new AppError("No active academic term.", 409)

    const { count } = await prisma.timetableEntry.deleteMany({
      where: { termId: term.id, sectionId },
    })
    res.json({ deleted: count })
  })
)

function buildCandidate(
  sectionId: string,
  body: {
    dayOfWeek: (typeof DAYS)[number]
    startPeriod: number
    entryType: EntryType
    subjectId?: string | null
    roomId?: string | null
    periodSpan?: number
  },
  homeRoomId: string | null,
  ctx: SchedulingContext,
  id?: string
): Candidate {
  // Faculty is never chosen at placement time — it comes from the
  // section/subject assignment locked in during term setup.
  const facultyId =
    !isActivity(body.entryType) && body.subjectId
      ? (ctx.assignments.get(body.subjectId) ?? null)
      : null

  return {
    id,
    sectionId,
    dayOfWeek: body.dayOfWeek as Day,
    startPeriod: body.startPeriod,
    periodSpan: body.entryType === "LAB" ? (body.periodSpan ?? 1) : 1,
    entryType: body.entryType,
    subjectId: body.subjectId ?? null,
    facultyId,
    roomId: resolveRoomId(body.entryType, body.roomId, homeRoomId),
  }
}

/* ------------------------------- Validation ------------------------------ */

timetableRouter.get(
  "/sections/:id/validate",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const { ctx, section } = await loadContext(sectionId)
    res.json(
      validateSection(sectionId, ctx, { hasHomeRoom: Boolean(section.homeRoomId) })
    )
  })
)

/* -------------------- Faculty timetable (derived, never stored) ---------- */

/**
 * A faculty member's week is a query over placed entries, not a stored
 * table — so it can never drift out of sync with the section timetables it
 * comes from.
 */
timetableRouter.get(
  "/faculty/:id/timetable",
  asyncHandler(async (req, res) => {
    const facultyId = param(req, "id")

    const term = await prisma.academicTerm.findFirst({
      where: { isActive: true },
      include: { timeConfig: true },
    })
    if (!term || !term.timeConfig) {
      throw new AppError("No active academic term with daily timings.", 409)
    }

    const faculty = await prisma.faculty.findUnique({
      where: { id: facultyId },
      include: { department: true },
    })
    if (!faculty) throw notFound("Faculty")

    const entries = await prisma.timetableEntry.findMany({
      where: { termId: term.id, facultyId },
      include: {
        subject: true,
        room: true,
        section: { include: { branch: { include: { department: true } } } },
      },
      orderBy: [{ dayOfWeek: "asc" }, { startPeriod: "asc" }],
    })

    const cfg = term.timeConfig
    const byDay: Record<string, number> = {}
    for (const e of entries) {
      byDay[e.dayOfWeek] = (byDay[e.dayOfWeek] ?? 0) + e.periodSpan
    }

    const totalPeriods = cfg.workingDays.length * cfg.numPeriods
    const taught = entries.reduce((n, e) => n + e.periodSpan, 0)

    res.json({
      term: { id: term.id, label: term.label },
      faculty,
      grid: {
        slots: buildDayGrid(cfg),
        endTime: dayEndTime(cfg),
        workingDays: cfg.workingDays,
        numPeriods: cfg.numPeriods,
      },
      entries: entries.map((e) => ({
        id: e.id,
        dayOfWeek: e.dayOfWeek,
        startPeriod: e.startPeriod,
        periodSpan: e.periodSpan,
        entryType: e.entryType,
        subject: e.subject,
        room: e.room,
        section: {
          id: e.section.id,
          name: e.section.name,
          year: e.section.year,
          branchCode: e.section.branch.code,
          departmentCode: e.section.branch.department.code,
        },
      })),
      summary: {
        weeklyPeriods: taught,
        freePeriods: totalPeriods - taught,
        byDay,
      },
    })
  })
)
