import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { AppError, asyncHandler, notFound, param } from "../lib/errors.js"
import {
  assertEditable,
  resolveVersion,
  versionSpecFromRequest,
} from "../lib/versions.js"
import { buildDayGrid } from "../lib/periods.js"
import { parseTimetableSheet, normalizeCode } from "../lib/importer.js"
import { validatePlacement, type Day, type EntryType } from "../lib/scheduling.js"

export const importRouter = Router()

/**
 * Importing an existing timetable sheet.
 *
 * Two steps on purpose. `preview` reads the sheet and reports exactly what
 * it found and what it couldn't match, changing nothing. `commit` then does
 * the work — and still runs every single placement through the same conflict
 * engine the manual builder uses, so an import can't sneak in a clash.
 */

const gridSchema = z.object({
  rows: z.array(z.array(z.string())).min(1, "The sheet appears to be empty"),
})

async function loadTermAndSection(sectionId: string) {
  const term = await prisma.academicTerm.findFirst({
    where: { isActive: true },
    include: { timeConfig: true },
  })
  if (!term?.timeConfig) {
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

  return { term, section, timeConfig: term.timeConfig }
}

/* -------------------------------- Preview -------------------------------- */

importRouter.post(
  "/sections/:id/import/preview",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const { rows } = gridSchema.parse(req.body)
    const { term, section, timeConfig } = await loadTermAndSection(sectionId)
    const version = await resolveVersion(term.id, versionSpecFromRequest(req))

    const slots = buildDayGrid(timeConfig)
    const parsed = parseTimetableSheet(rows, slots, timeConfig.numPeriods)

    if (parsed.error) {
      return res.status(422).json({ error: parsed.error })
    }

    const [subjects, faculty, existing] = await Promise.all([
      prisma.subject.findMany({ where: { branchId: section.branchId } }),
      prisma.faculty.findMany(),
      prisma.timetableEntry.count({ where: { versionId: version.id, sectionId } }),
    ])

    const subjectByCode = new Map(subjects.map((s) => [s.code.toUpperCase(), s]))
    const facultyByName = new Map(
      faculty.map((f) => [f.name.trim().toLowerCase(), f])
    )
    const legendByCode = new Map(parsed.legend.map((l) => [l.code, l.facultyName]))

    // One row per distinct code: what it is, who teaches it, what's missing.
    const codeReport = parsed.codes.map((code) => {
      const subject = subjectByCode.get(code)
      const facultyName = legendByCode.get(code) ?? null
      const matchedFaculty = facultyName
        ? (facultyByName.get(facultyName.trim().toLowerCase()) ?? null)
        : null

      const isLab = parsed.entries.some((e) => e.code === code && e.looksLikeLab)
      const theoryHours = parsed.entries
        .filter((e) => e.code === code && !e.looksLikeLab)
        .reduce((n, e) => n + e.periodSpan, 0)
      const labHours = parsed.entries
        .filter((e) => e.code === code && e.looksLikeLab)
        .reduce((n, e) => n + e.periodSpan, 0)

      return {
        code,
        subjectId: subject?.id ?? null,
        subjectName: subject?.name ?? null,
        willCreateSubject: !subject,
        type: isLab ? ("LAB" as const) : ("THEORY" as const),
        facultyName,
        facultyId: matchedFaculty?.id ?? null,
        willCreateFaculty: Boolean(facultyName) && !matchedFaculty,
        missingFaculty: !facultyName,
        weeklyTheoryHrs: theoryHours,
        weeklyLabHrs: labHours,
      }
    })

    res.json({
      section,
      term: { id: term.id, label: term.label },
      entries: parsed.entries,
      codes: codeReport,
      warnings: parsed.warnings,
      existingEntryCount: existing,
      summary: {
        days: [...new Set(parsed.entries.map((e) => e.dayOfWeek))].length,
        entries: parsed.entries.length,
        periods: parsed.entries.reduce((n, e) => n + e.periodSpan, 0),
        needsSubjects: codeReport.filter((c) => c.willCreateSubject).length,
        needsFaculty: codeReport.filter((c) => c.willCreateFaculty).length,
        unknownFaculty: codeReport.filter((c) => c.missingFaculty).length,
      },
    })
  })
)

/* -------------------------------- Commit --------------------------------- */

const commitSchema = gridSchema.extend({
  /** Replace whatever is already on this section's timetable. */
  replaceExisting: z.boolean().default(false),
  /** Create subjects and faculty the sheet mentions but the app doesn't have. */
  createMissing: z.boolean().default(true),
  /** Per-code overrides from the preview screen. */
  overrides: z
    .array(
      z.object({
        code: z.string(),
        subjectId: z.string().nullish(),
        facultyId: z.string().nullish(),
        type: z.enum(["THEORY", "LAB"]).optional(),
        skip: z.boolean().optional(),
      })
    )
    .default([]),
})

importRouter.post(
  "/sections/:id/import/commit",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const body = commitSchema.parse(req.body)
    const { term, section, timeConfig } = await loadTermAndSection(sectionId)

    // Imports write into whichever timetable version the admin is editing —
    // and are refused outright if that version is locked.
    const version = await resolveVersion(term.id, versionSpecFromRequest(req))
    await assertEditable(version)

    const slots = buildDayGrid(timeConfig)
    const parsed = parseTimetableSheet(body.rows, slots, timeConfig.numPeriods)
    if (parsed.error) throw new AppError(parsed.error, 422)

    const overrides = new Map(
      body.overrides.map((o) => [normalizeCode(o.code), o])
    )

    const created = { subjects: 0, faculty: 0, entries: 0 }
    const skipped: { code: string; reason: string }[] = []

    /* --- 1. make sure every code has a subject and a faculty member --- */

    const subjectIdByCode = new Map<string, string>()
    const facultyIdByCode = new Map<string, string>()

    for (const code of parsed.codes) {
      const override = overrides.get(code)
      if (override?.skip) {
        skipped.push({ code, reason: "skipped in preview" })
        continue
      }

      const isLab =
        override?.type === "LAB" ||
        (override?.type !== "THEORY" &&
          parsed.entries.some((e) => e.code === code && e.looksLikeLab))

      // Subject
      let subjectId = override?.subjectId ?? null
      if (!subjectId) {
        const existing = await prisma.subject.findFirst({
          where: { branchId: section.branchId, code: { equals: code, mode: "insensitive" } },
        })
        if (existing) {
          subjectId = existing.id
        } else if (body.createMissing) {
          const madeSubject = await prisma.subject.create({
            data: {
              branchId: section.branchId,
              code,
              name: code,
              type: isLab ? "LAB" : "THEORY",
            },
          })
          subjectId = madeSubject.id
          created.subjects++
        } else {
          skipped.push({ code, reason: "no matching subject" })
          continue
        }
      }
      subjectIdByCode.set(code, subjectId)

      // Faculty
      let facultyId = override?.facultyId ?? null
      const legendName = parsed.legend.find((l) => l.code === code)?.facultyName
      if (!facultyId && legendName) {
        const existing = await prisma.faculty.findFirst({
          where: { name: { equals: legendName.trim(), mode: "insensitive" } },
        })
        if (existing) {
          facultyId = existing.id
        } else if (body.createMissing) {
          // A faculty member invented from a sheet legend still gets a real
          // unique number, so they are a proper master-data record rather than
          // a name floating in a timetable.
          const madeFaculty = await prisma.faculty.create({
            data: {
              facultyNo: await nextFacultyNo(),
              name: legendName.trim(),
              departmentId: section.branch.departmentId,
            },
          })
          facultyId = madeFaculty.id
          created.faculty++
        }
      }

      if (!facultyId) {
        skipped.push({ code, reason: "no faculty in the sheet's legend" })
        continue
      }
      facultyIdByCode.set(code, facultyId)

      // Eligibility + curriculum + assignment, all idempotent.
      await prisma.facultySubject.upsert({
        where: { facultyId_subjectId: { facultyId, subjectId } },
        create: { facultyId, subjectId },
        update: {},
      })

      const theory = parsed.entries
        .filter((e) => e.code === code && !e.looksLikeLab)
        .reduce((n, e) => n + e.periodSpan, 0)
      const lab = parsed.entries
        .filter((e) => e.code === code && e.looksLikeLab)
        .reduce((n, e) => n + e.periodSpan, 0)

      await prisma.sectionSubject.upsert({
        where: {
          termId_sectionId_subjectId: { termId: term.id, sectionId, subjectId },
        },
        create: {
          termId: term.id,
          sectionId,
          subjectId,
          weeklyTheoryHrs: theory,
          weeklyLabHrs: lab,
        },
        update: { weeklyTheoryHrs: theory, weeklyLabHrs: lab },
      })

      await prisma.sectionAssignment.upsert({
        where: {
          termId_sectionId_subjectId: { termId: term.id, sectionId, subjectId },
        },
        create: { termId: term.id, sectionId, subjectId, facultyId },
        update: { facultyId },
      })
    }

    /* --- 2. clear existing entries if asked --- */

    if (body.replaceExisting) {
      await prisma.timetableEntry.deleteMany({
        where: { versionId: version.id, sectionId },
      })
    }

    /* --- 3. place entries, each one checked by the conflict engine --- */

    const labRoom = await prisma.room.findFirst({ where: { type: "LAB" } })
    const rejected: { dayOfWeek: string; startPeriod: number; code: string; reason: string }[] = []

    // Load the scheduling context ONCE, then keep it current in memory as we
    // go. Re-reading it per entry would mean hundreds of round-trips for a
    // single sheet.
    const ctx = await buildContext(term.id, version.id, sectionId)

    for (const entry of parsed.entries) {
      const subjectId = subjectIdByCode.get(entry.code)
      const facultyId = facultyIdByCode.get(entry.code)
      if (!subjectId || !facultyId) continue

      const entryType: EntryType = entry.periodSpan > 1 || entry.looksLikeLab ? "LAB" : "THEORY"
      const roomId = entryType === "LAB" ? (labRoom?.id ?? null) : section.homeRoomId

      const placement = {
        sectionId,
        dayOfWeek: entry.dayOfWeek as Day,
        startPeriod: entry.startPeriod,
        periodSpan: entry.periodSpan,
        entryType,
        subjectId,
        facultyId,
        roomId,
      }

      const conflicts = validatePlacement(placement, ctx)
      if (conflicts.length) {
        rejected.push({
          dayOfWeek: entry.dayOfWeek,
          startPeriod: entry.startPeriod,
          code: entry.code,
          reason: conflicts[0].message,
        })
        continue
      }

      const saved = await prisma.timetableEntry.create({
        data: { termId: term.id, versionId: version.id, ...placement },
      })
      created.entries++

      // Keep the in-memory context in step so the next entry is checked
      // against this one too.
      ctx.entries.push({ id: saved.id, ...placement })
    }

    res.json({
      created,
      skipped,
      rejected,
      warnings: parsed.warnings,
      imported: created.entries,
      total: parsed.entries.length,
    })
  })
)

/** The next free FACnnn — same rule the Faculty master data screen uses. */
async function nextFacultyNo(): Promise<string> {
  const existing = await prisma.faculty.findMany({ select: { facultyNo: true } })
  let highest = 0
  for (const { facultyNo } of existing) {
    const match = /^FAC(\d+)$/.exec(facultyNo)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `FAC${String(highest + 1).padStart(3, "0")}`
}

/** Minimal scheduling context for import-time validation. */
async function buildContext(termId: string, versionId: string, sectionId: string) {
  const [entries, sectionSubjects, assignments, rooms, faculty, sections] =
    await Promise.all([
      prisma.timetableEntry.findMany({ where: { versionId } }),
      prisma.sectionSubject.findMany({
        where: { termId, sectionId },
        include: { subject: true },
      }),
      prisma.sectionAssignment.findMany({ where: { termId, sectionId } }),
      prisma.room.findMany(),
      prisma.faculty.findMany(),
      prisma.section.findMany({ include: { branch: true } }),
    ])

  return {
    timeConfig: (await prisma.timeConfig.findFirstOrThrow({ where: { termId } })),
    entries: entries.map((e) => ({
      id: e.id,
      sectionId: e.sectionId,
      dayOfWeek: e.dayOfWeek as Day,
      startPeriod: e.startPeriod,
      periodSpan: e.periodSpan,
      entryType: e.entryType as EntryType,
      subjectId: e.subjectId,
      facultyId: e.facultyId,
      roomId: e.roomId,
    })),
    curriculum: sectionSubjects.map((ss) => ({
      subjectId: ss.subjectId,
      subjectCode: ss.subject.code,
      weeklyTheoryHrs: ss.weeklyTheoryHrs,
      weeklyLabHrs: ss.weeklyLabHrs,
    })),
    assignments: new Map(assignments.map((a) => [a.subjectId, a.facultyId])),
    rooms: new Map(
      rooms.map((r) => [r.id, { id: r.id, name: r.name, type: r.type as "CLASSROOM" | "LAB" | "LIBRARY" | "SEMINAR_HALL" }])
    ),
    names: {
      faculty: new Map(faculty.map((f) => [f.id, f.name])),
      sections: new Map(
        sections.map((s) => [s.id, `${s.branch.code}-${s.name} (Yr ${s.year})`])
      ),
    },
  }
}
