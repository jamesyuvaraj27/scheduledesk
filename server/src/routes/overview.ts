import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { AppError, asyncHandler } from "../lib/errors.js"
import { buildDayGrid, dayEndTime } from "../lib/periods.js"
import {
  resolveVersion,
  versionSpecFromRequest,
  type VersionSpec,
} from "../lib/versions.js"
import {
  validateSection,
  type Day,
  type EntryType,
  type PlacedEntry,
  type RoomType,
  type SchedulingContext,
} from "../lib/scheduling.js"
import { compareSections } from "../lib/sectionOrder.js"

export const overviewRouter = Router()

const ROMAN = ["", "I", "II", "III", "IV"]

/**
 * The label printed on a room-timetable cell: YEAR_BRANCH_SECTION_SUBJECT,
 * e.g. `IV_CSM_A_CN` — matches the admin Room Timetable page and the public
 * student view, so the same shorthand reads the same everywhere it's printed.
 */
function roomEntryLabel(e: {
  section: { year: number; name: string; branch: { code: string } }
  subject: { code: string } | null
  entryType: string
}): string {
  const year = ROMAN[e.section.year] ?? String(e.section.year)
  const what = e.subject?.code ?? e.entryType
  return `${year}_${e.section.branch.code}_${e.section.name}_${what}`.replace(/\s+/g, "_")
}

/**
 * Whole-college views: how far along every section is, and everything needed
 * to print the full set of timetables at once.
 *
 * Both load the term's data in ONE pass and then work in memory. Running the
 * per-section endpoints in a loop would mean a query storm for eight sections.
 */

async function loadTermData(versionSpec?: VersionSpec) {
  const term = await prisma.academicTerm.findFirst({
    where: { isActive: true },
    include: { timeConfig: true },
  })
  if (!term?.timeConfig) return null

  const version = await resolveVersion(term.id, versionSpec)

  const [sections, entries, sectionSubjects, assignments, rooms, faculty] =
    await Promise.all([
      prisma.section.findMany({
        orderBy: [{ year: "asc" }, { name: "asc" }],
        include: { branch: { include: { department: true } }, homeRoom: true },
      }),
      prisma.timetableEntry.findMany({
        where: { versionId: version.id },
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

  // Feeds both /build-status (Dashboard) and /print/sections (Print All) —
  // fixing the order once here covers both.
  sections.sort(
    compareSections({
      yearOf: (s) => s.year,
      branchCodeOf: (s) => s.branch.code,
      nameOf: (s) => s.name,
    })
  )

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
    sharedSlotId: e.sharedSlotId,
  }))

  const roomMap = new Map(
    rooms.map((r) => [r.id, { id: r.id, name: r.name, type: r.type as RoomType }])
  )
  const facultyNames = new Map(faculty.map((f) => [f.id, f.name]))
  const sectionNames = new Map(
    sections.map((s) => [s.id, `${s.branch.code}-${s.name} (Yr ${s.year})`])
  )
  // Term-wide, derived from every placed entry's own subject — not any one
  // section's curriculum. `unmergedFacultyTwins()` (called for every
  // section via `validateSection`) can name a twin between two OTHER
  // sections, so it needs a subject lookup that isn't scoped to whichever
  // section is currently being validated. Mirrors `contextForSection()` in
  // rooms.ts, which the same warning already relies on there.
  const subjectNames = new Map(
    entries.filter((e) => e.subject).map((e) => [e.subjectId!, e.subject!.code])
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
    names: { faculty: facultyNames, sections: sectionNames, subjects: subjectNames },
  })

  return { term, version, sections, entries, sectionSubjects, assignments, contextFor }
}

/* ----------------------------- Build status ------------------------------ */

overviewRouter.get(
  "/build-status",
  asyncHandler(async (req, res) => {
    const data = await loadTermData(versionSpecFromRequest(req))
    if (!data) return res.json({ term: null, years: [] })

    const { term, version, sections, entries, sectionSubjects, assignments, contextFor } =
      data

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
      version: { id: version.id, kind: version.kind, label: version.label },
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
    const data = await loadTermData(versionSpecFromRequest(req))
    if (!data) {
      throw new AppError("No active academic term with daily timings.", 409)
    }

    const { term, version, sections, entries, sectionSubjects, assignments } = data
    const cfg = term.timeConfig!
    const wanted = year ? sections.filter((s) => s.year === year) : sections

    // Both parts are returned separately: the client decides how to show
    // "FAC003 — Ms. Y. Sireesha", and anything reading facultyName still gets
    // just the name.
    const facultyById = new Map(
      (await prisma.faculty.findMany()).map((f) => [
        f.id,
        { name: f.name, facultyNo: f.facultyNo },
      ])
    )

    res.json({
      term: { id: term.id, label: term.label },
      version: { id: version.id, kind: version.kind, label: version.label },
      grid: {
        slots: buildDayGrid(cfg),
        endTime: dayEndTime(cfg),
        workingDays: cfg.workingDays,
        numPeriods: cfg.numPeriods,
      },
      // NOTE: each section used to carry a `roomTimetable` — its home room's
      // own full week, drawn as a second grid below the section sheet.
      // Removed 2026-08-22: the room is now printed inside each cell, so the
      // second grid was repeating itself. A room's own week is still printable
      // in full from GET /print/rooms below.
      sections: wanted.map((section) => {
        return {
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
              const f = facultyId ? (facultyById.get(facultyId) ?? null) : null
              return {
                subjectId: ss.subjectId,
                code: ss.subject.code,
                facultyName: f?.name ?? null,
                facultyNo: f?.facultyNo ?? null,
              }
            })
            .sort((a, b) => a.code.localeCompare(b.code)),
        }
      }),
    })
  })
)

/* --------------------- Print all faculty / all rooms ---------------------- */

/**
 * Every faculty member's week, in one response.
 *
 * Deliberately not "call /faculty/:id/timetable in a loop": fourteen faculty
 * is fourteen round trips to a free-tier instance that may be asleep. Same
 * rule as the two endpoints above — load the term once, then filter in memory.
 *
 * `?includeEmpty=1` keeps faculty with no classes; by default they're dropped,
 * because a blank sheet per unassigned faculty member is wasted paper.
 */
overviewRouter.get(
  "/print/faculty",
  asyncHandler(async (req, res) => {
    const includeEmpty = req.query.includeEmpty === "1"
    const data = await loadTermData(versionSpecFromRequest(req))
    if (!data) {
      throw new AppError("No active academic term with daily timings.", 409)
    }

    const { term, version, sections, entries } = data
    const cfg = term.timeConfig!

    const faculty = await prisma.faculty.findMany({
      where: { isActive: true },
      include: { department: true },
      orderBy: { facultyNo: "asc" },
    })

    const sectionsById = new Map(sections.map((s) => [s.id, s]))
    const totalPeriods = cfg.workingDays.length * cfg.numPeriods

    const rows = faculty
      .map((f) => {
        const mine = entries
          .filter((e) => e.facultyId === f.id)
          .sort(
            (a, b) =>
              a.dayOfWeek.localeCompare(b.dayOfWeek) || a.startPeriod - b.startPeriod
          )
        const taught = mine.reduce((n, e) => n + e.periodSpan, 0)

        return {
          faculty: {
            id: f.id,
            facultyNo: f.facultyNo,
            name: f.name,
            departmentCode: f.department.code,
          },
          // Same entry shape the single-faculty page renders, so one cell
          // component covers both.
          entries: mine.map((e) => {
            const owner = sectionsById.get(e.sectionId)!
            return {
              id: e.id,
              dayOfWeek: e.dayOfWeek,
              startPeriod: e.startPeriod,
              periodSpan: e.periodSpan,
              entryType: e.entryType,
              subject: e.subject,
              room: e.room,
              section: {
                id: owner.id,
                name: owner.name,
                year: owner.year,
                branchCode: owner.branch.code,
                departmentCode: owner.branch.department.code,
              },
            }
          }),
          summary: { weeklyPeriods: taught, freePeriods: totalPeriods - taught },
        }
      })
      .filter((r) => includeEmpty || r.entries.length > 0)

    res.json({
      term: { id: term.id, label: term.label },
      version: { id: version.id, kind: version.kind, label: version.label },
      grid: {
        slots: buildDayGrid(cfg),
        endTime: dayEndTime(cfg),
        workingDays: cfg.workingDays,
        numPeriods: cfg.numPeriods,
      },
      faculty: rows,
    })
  })
)

/**
 * Every room's week, in one response — the room-side twin of the endpoint
 * above. Rooms with nothing timetabled in them are dropped unless
 * `?includeEmpty=1`.
 *
 * The cell label is the same YEAR_BRANCH_SECTION_SUBJECT shorthand the admin
 * Room Timetable page uses, so a printed room sheet reads identically to the
 * screen it came from.
 */
overviewRouter.get(
  "/print/rooms",
  asyncHandler(async (req, res) => {
    const includeEmpty = req.query.includeEmpty === "1"
    const data = await loadTermData(versionSpecFromRequest(req))
    if (!data) {
      throw new AppError("No active academic term with daily timings.", 409)
    }

    const { term, version, sections, entries } = data
    const cfg = term.timeConfig!

    const rooms = await prisma.room.findMany({
      orderBy: [{ block: "asc" }, { floor: "asc" }, { name: "asc" }],
    })
    const sectionsById = new Map(sections.map((s) => [s.id, s]))

    const rows = rooms
      .map((room) => ({
        room,
        entries: entries
          .filter((e) => e.roomId === room.id)
          .sort(
            (a, b) =>
              a.dayOfWeek.localeCompare(b.dayOfWeek) || a.startPeriod - b.startPeriod
          )
          .map((e) => {
            const owner = sectionsById.get(e.sectionId)!
            return {
              id: e.id,
              dayOfWeek: e.dayOfWeek,
              startPeriod: e.startPeriod,
              periodSpan: e.periodSpan,
              entryType: e.entryType,
              label: roomEntryLabel({
                section: {
                  year: owner.year,
                  name: owner.name,
                  branch: { code: owner.branch.code },
                },
                subject: e.subject,
                entryType: e.entryType,
              }),
              section: {
                id: owner.id,
                name: owner.name,
                year: owner.year,
                branchCode: owner.branch.code,
              },
              subject: e.subject
                ? { id: e.subject.id, code: e.subject.code, name: e.subject.name }
                : null,
              faculty: e.faculty
                ? { id: e.faculty.id, name: e.faculty.name, facultyNo: e.faculty.facultyNo }
                : null,
            }
          }),
      }))
      .filter((r) => includeEmpty || r.entries.length > 0)

    res.json({
      term: { id: term.id, label: term.label },
      version: { id: version.id, kind: version.kind, label: version.label },
      grid: {
        slots: buildDayGrid(cfg),
        endTime: dayEndTime(cfg),
        workingDays: cfg.workingDays,
        numPeriods: cfg.numPeriods,
      },
      rooms: rows,
    })
  })
)
