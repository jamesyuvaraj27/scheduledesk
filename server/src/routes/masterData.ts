import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { asyncHandler, notFound, param } from "../lib/errors.js"

export const masterDataRouter = Router()

/* ---------------- Departments ---------------- */

const departmentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  code: z.string().trim().min(1, "Code is required").toUpperCase(),
})

masterDataRouter.get(
  "/departments",
  asyncHandler(async (_req, res) => {
    const departments = await prisma.department.findMany({
      orderBy: { code: "asc" },
      include: {
        branches: { orderBy: { code: "asc" } },
        _count: { select: { branches: true, faculty: true } },
      },
    })
    res.json(departments)
  })
)

masterDataRouter.post(
  "/departments",
  asyncHandler(async (req, res) => {
    const data = departmentSchema.parse(req.body)
    const department = await prisma.department.create({ data })
    res.status(201).json(department)
  })
)

masterDataRouter.patch(
  "/departments/:id",
  asyncHandler(async (req, res) => {
    const data = departmentSchema.partial().parse(req.body)
    const department = await prisma.department.update({
      where: { id: param(req, "id") },
      data,
    })
    res.json(department)
  })
)

masterDataRouter.delete(
  "/departments/:id",
  asyncHandler(async (req, res) => {
    await prisma.department.delete({ where: { id: param(req, "id") } })
    res.status(204).end()
  })
)

/* ---------------- Branches ---------------- */

const branchSchema = z.object({
  departmentId: z.string().min(1, "Department is required"),
  name: z.string().trim().min(1, "Name is required"),
  code: z.string().trim().min(1, "Code is required").toUpperCase(),
})

masterDataRouter.get(
  "/branches",
  asyncHandler(async (req, res) => {
    const departmentId = z.string().optional().parse(req.query.departmentId)
    const branches = await prisma.branch.findMany({
      where: departmentId ? { departmentId } : undefined,
      orderBy: { code: "asc" },
      include: {
        department: true,
        _count: { select: { sections: true, subjects: true } },
      },
    })
    res.json(branches)
  })
)

masterDataRouter.post(
  "/branches",
  asyncHandler(async (req, res) => {
    const data = branchSchema.parse(req.body)
    const branch = await prisma.branch.create({ data, include: { department: true } })
    res.status(201).json(branch)
  })
)

masterDataRouter.patch(
  "/branches/:id",
  asyncHandler(async (req, res) => {
    const data = branchSchema.partial().parse(req.body)
    const branch = await prisma.branch.update({
      where: { id: param(req, "id") },
      data,
      include: { department: true },
    })
    res.json(branch)
  })
)

masterDataRouter.delete(
  "/branches/:id",
  asyncHandler(async (req, res) => {
    await prisma.branch.delete({ where: { id: param(req, "id") } })
    res.status(204).end()
  })
)

/* ---------------- Sections ---------------- */
/*
 * Every branch has at least one Section row even when it has no real
 * divisions (name is then just the branch code) — see PLAN.md §4d.
 */

const sectionSchema = z.object({
  branchId: z.string().min(1, "Branch is required"),
  year: z.number().int().min(1).max(4),
  name: z.string().trim().min(1, "Name is required").toUpperCase(),
  homeRoomId: z.string().nullish(),
})

masterDataRouter.get(
  "/sections",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        branchId: z.string().optional(),
        departmentId: z.string().optional(),
        year: z.coerce.number().int().min(1).max(4).optional(),
      })
      .parse(req.query)

    const sections = await prisma.section.findMany({
      where: {
        branchId: query.branchId,
        year: query.year,
        // Filtering by department reaches through the branch, so the UI can
        // narrow department -> branch -> section without extra round trips.
        branch: query.departmentId
          ? { departmentId: query.departmentId }
          : undefined,
      },
      orderBy: [{ year: "asc" }, { name: "asc" }],
      include: {
        branch: { include: { department: true } },
        homeRoom: true,
      },
    })
    res.json(sections)
  })
)

masterDataRouter.post(
  "/sections",
  asyncHandler(async (req, res) => {
    const data = sectionSchema.parse(req.body)
    const section = await prisma.section.create({
      data,
      include: { branch: { include: { department: true } }, homeRoom: true },
    })
    res.status(201).json(section)
  })
)

masterDataRouter.patch(
  "/sections/:id",
  asyncHandler(async (req, res) => {
    const data = sectionSchema.partial().parse(req.body)
    const section = await prisma.section.update({
      where: { id: param(req, "id") },
      data,
      include: { branch: { include: { department: true } }, homeRoom: true },
    })
    res.json(section)
  })
)

masterDataRouter.delete(
  "/sections/:id",
  asyncHandler(async (req, res) => {
    await prisma.section.delete({ where: { id: param(req, "id") } })
    res.status(204).end()
  })
)

/* ---------------- Rooms ---------------- */

const ROOM_TYPES = ["CLASSROOM", "LAB", "LIBRARY", "SEMINAR_HALL"] as const
export const BLOCKS = ["A", "L", "V"] as const
export const FLOORS = ["GF", "FF", "SF", "TF", "LF"] as const

const roomSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  type: z.enum(ROOM_TYPES),
  capacity: z.number().int().positive().nullish(),
  block: z.enum(BLOCKS).nullish(),
  floor: z.enum(FLOORS).nullish(),
  // Null means "any year can use this room".
  year: z.number().int().min(1).max(4).nullish(),
})

masterDataRouter.get(
  "/rooms",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        type: z.enum(ROOM_TYPES).optional(),
        block: z.enum(BLOCKS).optional(),
        floor: z.enum(FLOORS).optional(),
        // Rooms reserved for this year, plus rooms open to any year.
        year: z.coerce.number().int().min(1).max(4).optional(),
      })
      .parse(req.query)

    const rooms = await prisma.room.findMany({
      where: {
        type: query.type,
        block: query.block,
        floor: query.floor,
        ...(query.year ? { OR: [{ year: query.year }, { year: null }] } : {}),
      },
      orderBy: [{ block: "asc" }, { floor: "asc" }, { name: "asc" }],
    })
    res.json(rooms)
  })
)

masterDataRouter.post(
  "/rooms",
  asyncHandler(async (req, res) => {
    const data = roomSchema.parse(req.body)
    const room = await prisma.room.create({ data })
    res.status(201).json(room)
  })
)

/**
 * Bulk-create the rooms on one floor of one block.
 *
 * Rooms here are named by position (block A, first floor, room 3 -> "AFF-3"),
 * and a floor can hold a dozen of them, so adding them one at a time is a
 * chore. Names that already exist are skipped rather than failing the whole
 * batch, which makes the endpoint safe to re-run after adding a few rooms.
 */
masterDataRouter.post(
  "/rooms/bulk",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        block: z.enum(BLOCKS),
        floor: z.enum(FLOORS),
        type: z.enum(ROOM_TYPES),
        count: z.number().int().min(1).max(60),
        startNumber: z.number().int().min(1).default(1),
        capacity: z.number().int().positive().nullish(),
        year: z.number().int().min(1).max(4).nullish(),
      })
      .parse(req.body)

    const prefix = `${body.block}${body.floor}`
    const names = Array.from(
      { length: body.count },
      (_, i) => `${prefix}-${body.startNumber + i}`
    )

    const existing = await prisma.room.findMany({
      where: { name: { in: names } },
      select: { name: true },
    })
    const taken = new Set(existing.map((r) => r.name))
    const toCreate = names.filter((n) => !taken.has(n))

    if (toCreate.length > 0) {
      await prisma.room.createMany({
        data: toCreate.map((name) => ({
          name,
          type: body.type,
          capacity: body.capacity ?? null,
          block: body.block,
          floor: body.floor,
          year: body.year ?? null,
        })),
      })
    }

    const rooms = await prisma.room.findMany({
      where: { name: { in: names } },
      orderBy: { name: "asc" },
    })

    res.status(201).json({
      created: toCreate.length,
      skipped: [...taken].sort(),
      rooms,
    })
  })
)

masterDataRouter.patch(
  "/rooms/:id",
  asyncHandler(async (req, res) => {
    const data = roomSchema.partial().parse(req.body)
    const room = await prisma.room.update({ where: { id: param(req, "id") }, data })
    res.json(room)
  })
)

masterDataRouter.delete(
  "/rooms/:id",
  asyncHandler(async (req, res) => {
    await prisma.room.delete({ where: { id: param(req, "id") } })
    res.status(204).end()
  })
)

/* ---------------- Subjects ---------------- */

const subjectSchema = z.object({
  branchId: z.string().min(1, "Branch is required"),
  name: z.string().trim().min(1, "Name is required"),
  code: z.string().trim().min(1, "Code is required").toUpperCase(),
  type: z.enum(["THEORY", "LAB"]),
})

masterDataRouter.get(
  "/subjects",
  asyncHandler(async (req, res) => {
    const branchId = z.string().optional().parse(req.query.branchId)
    const subjects = await prisma.subject.findMany({
      where: branchId ? { branchId } : undefined,
      orderBy: { code: "asc" },
      include: {
        branch: true,
        eligibleFaculty: { include: { faculty: true } },
      },
    })
    res.json(subjects)
  })
)

masterDataRouter.post(
  "/subjects",
  asyncHandler(async (req, res) => {
    const data = subjectSchema.parse(req.body)
    const subject = await prisma.subject.create({ data, include: { branch: true } })
    res.status(201).json(subject)
  })
)

masterDataRouter.patch(
  "/subjects/:id",
  asyncHandler(async (req, res) => {
    const data = subjectSchema.partial().parse(req.body)
    const subject = await prisma.subject.update({
      where: { id: param(req, "id") },
      data,
      include: { branch: true },
    })
    res.json(subject)
  })
)

/**
 * What would deleting this subject take with it?
 *
 * Deleting a subject cascades into faculty eligibility, every section's
 * curriculum, the locked-in faculty assignments and any classes already on a
 * timetable. That's a lot to lose silently, so the UI shows these counts in
 * the confirmation dialog before the delete is allowed through.
 */
masterDataRouter.get(
  "/subjects/:id/delete-impact",
  asyncHandler(async (req, res) => {
    const id = param(req, "id")
    const subject = await prisma.subject.findUnique({
      where: { id },
      include: { branch: true },
    })
    if (!subject) throw notFound("Subject")

    const [eligibleFaculty, curriculumRows, assignments, entries, sections] =
      await Promise.all([
        prisma.facultySubject.count({ where: { subjectId: id } }),
        prisma.sectionSubject.count({ where: { subjectId: id } }),
        prisma.sectionAssignment.count({ where: { subjectId: id } }),
        prisma.timetableEntry.count({ where: { subjectId: id } }),
        prisma.sectionSubject.findMany({
          where: { subjectId: id },
          select: {
            section: {
              select: {
                id: true,
                name: true,
                year: true,
                branch: { select: { code: true } },
              },
            },
          },
        }),
      ])

    res.json({
      subject: { id: subject.id, code: subject.code, name: subject.name },
      eligibleFaculty,
      curriculumRows,
      assignments,
      placedClasses: entries,
      sections: sections.map((r) => ({
        id: r.section.id,
        label: `${r.section.year} yr ${r.section.branch.code} ${r.section.name}`,
      })),
    })
  })
)

/**
 * Deleting a subject removes it everywhere: faculty eligibility, curriculum
 * rows, locked assignments and any classes already placed. The database
 * cascades handle the child rows; assignments are cleared explicitly first so
 * the intent is visible here rather than only in the schema.
 */
masterDataRouter.delete(
  "/subjects/:id",
  asyncHandler(async (req, res) => {
    const id = param(req, "id")

    const removed = await prisma.$transaction(async (tx) => {
      const entries = await tx.timetableEntry.deleteMany({
        where: { subjectId: id },
      })
      const assignments = await tx.sectionAssignment.deleteMany({
        where: { subjectId: id },
      })
      const curriculum = await tx.sectionSubject.deleteMany({
        where: { subjectId: id },
      })
      const eligibility = await tx.facultySubject.deleteMany({
        where: { subjectId: id },
      })
      await tx.subject.delete({ where: { id } })

      return {
        placedClasses: entries.count,
        assignments: assignments.count,
        curriculumRows: curriculum.count,
        eligibleFaculty: eligibility.count,
      }
    })

    res.json(removed)
  })
)

/* ---------------- Faculty ---------------- */

/**
 * Faculty numbers are the thing that tells two people with the same name
 * apart. They are stored uppercase and trimmed so "fac003" and "FAC003 " can
 * never both exist.
 */
const facultySchema = z.object({
  facultyNo: z
    .string()
    .trim()
    .min(1, "Faculty number is required")
    .max(20, "Keep the faculty number short, e.g. FAC003")
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use letters, digits, . _ - / only")
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "Name is required"),
  departmentId: z.string().min(1, "Department is required"),
  isActive: z.boolean().optional(),
})

/**
 * The next free FACnnn, so the office never has to work out what it is.
 * Only the plain FAC-prefixed numbers count towards the sequence — a
 * hand-typed code like "VLITS/CSE/12" is left alone.
 */
async function suggestFacultyNo(): Promise<string> {
  const existing = await prisma.faculty.findMany({ select: { facultyNo: true } })
  let highest = 0
  for (const { facultyNo } of existing) {
    const match = /^FAC(\d+)$/.exec(facultyNo)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `FAC${String(highest + 1).padStart(3, "0")}`
}

masterDataRouter.get(
  "/faculty/next-number",
  asyncHandler(async (_req, res) => {
    res.json({ facultyNo: await suggestFacultyNo() })
  })
)

masterDataRouter.get(
  "/faculty",
  asyncHandler(async (req, res) => {
    const departmentId = z.string().optional().parse(req.query.departmentId)
    const faculty = await prisma.faculty.findMany({
      where: departmentId ? { departmentId } : undefined,
      orderBy: { facultyNo: "asc" },
      include: {
        department: true,
        eligibleSubjects: { include: { subject: true } },
      },
    })
    res.json(faculty)
  })
)

masterDataRouter.post(
  "/faculty",
  asyncHandler(async (req, res) => {
    const data = facultySchema.parse({
      ...req.body,
      facultyNo: req.body?.facultyNo?.trim()
        ? req.body.facultyNo
        : await suggestFacultyNo(),
    })
    const faculty = await prisma.faculty.create({
      data,
      include: { department: true, eligibleSubjects: { include: { subject: true } } },
    })
    res.status(201).json(faculty)
  })
)

masterDataRouter.patch(
  "/faculty/:id",
  asyncHandler(async (req, res) => {
    const data = facultySchema.partial().parse(req.body)
    const faculty = await prisma.faculty.update({
      where: { id: param(req, "id") },
      data,
      include: { department: true, eligibleSubjects: { include: { subject: true } } },
    })
    res.json(faculty)
  })
)

masterDataRouter.delete(
  "/faculty/:id",
  asyncHandler(async (req, res) => {
    await prisma.faculty.delete({ where: { id: param(req, "id") } })
    res.status(204).end()
  })
)

/**
 * Replace a faculty member's eligible-subject list wholesale.
 * Eligibility means "can teach", not "is assigned" — assignment happens
 * per-section during term setup.
 */
masterDataRouter.put(
  "/faculty/:id/subjects",
  asyncHandler(async (req, res) => {
    const { subjectIds } = z
      .object({ subjectIds: z.array(z.string()) })
      .parse(req.body)

    const faculty = await prisma.faculty.findUnique({ where: { id: param(req, "id") } })
    if (!faculty) throw notFound("Faculty")

    const updated = await prisma.$transaction(async (tx) => {
      await tx.facultySubject.deleteMany({ where: { facultyId: param(req, "id") } })
      if (subjectIds.length) {
        await tx.facultySubject.createMany({
          data: subjectIds.map((subjectId) => ({
            facultyId: param(req, "id"),
            subjectId,
          })),
        })
      }
      return tx.faculty.findUnique({
        where: { id: param(req, "id") },
        include: {
          department: true,
          eligibleSubjects: { include: { subject: true } },
        },
      })
    })

    res.json(updated)
  })
)

/* ---------------- Dashboard summary ---------------- */

masterDataRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const [departments, branches, sections, rooms, faculty, subjects, activeTerm] =
      await Promise.all([
        prisma.department.count(),
        prisma.branch.count(),
        prisma.section.count(),
        prisma.room.count(),
        prisma.faculty.count(),
        prisma.subject.count(),
        prisma.academicTerm.findFirst({
          where: { isActive: true },
          include: { timeConfig: true },
        }),
      ])

    const sectionsByYear = await prisma.section.groupBy({
      by: ["year"],
      _count: { _all: true },
      orderBy: { year: "asc" },
    })

    res.json({
      counts: { departments, branches, sections, rooms, faculty, subjects },
      sectionsByYear: sectionsByYear.map((s) => ({
        year: s.year,
        count: s._count._all,
      })),
      activeTerm,
    })
  })
)
