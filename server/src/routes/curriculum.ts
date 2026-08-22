import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { AppError, asyncHandler, notFound, param } from "../lib/errors.js"
import { ACTIVITY_TYPES, ACTIVITY_WEEKLY_HOURS } from "../lib/scheduling.js"

export const curriculumRouter = Router()

/**
 * Phase 2 — what each section studies, and who teaches it.
 *
 *   SectionSubject    : subject + required weekly theory/lab hours
 *   SectionAssignment : which faculty actually teaches that subject here
 *
 * Both are per-term, so a new academic year starts clean without touching
 * master data.
 */

async function requireActiveTerm() {
  const term = await prisma.academicTerm.findFirst({
    where: { isActive: true },
    include: { timeConfig: true },
  })
  if (!term) {
    throw new AppError(
      "No active academic term. Create one in Term Setup first.",
      409
    )
  }
  return term
}

/* ----------------------- Curriculum for one section ---------------------- */

/**
 * Everything the curriculum screen needs for a section in one request:
 * its subjects, required hours, chosen faculty, and who is even eligible.
 */
curriculumRouter.get(
  "/sections/:id/curriculum",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const term = await requireActiveTerm()

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: {
        branch: { include: { department: true } },
        homeRoom: true,
      },
    })
    if (!section) throw notFound("Section")

    const [sectionSubjects, assignments, branchSubjects] = await Promise.all([
      prisma.sectionSubject.findMany({
        where: { termId: term.id, sectionId },
        include: { subject: true },
      }),
      prisma.sectionAssignment.findMany({
        where: { termId: term.id, sectionId },
        include: { faculty: true, subject: true },
      }),
      prisma.subject.findMany({
        where: { branchId: section.branchId },
        orderBy: { code: "asc" },
        include: {
          eligibleFaculty: {
            include: { faculty: { include: { department: true } } },
          },
        },
      }),
    ])

    const assignmentBySubject = new Map(
      assignments.map((a) => [a.subjectId, a])
    )

    // One row per subject in the curriculum, with its faculty and the
    // eligible alternatives, so the UI never has to join this itself.
    const rows = sectionSubjects
      .map((ss) => {
        const subject = branchSubjects.find((s) => s.id === ss.subjectId)
        const assignment = assignmentBySubject.get(ss.subjectId)
        return {
          id: ss.id,
          subject: ss.subject,
          weeklyTheoryHrs: ss.weeklyTheoryHrs,
          weeklyLabHrs: ss.weeklyLabHrs,
          faculty: assignment?.faculty ?? null,
          eligibleFaculty:
            subject?.eligibleFaculty.map((e) => e.faculty) ?? [],
        }
      })
      .sort((a, b) => a.subject.code.localeCompare(b.subject.code))

    const totalWeeklyHours = rows.reduce(
      (sum, r) => sum + r.weeklyTheoryHrs + r.weeklyLabHrs,
      0
    )
    const missingFaculty = rows.filter((r) => !r.faculty).map((r) => r.subject.code)
    const availableSubjects = branchSubjects.filter(
      (s) => !sectionSubjects.some((ss) => ss.subjectId === s.id)
    )

    res.json({
      section,
      term: { id: term.id, label: term.label },
      rows,
      availableSubjects,
      totals: {
        subjects: rows.length,
        weeklyHours: totalWeeklyHours,
        missingFaculty,
        // Library, Seminar, Counseling and Sports are one hour each per week
        // and are placed directly on the grid, not configured as subjects —
        // derived from the engine's own activity list so this can never drift
        // out of step with it.
        weeklyActivityHours: ACTIVITY_TYPES.length * ACTIVITY_WEEKLY_HOURS,
      },
    })
  })
)

const sectionSubjectSchema = z.object({
  subjectId: z.string().min(1, "Subject is required"),
  weeklyTheoryHrs: z.number().int().min(0).max(40),
  weeklyLabHrs: z.number().int().min(0).max(40),
})

curriculumRouter.post(
  "/sections/:id/curriculum",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const term = await requireActiveTerm()
    const data = sectionSubjectSchema.parse(req.body)

    const section = await prisma.section.findUnique({ where: { id: sectionId } })
    if (!section) throw notFound("Section")

    const subject = await prisma.subject.findUnique({
      where: { id: data.subjectId },
    })
    if (!subject) throw notFound("Subject")
    if (subject.branchId !== section.branchId) {
      throw new AppError(
        "That subject belongs to a different branch than this section.",
        422
      )
    }

    // Lab hours are free-form now — a lab block is however many consecutive
    // periods the admin places, so any weekly total is achievable.
    if (data.weeklyTheoryHrs === 0 && data.weeklyLabHrs === 0) {
      throw new AppError("Set at least one theory or lab hour.", 422)
    }

    const created = await prisma.sectionSubject.create({
      data: { ...data, sectionId, termId: term.id },
      include: { subject: true },
    })
    res.status(201).json(created)
  })
)

curriculumRouter.patch(
  "/curriculum/:id",
  asyncHandler(async (req, res) => {
    const data = sectionSubjectSchema
      .omit({ subjectId: true })
      .partial()
      .parse(req.body)

    const updated = await prisma.sectionSubject.update({
      where: { id: param(req, "id") },
      data,
      include: { subject: true },
    })
    res.json(updated)
  })
)

curriculumRouter.delete(
  "/curriculum/:id",
  asyncHandler(async (req, res) => {
    const id = param(req, "id")
    const row = await prisma.sectionSubject.findUnique({ where: { id } })
    if (!row) throw notFound("Curriculum row")

    // Removing a subject from the curriculum also drops its faculty
    // assignment — leaving a dangling assignment would be misleading.
    await prisma.$transaction([
      prisma.sectionAssignment.deleteMany({
        where: {
          termId: row.termId,
          sectionId: row.sectionId,
          subjectId: row.subjectId,
        },
      }),
      prisma.sectionSubject.delete({ where: { id } }),
    ])

    res.status(204).end()
  })
)

/* ------------------------- Faculty for a subject ------------------------- */

curriculumRouter.put(
  "/sections/:id/assignments/:subjectId",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const subjectId = param(req, "subjectId")
    const term = await requireActiveTerm()
    const { facultyId } = z
      .object({ facultyId: z.string().nullable() })
      .parse(req.body)

    // Clearing the assignment
    if (facultyId === null) {
      await prisma.sectionAssignment.deleteMany({
        where: { termId: term.id, sectionId, subjectId },
      })
      return res.json({ facultyId: null })
    }

    const eligible = await prisma.facultySubject.findUnique({
      where: { facultyId_subjectId: { facultyId, subjectId } },
      include: { faculty: true, subject: true },
    })
    if (!eligible) {
      throw new AppError(
        "That faculty member isn't marked as able to teach this subject. Update their eligible subjects in Master Data first.",
        422
      )
    }

    const assignment = await prisma.sectionAssignment.upsert({
      where: {
        termId_sectionId_subjectId: { termId: term.id, sectionId, subjectId },
      },
      create: { termId: term.id, sectionId, subjectId, facultyId },
      update: { facultyId },
      include: { faculty: true, subject: true },
    })

    res.json(assignment)
  })
)

/* --------------------- Setup progress across sections -------------------- */

/**
 * Drives the "which sections are ready to schedule?" view. A section is
 * ready once it has a home room, at least one subject, and a faculty member
 * chosen for every subject.
 */
curriculumRouter.get(
  "/curriculum-status",
  asyncHandler(async (req, res) => {
    const year = z.coerce.number().int().min(1).max(4).optional().parse(req.query.year)
    const term = await prisma.academicTerm.findFirst({ where: { isActive: true } })

    const sections = await prisma.section.findMany({
      where: year ? { year } : undefined,
      orderBy: [{ year: "asc" }, { name: "asc" }],
      include: { branch: { include: { department: true } }, homeRoom: true },
    })

    if (!term) {
      return res.json({
        term: null,
        sections: sections.map((s) => ({
          section: s,
          subjectCount: 0,
          assignedCount: 0,
          weeklyHours: 0,
          ready: false,
        })),
      })
    }

    const [sectionSubjects, assignments] = await Promise.all([
      prisma.sectionSubject.findMany({ where: { termId: term.id } }),
      prisma.sectionAssignment.findMany({ where: { termId: term.id } }),
    ])

    res.json({
      term: { id: term.id, label: term.label },
      sections: sections.map((s) => {
        const subs = sectionSubjects.filter((ss) => ss.sectionId === s.id)
        const assigned = assignments.filter((a) => a.sectionId === s.id)
        const weeklyHours = subs.reduce(
          (sum, ss) => sum + ss.weeklyTheoryHrs + ss.weeklyLabHrs,
          0
        )
        return {
          section: s,
          subjectCount: subs.length,
          assignedCount: assigned.length,
          weeklyHours,
          ready:
            subs.length > 0 &&
            assigned.length === subs.length &&
            Boolean(s.homeRoomId),
        }
      }),
    })
  })
)

/* --------------------------- Faculty workload ---------------------------- */

/**
 * How loaded each faculty member already is, from their curriculum
 * assignments. Used to warn before a section piles more onto someone.
 */
curriculumRouter.get(
  "/faculty-workload",
  asyncHandler(async (_req, res) => {
    const term = await prisma.academicTerm.findFirst({ where: { isActive: true } })
    if (!term) return res.json({ term: null, faculty: [] })

    const [faculty, assignments, sectionSubjects] = await Promise.all([
      prisma.faculty.findMany({
        orderBy: { name: "asc" },
        include: { department: true },
      }),
      prisma.sectionAssignment.findMany({
        where: { termId: term.id },
        include: {
          subject: true,
          section: { include: { branch: true } },
        },
      }),
      prisma.sectionSubject.findMany({ where: { termId: term.id } }),
    ])

    const hoursFor = (sectionId: string, subjectId: string) => {
      const ss = sectionSubjects.find(
        (x) => x.sectionId === sectionId && x.subjectId === subjectId
      )
      return (ss?.weeklyTheoryHrs ?? 0) + (ss?.weeklyLabHrs ?? 0)
    }

    res.json({
      term: { id: term.id, label: term.label },
      faculty: faculty.map((f) => {
        const mine = assignments.filter((a) => a.facultyId === f.id)
        return {
          faculty: f,
          weeklyHours: mine.reduce(
            (sum, a) => sum + hoursFor(a.sectionId, a.subjectId),
            0
          ),
          assignments: mine.map((a) => ({
            subject: a.subject.code,
            section: `${a.section.branch.code}-${a.section.name}`,
            year: a.section.year,
            hours: hoursFor(a.sectionId, a.subjectId),
          })),
        }
      }),
    })
  })
)
