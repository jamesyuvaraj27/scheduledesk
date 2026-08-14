import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { AppError, asyncHandler } from "../lib/errors.js"
import { buildDayGrid, dayEndTime } from "../lib/periods.js"
import {
  validateSection,
  type Day,
  type EntryType,
  type PlacedEntry,
  type RoomType,
  type SchedulingContext,
} from "../lib/scheduling.js"

export const overviewRouter = Router()

/**
 * Whole-college views: how far along every section is, and everything needed
 * to print the full set of timetables at once.
 *
 * Both load the term's data in ONE pass and then work in memory. Running the
 * per-section endpoints in a loop would mean a query storm for eight sections.
 */

async function loadTermData() {
  const term = await prisma.academicTerm.findFirst({
    where: { isActive: true },
    include: { timeConfig: true },
  })
  if (!term?.timeConfig) return null

  const [sections, entries, sectionSubjects, assignments, rooms, faculty] =
    await Promise.all([
      prisma.section.findMany({
        orderBy: [{ year: "asc" }, { name: "asc" }],
        include: { branch: { include: { department: true } }, homeRoom: true },
      }),
      prisma.timetableEntry.findMany({
        where: { termId: term.id },
        include: { subject: true, faculty: true, room: true },
      }),
      prisma.sectionSubject.findMany({
        where: { termId: term.id },
        include: { subject: true },
      }),
      prisma.sectionAssignment.findMany({ where: { termId: term.id } }),
      prisma.room.findMany(),
      prisma.faculty.findMany(),
    ])

  const placed: PlacedEntry[] = entries.map((e) => ({
    id: e.id,
    sectionId: e.sectionId,
    dayOfWeek: e.dayOfWeek as Day,
    startPeriod: e.startPeriod,
    periodSpan: e.periodSpan,
    entryType: e.entryType as EntryType,
    subjectId: e.subjectId,
    facultyId: e.facultyId,
    roomId: e.roomId,
  }))

  const roomMap = new Map(
    rooms.map((r) => [r.id, { id: r.id, name: r.name, type: r.type as RoomType }])
  )
  const facultyNames = new Map(faculty.map((f) => [f.id, f.name]))
  const sectionNames = new Map(
    sections.map((s) => [s.id, `${s.branch.code}-${s.name} (Yr ${s.year})`])
  )

  /** Per-section context that still sees every other section's entries. */
  const contextFor = (sectionId: string): SchedulingContext => ({
    timeConfig: term.timeConfig!,
    entries: placed,
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
    rooms: roomMap,
    names: { faculty: facultyNames, sections: sectionNames },
  })

  return { term, sections, entries, sectionSubjects, assignments, contextFor }
}

/* ----------------------------- Build status ------------------------------ */

overviewRouter.get(
  "/build-status",
  asyncHandler(async (_req, res) => {
    const data = await loadTermData()
    if (!data) return res.json({ term: null, years: [] })

    const { term, sections, entries, sectionSubjects, assignments, contextFor } = data

    const rows = sections.map((section) => {
      const validation = validateSection(section.id, contextFor(section.id), {
        hasHomeRoom: Boolean(section.homeRoomId),
      })
      const subs = sectionSubjects.filter((ss) => ss.sectionId === section.id)
      const assigned = assignments.filter((a) => a.sectionId === section.id)
      const mine = entries.filter((e) => e.sectionId === section.id)

      const requiredPeriods =
        subs.reduce((n, ss) => n + ss.weeklyTheoryHrs + ss.weeklyLabHrs, 0) +
        validation.activities.length // library + seminar + counseling
      const placedPeriods = mine.reduce((n, e) => n + e.periodSpan, 0)

      const curriculumReady =
        subs.length > 0 && assigned.length === subs.length && Boolean(section.homeRoomId)

      return {
        section: {
          id: section.id,
          name: section.name,
          year: section.year,
          branchCode: section.branch.code,
          branchName: section.branch.name,
          departmentCode: section.branch.department.code,
          homeRoom: section.homeRoom?.name ?? null,
        },
        curriculum: {
          subjectCount: subs.length,
          assignedCount: assigned.length,
          ready: curriculumReady,
        },
        timetable: {
          placedPeriods,
          requiredPeriods,
          complete: validation.valid,
          errorCount: validation.errors.length,
          warnings: validation.warnings,
        },
        // What the admin should do next for this section.
        stage: !section.homeRoomId
          ? ("needs-room" as const)
          : subs.length === 0
            ? ("needs-curriculum" as const)
            : assigned.length < subs.length
              ? ("needs-faculty" as const)
              : validation.valid
                ? ("done" as const)
                : placedPeriods === 0
                  ? ("ready-to-build" as const)
                  : ("in-progress" as const),
      }
    })

    const years = [...new Set(rows.map((r) => r.section.year))]
      .sort()
      .map((year) => {
        const inYear = rows.filter((r) => r.section.year === year)
        return {
          year,
          sections: inYear,
          done: inYear.filter((r) => r.timetable.complete).length,
          total: inYear.length,
        }
      })

    res.json({
      term: { id: term.id, label: term.label },
      years,
      totals: {
        sections: rows.length,
        done: rows.filter((r) => r.timetable.complete).length,
        notStarted: rows.filter((r) => r.timetable.placedPeriods === 0).length,
      },
    })
  })
)

/* ------------------------------- Print all ------------------------------- */

/**
 * Every section's timetable in one response, so the office can print the
 * whole set in a single pass (and "Save as PDF" for one file).
 */
overviewRouter.get(
  "/print/sections",
  asyncHandler(async (req, res) => {
    const year = z.coerce.number().int().min(1).max(4).optional().parse(req.query.year)
    const data = await loadTermData()
    if (!data) {
      throw new AppError("No active academic term with daily timings.", 409)
    }

    const { term, sections, entries, sectionSubjects, assignments } = data
    const cfg = term.timeConfig!
    const wanted = year ? sections.filter((s) => s.year === year) : sections

    const facultyById = new Map(
      (await prisma.faculty.findMany()).map((f) => [f.id, f.name])
    )

    res.json({
      term: { id: term.id, label: term.label },
      grid: {
        slots: buildDayGrid(cfg),
        endTime: dayEndTime(cfg),
        workingDays: cfg.workingDays,
        numPeriods: cfg.numPeriods,
      },
      sections: wanted.map((section) => ({
        section: {
          id: section.id,
          name: section.name,
          year: section.year,
          branch: { code: section.branch.code, name: section.branch.name },
          department: { code: section.branch.department.code },
          homeRoom: section.homeRoom,
        },
        entries: entries
          .filter((e) => e.sectionId === section.id)
          .map((e) => ({
            id: e.id,
            dayOfWeek: e.dayOfWeek,
            startPeriod: e.startPeriod,
            periodSpan: e.periodSpan,
            entryType: e.entryType,
            subject: e.subject,
            faculty: e.faculty,
            room: e.room,
          })),
        legend: sectionSubjects
          .filter((ss) => ss.sectionId === section.id)
          .map((ss) => {
            const facultyId = assignments.find(
              (a) => a.sectionId === section.id && a.subjectId === ss.subjectId
            )?.facultyId
            return {
              subjectId: ss.subjectId,
              code: ss.subject.code,
              facultyName: facultyId ? (facultyById.get(facultyId) ?? null) : null,
            }
          })
          .sort((a, b) => a.code.localeCompare(b.code)),
      })),
    })
  })
)
