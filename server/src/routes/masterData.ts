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
        year: z.coerce.number().int().min(1).max(4).optional(),
      })
      .parse(req.query)

    const sections = await prisma.section.findMany({
      where: {
        branchId: query.branchId,
        year: query.year,
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

const roomSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  type: z.enum(["CLASSROOM", "LAB", "LIBRARY", "SEMINAR_HALL"]),
  capacity: z.number().int().positive().nullish(),
})

masterDataRouter.get(
  "/rooms",
  asyncHandler(async (req, res) => {
    const type = z
      .enum(["CLASSROOM", "LAB", "LIBRARY", "SEMINAR_HALL"])
      .optional()
      .parse(req.query.type)
    const rooms = await prisma.room.findMany({
      where: type ? { type } : undefined,
      orderBy: [{ type: "asc" }, { name: "asc" }],
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

masterDataRouter.delete(
  "/subjects/:id",
  asyncHandler(async (req, res) => {
    await prisma.subject.delete({ where: { id: param(req, "id") } })
    res.status(204).end()
  })
)

/* ---------------- Faculty ---------------- */

const facultySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  departmentId: z.string().min(1, "Department is required"),
  isActive: z.boolean().optional(),
})

masterDataRouter.get(
  "/faculty",
  asyncHandler(async (req, res) => {
    const departmentId = z.string().optional().parse(req.query.departmentId)
    const faculty = await prisma.faculty.findMany({
      where: departmentId ? { departmentId } : undefined,
      orderBy: { name: "asc" },
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
    const data = facultySchema.parse(req.body)
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
