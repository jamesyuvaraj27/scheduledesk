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
  computeAvailability,
  validatePlacement,
  validateSection,
  isActivity,
  requiresNoRoom,
  type Candidate,
  type Day,
  type EntryType,
  type PlacedEntry,
  type RoomType,
  type SchedulingContext,
} from "../lib/scheduling.js"
import { joinSharedSlot, pruneSharedSlot } from "../lib/sharedSlots.js"

export const timetableRouter = Router()

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const
const ENTRY_TYPES = ["THEORY", "LAB", "LIBRARY", "SEMINAR", "COUNSELING", "SPORTS"] as const

/**
 * Assemble everything the conflict engine needs. Note that `entries` covers
 * the WHOLE term across every section and year — that's what lets a 2nd-year
 * placement be checked against a faculty member's existing 3rd/4th-year
 * commitments.
 */
async function loadContext(sectionId: string, versionSpec?: VersionSpec) {
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

  // Which timetable are we looking at — the live one or the working copy?
  // Everything below reads and writes entries for this version only, so the
  // two can never bleed into each other.
  const version = await resolveVersion(term.id, versionSpec)

  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    include: { branch: { include: { department: true } }, homeRoom: true },
  })
  if (!section) throw notFound("Section")

  const [entries, sectionSubjects, assignments, rooms, faculty, allSections] =
    await Promise.all([
      prisma.timetableEntry.findMany({
        where: { versionId: version.id },
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
        sharedSlotId: e.sharedSlotId,
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

  // Faculty numbers for display. The conflict engine's `names.faculty` map is
  // deliberately left as plain names — it writes sentences, not labels.
  const facultyNumbers = new Map(faculty.map((f) => [f.id, f.facultyNo]))

  return { term, version, section, ctx, richEntries: entries, facultyNumbers }
}

/**
 * The room an entry should use. Rooms are fixed per section — only labs
 * move — so everything except a lab defaults to the section's home room.
 *
 * SPORTS and LIBRARY are the exception: they never get that default. A lab
 * needs an explicit room because it moves between real laboratories; SPORTS
 * and LIBRARY need no room at all, so an explicit choice (if the admin ever
 * makes one, e.g. via room allocation) is honoured, but nothing is assumed.
 */
function resolveRoomId(
  entryType: EntryType,
  explicitRoomId: string | null | undefined,
  homeRoomId: string | null
): string | null {
  if (entryType === "LAB" || requiresNoRoom(entryType)) return explicitRoomId ?? null
  return explicitRoomId ?? homeRoomId
}

/* ------------------------- Read a section's grid ------------------------- */

timetableRouter.get(
  "/sections/:id/timetable",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const { term, version, section, ctx, richEntries, facultyNumbers } =
      await loadContext(sectionId, versionSpecFromRequest(req))
    const cfg = ctx.timeConfig

    const mine = richEntries.filter((e) => e.sectionId === sectionId)
    const validation = validateSection(sectionId, ctx, {
      hasHomeRoom: Boolean(section.homeRoomId),
    })

    res.json({
      term: { id: term.id, label: term.label },
      version: { id: version.id, kind: version.kind, label: version.label },
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
          facultyNo: facultyId ? (facultyNumbers.get(facultyId) ?? null) : null,
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

    const { section, ctx } = await loadContext(sectionId, versionSpecFromRequest(req))

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

    const slots = computeAvailability(base, ctx)

    // The grid greys out an hour where this section's teacher is already
    // busy, which is exactly the hour a combined class has to go in — so
    // without this, a combined class would be unreachable: there is no free
    // cell to click.
    //
    // For each blocked hour, ask the same engine a second question: would
    // this be legal if the office declared the two a deliberate pair? Only
    // when the answer is yes does the client offer to combine. Everything
    // that sharing would NOT fix — most importantly one teacher against two
    // different subjects — comes back blocked, so the offer never appears
    // where it would be wrong.
    const byId = new Map(ctx.entries.map((e) => [e.id, e]))
    const withCombine = slots.map((slot) => {
      if (slot.available) return { ...slot, combinableWithEntryId: null }

      const blockers = slot.reasons
      const targetIds = new Set(
        blockers.map((r) => r.conflictingEntryId).filter(Boolean) as string[]
      )
      // Only a straight two-way overlap is offerable. Anything else (a
      // section clash, a bad span, three-way congestion) is a real problem.
      const onlyClashes = blockers.every(
        (r) =>
          (r.code === "FACULTY_CLASH" || r.code === "ROOM_CLASH") &&
          r.conflictingEntryId
      )
      if (!onlyClashes || targetIds.size !== 1) {
        return { ...slot, combinableWithEntryId: null }
      }

      const targetId = [...targetIds][0]
      const target = byId.get(targetId)
      if (!target) return { ...slot, combinableWithEntryId: null }

      const preview = `preview:${targetId}`
      const asShared = validatePlacement(
        {
          ...base,
          dayOfWeek: slot.dayOfWeek,
          startPeriod: slot.startPeriod,
          // A combined class sits in the other class's room, by definition.
          roomId: target.roomId,
          sharedSlotId: preview,
        },
        {
          ...ctx,
          entries: ctx.entries.map((e) =>
            e.id === targetId ? { ...e, sharedSlotId: preview } : e
          ),
        }
      )

      return {
        ...slot,
        combinableWithEntryId: asShared.length === 0 ? targetId : null,
      }
    })

    res.json({
      periodSpan: base.periodSpan,
      facultyId,
      roomId: base.roomId,
      slots: withCombine,
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
  /**
   * Deliberately place this alongside an existing class in the same room and
   * hour — the Combined Section case, where one teacher takes one subject to
   * both sections at once.
   *
   * The room is inherited from that class rather than taken from the request,
   * because a combined class is by definition in one room; letting the caller
   * name a different one would describe something impossible.
   *
   * Omitting this leaves every clash rule exactly as it was, so nothing can
   * become a combined class by accident.
   */
  shareWithEntryId: z.string().nullish(),
})

timetableRouter.post(
  "/sections/:id/entries",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const body = entrySchema.parse(req.body)
    const { term, version, section, ctx } = await loadContext(
      sectionId,
      versionSpecFromRequest(req)
    )
    await assertEditable(version)

    const candidate = buildCandidate(sectionId, body, section.homeRoomId, ctx)

    // Combining adopts the other class's room, so resolve it before the
    // conflict check rather than after — the room is part of what's checked.
    if (body.shareWithEntryId) {
      const target = await prisma.timetableEntry.findUnique({
        where: { id: body.shareWithEntryId },
      })
      if (!target) throw notFound("The class to combine with")
      candidate.roomId = target.roomId
      candidate.sharedSlotId = await joinSharedSlot(body.shareWithEntryId, {
        versionId: version.id,
        dayOfWeek: candidate.dayOfWeek,
        startPeriod: candidate.startPeriod,
        periodSpan: candidate.periodSpan,
        roomId: target.roomId,
      })
    }

    // Re-read when a share was just established: joinSharedSlot may have
    // tagged the target, and `ctx` was loaded before that write.
    const checkCtx = body.shareWithEntryId
      ? (await loadContext(sectionId, version.id)).ctx
      : ctx

    const conflicts = validatePlacement(candidate, checkCtx)
    if (conflicts.length) {
      // Establishing the share tagged the class being joined, but the
      // placement is being refused — so that tag now describes a pairing
      // that does not exist. Take it back off rather than leaving a failed
      // request's fingerprints on an entry the user never changed.
      if (body.shareWithEntryId) {
        await pruneSharedSlot(candidate.sharedSlotId ?? null)
      }
      throw new AppError("That placement isn't allowed.", 409, conflicts)
    }

    const created = await prisma.timetableEntry.create({
      data: {
        termId: term.id,
        versionId: version.id,
        sectionId,
        dayOfWeek: candidate.dayOfWeek,
        startPeriod: candidate.startPeriod,
        periodSpan: candidate.periodSpan,
        entryType: candidate.entryType,
        subjectId: candidate.subjectId ?? null,
        facultyId: candidate.facultyId ?? null,
        roomId: candidate.roomId ?? null,
        sharedSlotId: candidate.sharedSlotId ?? null,
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
    const { version, section, ctx } = await loadContext(
      existing.sectionId,
      existing.versionId
    )
    await assertEditable(version)

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

    // Dragging a class to another hour takes it out of whatever it was
    // sharing. Carrying the tag along would exempt it from the room and
    // faculty checks at its new time, where nothing was ever agreed.
    const stillInPlace =
      existing.sharedSlotId !== null &&
      candidate.dayOfWeek === existing.dayOfWeek &&
      candidate.startPeriod === existing.startPeriod &&
      candidate.periodSpan === existing.periodSpan &&
      (candidate.roomId ?? null) === existing.roomId
    candidate.sharedSlotId = stillInPlace ? existing.sharedSlotId : null
    const abandonedSlot = stillInPlace ? null : existing.sharedSlotId

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
        sharedSlotId: candidate.sharedSlotId ?? null,
      },
      include: { subject: true, faculty: true, room: true },
    })

    await pruneSharedSlot(abandonedSlot)

    res.json(updated)
  })
)

timetableRouter.delete(
  "/entries/:id",
  asyncHandler(async (req, res) => {
    const id = param(req, "id")
    const existing = await prisma.timetableEntry.findUnique({ where: { id } })
    if (!existing) throw notFound("Timetable entry")

    // The entry's own version decides whether it may be removed — a delete
    // aimed at the live timetable while a working copy exists is refused.
    const term = await prisma.academicTerm.findFirstOrThrow({
      where: { id: existing.termId },
    })
    await assertEditable(await resolveVersion(term.id, existing.versionId))

    await prisma.timetableEntry.delete({ where: { id } })
    // Removing one half of a pair leaves the other an ordinary class again.
    await pruneSharedSlot(existing.sharedSlotId)
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

    const version = await resolveVersion(term.id, versionSpecFromRequest(req))
    await assertEditable(version)

    const { count } = await prisma.timetableEntry.deleteMany({
      where: { versionId: version.id, sectionId },
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
    const { ctx, section } = await loadContext(sectionId, versionSpecFromRequest(req))
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

    const version = await resolveVersion(term.id, versionSpecFromRequest(req))

    const entries = await prisma.timetableEntry.findMany({
      where: { versionId: version.id, facultyId },
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
