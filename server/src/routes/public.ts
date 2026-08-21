/**
 * The public side of ScheduleDesk.
 *
 * Everything here is read-only and needs no login: the student/faculty
 * timetable view, the day-wise section report, and the class-adjustment
 * lookup a faculty member uses when they are going on leave.
 *
 * Two rules hold for every route in this file:
 *
 *   1. It only ever reads the LIVE timetable. While the office is preparing
 *      next week on a working copy, nothing here changes.
 *   2. It never writes. There is no POST/PATCH/PUT/DELETE in this router at
 *      all, and it is mounted before the admin gate, so a public visitor
 *      cannot reach an admin route by guessing a URL.
 */

import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { AppError, asyncHandler, notFound, param } from "../lib/errors.js"
import { buildDayGrid, dayEndTime } from "../lib/periods.js"
import { ensureLiveVersion } from "../lib/versions.js"

export const publicRouter = Router()

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const
const ROMAN = ["", "I", "II", "III", "IV"]

const DAY_LABELS: Record<string, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
}

/** Refuse anything that isn't a plain read, belt-and-braces. */
publicRouter.use((req, _res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return next(new AppError("The public timetable pages are read-only.", 405))
  }
  next()
})

/** The active term, its timings, and the version students should see. */
async function liveContext() {
  const term = await prisma.academicTerm.findFirst({
    where: { isActive: true },
    include: { timeConfig: true },
  })
  if (!term || !term.timeConfig) {
    throw new AppError(
      "No timetable has been published yet. Please check back later.",
      409
    )
  }
  const live = await ensureLiveVersion(prisma, term.id)
  return { term, cfg: term.timeConfig, live }
}

function sectionLabel(s: {
  year: number
  name: string
  branch: { code: string }
}): string {
  return `${ROMAN[s.year] ?? s.year} ${s.branch.code}-${s.name}`
}

function facultyLabel(f: { facultyNo: string; name: string } | null): string | null {
  return f ? `${f.facultyNo} — ${f.name}` : null
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase()
}

/* -------------------------------------------------------------------------- */
/*                          What can I choose from?                           */
/* -------------------------------------------------------------------------- */

publicRouter.get(
  "/meta",
  asyncHandler(async (_req, res) => {
    const { term, cfg, live } = await liveContext()

    const sections = await prisma.section.findMany({
      orderBy: [{ year: "asc" }, { name: "asc" }],
      include: { branch: true },
    })

    const years = [...new Set(sections.map((s) => s.year))]
      .sort((a, b) => a - b)
      .map((year) => ({
        year,
        roman: ROMAN[year] ?? String(year),
        sections: sections
          .filter((s) => s.year === year)
          .map((s) => ({
            id: s.id,
            name: s.name,
            branchCode: s.branch.code,
            branchName: s.branch.name,
            label: sectionLabel(s),
          })),
      }))

    res.json({
      term: { id: term.id, label: term.label },
      published: { label: live.label, publishedAt: live.publishedAt ?? null },
      grid: {
        slots: buildDayGrid(cfg),
        endTime: dayEndTime(cfg),
        workingDays: cfg.workingDays,
        numPeriods: cfg.numPeriods,
      },
      days: (cfg.workingDays as string[]).map((d) => ({
        value: d,
        label: DAY_LABELS[d] ?? d,
      })),
      years,
    })
  })
)

/* -------------------------------------------------------------------------- */
/*                          Student timetable view                            */
/* -------------------------------------------------------------------------- */

publicRouter.get(
  "/sections/:id/timetable",
  asyncHandler(async (req, res) => {
    const sectionId = param(req, "id")
    const { term, cfg, live } = await liveContext()

    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { branch: { include: { department: true } }, homeRoom: true },
    })
    if (!section) throw notFound("Section")

    const entries = await prisma.timetableEntry.findMany({
      where: { versionId: live.id, sectionId },
      include: { subject: true, faculty: true, room: true },
      orderBy: [{ dayOfWeek: "asc" }, { startPeriod: "asc" }],
    })

    // The subject -> faculty key printed under the grid. Built from what is
    // actually on the timetable rather than from the curriculum, so it can
    // never list a subject the section isn't being taught.
    const legendMap = new Map<
      string,
      { code: string; facultyName: string | null; facultyNo: string | null }
    >()
    for (const e of entries) {
      const code =
        e.subject?.code ??
        (e.entryType === "THEORY" || e.entryType === "LAB"
          ? null
          : titleCase(e.entryType))
      if (!code || legendMap.has(code)) continue
      legendMap.set(code, {
        code,
        facultyName: e.faculty?.name ?? null,
        facultyNo: e.faculty?.facultyNo ?? null,
      })
    }
    const legend = [...legendMap.values()]
      .filter((l) => l.facultyName)
      .sort((a, b) => a.code.localeCompare(b.code))

    res.json({
      term: { id: term.id, label: term.label },
      published: { label: live.label, publishedAt: live.publishedAt ?? null },
      section: {
        id: section.id,
        name: section.name,
        year: section.year,
        label: sectionLabel(section),
        branchCode: section.branch.code,
        branchName: section.branch.name,
        departmentCode: section.branch.department.code,
        homeRoom: section.homeRoom?.name ?? null,
      },
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
        subject: e.subject
          ? { id: e.subject.id, code: e.subject.code, name: e.subject.name }
          : null,
        faculty: e.faculty
          ? {
              id: e.faculty.id,
              facultyNo: e.faculty.facultyNo,
              name: e.faculty.name,
              label: facultyLabel(e.faculty),
            }
          : null,
        room: e.room ? { id: e.room.id, name: e.room.name } : null,
      })),
      legend,
    })
  })
)

/* -------------------------------------------------------------------------- */
/*                    Day-wise section report (all sections)                  */
/* -------------------------------------------------------------------------- */

/**
 * Every section's timetable for the LIVE version, in one response. This is
 * the public counterpart of the admin Print-all page's data
 * (GET /api/print/sections in overview.ts) — no admin gate, always LIVE, no
 * version override — so a student, faculty member, or coordinator can pick a
 * day/year and one or more sections without signing in. The page filters
 * this down to just the sections that were checked; nothing here is written
 * or changed.
 */
publicRouter.get(
  "/day-wise-report",
  asyncHandler(async (_req, res) => {
    const { term, cfg, live } = await liveContext()

    const [sections, entries] = await Promise.all([
      prisma.section.findMany({
        orderBy: [{ year: "asc" }, { name: "asc" }],
        include: { branch: { include: { department: true } }, homeRoom: true },
      }),
      prisma.timetableEntry.findMany({
        where: { versionId: live.id },
        include: { subject: true, faculty: true, room: true },
        orderBy: [{ dayOfWeek: "asc" }, { startPeriod: "asc" }],
      }),
    ])

    res.json({
      term: { id: term.id, label: term.label },
      published: { label: live.label, publishedAt: live.publishedAt ?? null },
      grid: {
        slots: buildDayGrid(cfg),
        endTime: dayEndTime(cfg),
        workingDays: cfg.workingDays,
        numPeriods: cfg.numPeriods,
      },
      sections: sections.map((section) => ({
        section: {
          id: section.id,
          name: section.name,
          year: section.year,
          label: sectionLabel(section),
          branch: { code: section.branch.code, name: section.branch.name },
          department: { code: section.branch.department.code },
          homeRoom: section.homeRoom
            ? { id: section.homeRoom.id, name: section.homeRoom.name }
            : null,
        },
        entries: entries
          .filter((e) => e.sectionId === section.id)
          .map((e) => ({
            id: e.id,
            dayOfWeek: e.dayOfWeek,
            startPeriod: e.startPeriod,
            periodSpan: e.periodSpan,
            entryType: e.entryType,
            subject: e.subject
              ? { id: e.subject.id, code: e.subject.code, name: e.subject.name }
              : null,
            faculty: e.faculty
              ? {
                  id: e.faculty.id,
                  facultyNo: e.faculty.facultyNo,
                  name: e.faculty.name,
                  label: facultyLabel(e.faculty),
                }
              : null,
            room: e.room ? { id: e.room.id, name: e.room.name } : null,
          })),
      })),
    })
  })
)

/* -------------------------------------------------------------------------- */
/*                     Class adjustment (faculty on leave)                    */
/* -------------------------------------------------------------------------- */

/**
 * "I'm on leave Tuesday — who can I ask to take my classes?"
 *
 * One query per DAY, not per faculty member or period: every active faculty
 * member's complete day for that day is returned in a single response, along
 * with every section each of them teaches anywhere in the week (that's what
 * "already handles this section" means — a standing fact, not a same-day
 * coincidence). The client picks the faculty member going on leave, lets
 * them click the hour they need covered, and derives the "class to adjust"
 * plus the Same Section / Department / College candidate tiers entirely from
 * this one payload — nothing here is ever re-fetched just because a
 * different faculty member or period was picked.
 *
 * Busy people are never filtered out and there is no ranking by who happens
 * to be free — every candidate's whole day is returned exactly as it is,
 * "FREE" or the real class, never "ENGAGED", so a human can compare complete
 * workloads and decide who to approach.
 *
 * Nothing is written. This endpoint suggests; a human decides.
 */
publicRouter.get(
  "/adjustment",
  asyncHandler(async (req, res) => {
    const query = z.object({ dayOfWeek: z.enum(DAYS) }).parse(req.query)

    const { term, cfg, live } = await liveContext()

    if (!(cfg.workingDays as string[]).includes(query.dayOfWeek)) {
      throw new AppError(
        `${DAY_LABELS[query.dayOfWeek] ?? query.dayOfWeek} isn't a working day this term.`,
        400
      )
    }

    const [dayEntries, weekPairs, allFaculty] = await Promise.all([
      // Everyone's classes on THIS day — lays out each faculty member's
      // complete day timetable.
      prisma.timetableEntry.findMany({
        where: { versionId: live.id, dayOfWeek: query.dayOfWeek },
        include: {
          subject: true,
          room: true,
          section: { include: { branch: { include: { department: true } } } },
        },
        orderBy: { startPeriod: "asc" },
      }),
      // Which sections each faculty member teaches ANYWHERE this week — this
      // is what makes someone "already handle that section", not merely a
      // same-day coincidence.
      prisma.timetableEntry.findMany({
        where: { versionId: live.id, facultyId: { not: null } },
        select: { facultyId: true, sectionId: true },
        distinct: ["facultyId", "sectionId"],
      }),
      prisma.faculty.findMany({
        where: { isActive: true },
        include: { department: true },
        orderBy: { facultyNo: "asc" },
      }),
    ])

    const sectionsByFaculty = new Map<string, Set<string>>()
    for (const row of weekPairs) {
      if (!row.facultyId) continue
      const set = sectionsByFaculty.get(row.facultyId) ?? new Set<string>()
      set.add(row.sectionId)
      sectionsByFaculty.set(row.facultyId, set)
    }

    const covers = (e: { startPeriod: number; periodSpan: number }, period: number) =>
      period >= e.startPeriod && period < e.startPeriod + e.periodSpan

    const slots = buildDayGrid(cfg)

    /** One faculty member's whole day, laid out against the clock. */
    const dayFor = (facultyId: string) =>
      slots.map((slot) => {
        if (slot.kind !== "PERIOD" || slot.period === null) {
          return {
            kind: slot.kind,
            period: null as number | null,
            startTime: slot.startTime,
            endTime: slot.endTime,
            busy: false,
            detail: null as null | {
              subjectCode: string | null
              subjectName: string | null
              sectionId: string
              sectionLabel: string
              sectionDepartmentId: string
              room: string | null
              entryType: string
            },
          }
        }

        const entry = dayEntries.find(
          (e) => e.facultyId === facultyId && covers(e, slot.period!)
        )

        return {
          kind: "PERIOD" as const,
          period: slot.period,
          startTime: slot.startTime,
          endTime: slot.endTime,
          busy: Boolean(entry),
          detail: entry
            ? {
                subjectCode: entry.subject?.code ?? null,
                subjectName: entry.subject?.name ?? null,
                sectionId: entry.sectionId,
                sectionLabel: sectionLabel(entry.section),
                sectionDepartmentId: entry.section.branch.departmentId,
                room: entry.room?.name ?? null,
                entryType: entry.entryType,
              }
            : null,
        }
      })

    const faculty = allFaculty.map((f) => {
      const day = dayFor(f.id)
      return {
        faculty: {
          id: f.id,
          facultyNo: f.facultyNo,
          name: f.name,
          label: `${f.facultyNo} — ${f.name}`,
          departmentId: f.departmentId,
          departmentCode: f.department.code,
          departmentName: f.department.name,
        },
        day,
        sectionIds: [...(sectionsByFaculty.get(f.id) ?? [])],
        periodsTaughtToday: day.filter((s) => s.kind === "PERIOD" && s.busy).length,
      }
    })

    res.json({
      readOnly: true,
      term: { id: term.id, label: term.label },
      published: { label: live.label, publishedAt: live.publishedAt ?? null },
      query: {
        dayOfWeek: query.dayOfWeek,
        dayLabel: DAY_LABELS[query.dayOfWeek] ?? query.dayOfWeek,
      },
      grid: { slots, workingDays: cfg.workingDays, numPeriods: cfg.numPeriods },
      faculty,
    })
  })
)
