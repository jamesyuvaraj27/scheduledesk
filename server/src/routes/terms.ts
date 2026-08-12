import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { AppError, asyncHandler, notFound, param } from "../lib/errors.js"
import { buildDayGrid, dayEndTime, validLabStartPeriods } from "../lib/periods.js"

export const termsRouter = Router()

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const

const timeConfigSchema = z.object({
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, e.g. 08:00"),
  numPeriods: z.number().int().min(1).max(12),
  periodDurationMin: z.number().int().min(20).max(120),
  breakAfterPeriod: z.number().int().min(0),
  breakDurationMin: z.number().int().min(0).max(120),
  lunchAfterPeriod: z.number().int().min(0),
  lunchDurationMin: z.number().int().min(0).max(180),
  workingDays: z.array(z.enum(DAYS)).min(1, "At least one working day"),
})

const termSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  semester: z.number().int().min(1).max(2),
  label: z.string().trim().min(1, "Label is required"),
})

type TimeConfigShape = Parameters<typeof buildDayGrid>[0]

/** Attach the computed grid so the client never re-implements this logic. */
function withGrid<T extends { timeConfig?: TimeConfigShape | null }>(term: T) {
  const cfg = term.timeConfig
  if (!cfg) return { ...term, grid: null }
  return {
    ...term,
    grid: {
      slots: buildDayGrid(cfg),
      endTime: dayEndTime(cfg),
      validLabStartPeriods: validLabStartPeriods(cfg),
    },
  }
}

termsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const terms = await prisma.academicTerm.findMany({
      orderBy: [{ year: "desc" }, { semester: "desc" }],
      include: {
        timeConfig: true,
        _count: {
          select: {
            timetableEntries: true,
            sectionAssignments: true,
            sectionSubjects: true,
          },
        },
      },
    })
    res.json(terms.map(withGrid))
  })
)

termsRouter.get(
  "/active",
  asyncHandler(async (_req, res) => {
    const term = await prisma.academicTerm.findFirst({
      where: { isActive: true },
      include: { timeConfig: true },
    })
    res.json(term ? withGrid(term) : null)
  })
)

/**
 * Creating a term also creates its TimeConfig, defaulted to the college's
 * standard 8:00-3:00 / 50-minute day. Everything stays editable afterwards.
 */
termsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = termSchema
      .extend({
        makeActive: z.boolean().optional(),
        timeConfig: timeConfigSchema.partial().optional(),
      })
      .parse(req.body)

    const term = await prisma.$transaction(async (tx) => {
      if (body.makeActive) {
        await tx.academicTerm.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        })
      }

      return tx.academicTerm.create({
        data: {
          year: body.year,
          semester: body.semester,
          label: body.label,
          isActive: body.makeActive ?? false,
          timeConfig: {
            create: {
              startTime: body.timeConfig?.startTime ?? "08:00",
              numPeriods: body.timeConfig?.numPeriods ?? 7,
              periodDurationMin: body.timeConfig?.periodDurationMin ?? 50,
              breakAfterPeriod: body.timeConfig?.breakAfterPeriod ?? 2,
              breakDurationMin: body.timeConfig?.breakDurationMin ?? 20,
              lunchAfterPeriod: body.timeConfig?.lunchAfterPeriod ?? 5,
              lunchDurationMin: body.timeConfig?.lunchDurationMin ?? 50,
              workingDays: body.timeConfig?.workingDays ?? [
                "MON",
                "TUE",
                "WED",
                "THU",
                "FRI",
                "SAT",
              ],
            },
          },
        },
        include: { timeConfig: true },
      })
    })

    res.status(201).json(withGrid(term))
  })
)

/**
 * Delete a term outright — for one created by mistake, not for rolling the
 * year. The active term is protected, since removing what the app is
 * currently looking at would leave it in a confusing state.
 */
termsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = param(req, "id")
    const term = await prisma.academicTerm.findUnique({ where: { id } })
    if (!term) throw notFound("Term")

    if (term.isActive) {
      throw new AppError(
        "This is the active term. Make another term active first, then delete this one.",
        409
      )
    }

    await prisma.$transaction([
      prisma.timetableEntry.deleteMany({ where: { termId: id } }),
      prisma.sectionAssignment.deleteMany({ where: { termId: id } }),
      prisma.sectionSubject.deleteMany({ where: { termId: id } }),
      prisma.timeConfig.deleteMany({ where: { termId: id } }),
      prisma.academicTerm.delete({ where: { id } }),
    ])

    res.status(204).end()
  })
)

termsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = termSchema.partial().parse(req.body)
    const term = await prisma.academicTerm.update({
      where: { id: param(req, "id") },
      data,
      include: { timeConfig: true },
    })
    res.json(withGrid(term))
  })
)

/** Exactly one term is active at a time. */
termsRouter.post(
  "/:id/activate",
  asyncHandler(async (req, res) => {
    const term = await prisma.$transaction(async (tx) => {
      await tx.academicTerm.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      })
      return tx.academicTerm.update({
        where: { id: param(req, "id") },
        data: { isActive: true },
        include: { timeConfig: true },
      })
    })
    res.json(withGrid(term))
  })
)

termsRouter.get(
  "/:id/time-config",
  asyncHandler(async (req, res) => {
    const cfg = await prisma.timeConfig.findUnique({
      where: { termId: param(req, "id") },
    })
    if (!cfg) throw notFound("Time config")
    res.json({
      ...cfg,
      grid: buildDayGrid(cfg),
      endTime: dayEndTime(cfg),
      validLabStartPeriods: validLabStartPeriods(cfg),
    })
  })
)

termsRouter.put(
  "/:id/time-config",
  asyncHandler(async (req, res) => {
    const data = timeConfigSchema.parse(req.body)
    const cfg = await prisma.timeConfig.update({
      where: { termId: param(req, "id") },
      data,
    })
    res.json({
      ...cfg,
      grid: buildDayGrid(cfg),
      endTime: dayEndTime(cfg),
      validLabStartPeriods: validLabStartPeriods(cfg),
    })
  })
)

/**
 * Preview a period grid without saving — powers the live preview in the
 * time-config editor.
 */
termsRouter.post(
  "/preview-grid",
  asyncHandler(async (req, res) => {
    const cfg = timeConfigSchema.omit({ workingDays: true }).parse(req.body)
    res.json({
      slots: buildDayGrid(cfg),
      endTime: dayEndTime(cfg),
      validLabStartPeriods: validLabStartPeriods(cfg),
    })
  })
)

/**
 * What a reset would do, before doing it.
 *
 * Rolling the year is the one action that changes what the whole app is
 * looking at, so it shows its working first: what carries over untouched,
 * what stays behind as history, and what starts empty.
 */
termsRouter.get(
  "/reset-preview",
  asyncHandler(async (_req, res) => {
    const current = await prisma.academicTerm.findFirst({
      where: { isActive: true },
      include: { timeConfig: true },
    })

    const [departments, branches, sections, rooms, faculty, subjects] =
      await Promise.all([
        prisma.department.count(),
        prisma.branch.count(),
        prisma.section.count(),
        prisma.room.count(),
        prisma.faculty.count(),
        prisma.subject.count(),
      ])

    const currentContents = current
      ? {
          entries: await prisma.timetableEntry.count({ where: { termId: current.id } }),
          curriculumRows: await prisma.sectionSubject.count({
            where: { termId: current.id },
          }),
          assignments: await prisma.sectionAssignment.count({
            where: { termId: current.id },
          }),
        }
      : { entries: 0, curriculumRows: 0, assignments: 0 };

    res.json({
      currentTerm: current ? withGrid(current) : null,
      // Master data is never touched by a reset.
      preserved: { departments, branches, sections, rooms, faculty, subjects },
      // These belong to the term, so they stay with it as history.
      archived: currentContents,
      suggestion: current
        ? {
            year: current.semester === 1 ? current.year : current.year + 1,
            semester: current.semester === 1 ? 2 : 1,
          }
        : { year: new Date().getFullYear(), semester: 1 },
    })
  })
)

/**
 * "Reset Academic Year" — see PLAN.md §4b. Rather than destroying rows we
 * create a NEW term and activate it, so previous years stay queryable as
 * history while master data (faculty, rooms, branches) is untouched.
 */
termsRouter.post(
  "/reset",
  asyncHandler(async (req, res) => {
    const body = termSchema
      .extend({
        copyTimeConfigFromTermId: z.string().optional(),
        /**
         * Carry the subject list and weekly hours into the new term. The
         * syllabus usually stays put while the faculty teaching it changes,
         * so this saves re-entering every section — faculty assignments are
         * deliberately NOT copied.
         */
        copyCurriculumFromTermId: z.string().optional(),
      })
      .parse(req.body)

    const source = body.copyTimeConfigFromTermId
      ? await prisma.timeConfig.findUnique({
          where: { termId: body.copyTimeConfigFromTermId },
        })
      : null

    const term = await prisma.$transaction(async (tx) => {
      await tx.academicTerm.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      })
      return tx.academicTerm.create({
        data: {
          year: body.year,
          semester: body.semester,
          label: body.label,
          isActive: true,
          timeConfig: {
            create: {
              startTime: source?.startTime ?? "08:00",
              numPeriods: source?.numPeriods ?? 7,
              periodDurationMin: source?.periodDurationMin ?? 50,
              breakAfterPeriod: source?.breakAfterPeriod ?? 2,
              breakDurationMin: source?.breakDurationMin ?? 20,
              lunchAfterPeriod: source?.lunchAfterPeriod ?? 5,
              lunchDurationMin: source?.lunchDurationMin ?? 50,
              workingDays: source?.workingDays ?? [
                "MON",
                "TUE",
                "WED",
                "THU",
                "FRI",
                "SAT",
              ],
            },
          },
        },
        include: { timeConfig: true },
      })
    })

    let copiedCurriculumRows = 0
    if (body.copyCurriculumFromTermId) {
      const previous = await prisma.sectionSubject.findMany({
        where: { termId: body.copyCurriculumFromTermId },
      })
      if (previous.length) {
        const result = await prisma.sectionSubject.createMany({
          data: previous.map((row) => ({
            termId: term.id,
            sectionId: row.sectionId,
            subjectId: row.subjectId,
            weeklyTheoryHrs: row.weeklyTheoryHrs,
            weeklyLabHrs: row.weeklyLabHrs,
          })),
          skipDuplicates: true,
        })
        copiedCurriculumRows = result.count
      }
    }

    res.status(201).json({ ...withGrid(term), copiedCurriculumRows })
  })
)
