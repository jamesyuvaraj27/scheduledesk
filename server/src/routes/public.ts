/**
 * The public side of ScheduleDesk.
 *
 * Everything here is read-only and needs no login: the student/faculty
 * timetable view and the class-adjustment lookup a faculty member uses when
 * they are going on leave.
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
/*                     Class adjustment (faculty on leave)                    */
/* -------------------------------------------------------------------------- */

/**
 * "I'm on leave Tuesday 3rd hour for IV CSM-A. Who's free?"
 *
 * Availability is derived from the live timetable, never from a list somebody
 * has to maintain: a faculty member is free in a period if they have no entry
 * covering it that day. Each free person is returned with their whole day, so
 * the HoD can see at a glance whether swapping them in is reasonable.
 *
 * Nothing is written. This endpoint suggests; a human decides.
 */
publicRouter.get(
  "/adjustment",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        sectionId: z.string().min(1, "Choose a section"),
        dayOfWeek: z.enum(DAYS),
        startPeriod: z.coerce.number().int().min(1).max(12),
      })
      .parse(req.query)

    const { term, cfg, live } = await liveContext()

    if (!(cfg.workingDays as string[]).includes(query.dayOfWeek)) {
      throw new AppError(
        `${DAY_LABELS[query.dayOfWeek] ?? query.dayOfWeek} isn't a working day this term.`,
        400
      )
    }
    if (query.startPeriod > cfg.numPeriods) {
      throw new AppError(`The day only has ${cfg.numPeriods} periods.`, 400)
    }

    const section = await prisma.section.findUnique({
      where: { id: query.sectionId },
      include: { branch: { include: { department: true } }, homeRoom: true },
    })
    if (!section) throw notFound("Section")

    // The whole day, every section — one query, then everything else is done
    // in memory.
    const dayEntries = await prisma.timetableEntry.findMany({
      where: { versionId: live.id, dayOfWeek: query.dayOfWeek },
      include: {
        subject: true,
        faculty: true,
        room: true,
        section: { include: { branch: true } },
      },
      orderBy: { startPeriod: "asc" },
    })

    const covers = (e: { startPeriod: number; periodSpan: number }, period: number) =>
      period >= e.startPeriod && period < e.startPeriod + e.periodSpan

    /* ---- the class that needs covering ---- */

    const target =
      dayEntries.find(
        (e) => e.sectionId === section.id && covers(e, query.startPeriod)
      ) ?? null

    /* ---- who is busy in that period ---- */

    const busyFacultyIds = new Set(
      dayEntries
        .filter((e) => e.facultyId && covers(e, query.startPeriod))
        .map((e) => e.facultyId!)
    )

    const allFaculty = await prisma.faculty.findMany({
      where: { isActive: true },
      include: {
        department: true,
        eligibleSubjects: { select: { subjectId: true } },
      },
      orderBy: { facultyNo: "asc" },
    })

    const free = allFaculty.filter((f) => !busyFacultyIds.has(f.id))

    const slots = buildDayGrid(cfg)

    /** One faculty member's whole day, laid out against the clock. */
    const dayFor = (facultyId: string) =>
      slots.map((slot) => {
        if (slot.kind !== "PERIOD" || slot.period === null) {
          return {
            kind: slot.kind,
            period: null,
            startTime: slot.startTime,
            endTime: slot.endTime,
            isTarget: false,
            busy: false,
            label: slot.kind === "BREAK" ? "BREAK" : "LUNCH",
            detail: null as null | {
              subject: string | null
              section: string
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
          isTarget: slot.period === query.startPeriod,
          busy: Boolean(entry),
          label: entry
            ? [
                entry.subject?.code ?? entry.entryType,
                sectionLabel(entry.section),
                entry.room?.name,
              ]
                .filter(Boolean)
                .join(" — ")
            : "FREE",
          detail: entry
            ? {
                subject: entry.subject?.code ?? entry.entryType,
                section: sectionLabel(entry.section),
                room: entry.room?.name ?? null,
                entryType: entry.entryType,
              }
            : null,
        }
      })

    const targetSubjectId = target?.subjectId ?? null

    const candidates = free.map((f) => {
      const day = dayFor(f.id)
      const teaching = day.filter((s) => s.kind === "PERIOD" && s.busy).length
      const eligible = targetSubjectId
        ? f.eligibleSubjects.some((es) => es.subjectId === targetSubjectId)
        : false

      return {
        faculty: {
          id: f.id,
          facultyNo: f.facultyNo,
          name: f.name,
          label: facultyLabel(f),
          departmentCode: f.department.code,
        },
        // Why this person is worth considering, in the order a human would.
        teachesThisSubject: eligible,
        sameDepartment: f.departmentId === section.branch.departmentId,
        periodsTaughtToday: teaching,
        day,
      }
    })

    candidates.sort((a, b) => {
      if (a.teachesThisSubject !== b.teachesThisSubject) {
        return a.teachesThisSubject ? -1 : 1
      }
      if (a.sameDepartment !== b.sameDepartment) return a.sameDepartment ? -1 : 1
      if (a.periodsTaughtToday !== b.periodsTaughtToday) {
        return a.periodsTaughtToday - b.periodsTaughtToday
      }
      return a.faculty.facultyNo.localeCompare(b.faculty.facultyNo)
    })

    const targetSlot =
      slots.find((s) => s.kind === "PERIOD" && s.period === query.startPeriod) ?? null

    res.json({
      readOnly: true,
      term: { id: term.id, label: term.label },
      published: { label: live.label, publishedAt: live.publishedAt ?? null },
      query: {
        dayOfWeek: query.dayOfWeek,
        dayLabel: DAY_LABELS[query.dayOfWeek] ?? query.dayOfWeek,
        startPeriod: query.startPeriod,
        startTime: targetSlot?.startTime ?? null,
        endTime: targetSlot?.endTime ?? null,
      },
      section: {
        id: section.id,
        label: sectionLabel(section),
        year: section.year,
        branchCode: section.branch.code,
        homeRoom: section.homeRoom?.name ?? null,
      },
      // What is actually scheduled then — null means the section is already
      // free that hour and nothing needs covering.
      selectedClass: target
        ? {
            entryType: target.entryType,
            subject: target.subject
              ? { code: target.subject.code, name: target.subject.name }
              : null,
            regularFaculty: target.faculty
              ? {
                  id: target.faculty.id,
                  facultyNo: target.faculty.facultyNo,
                  name: target.faculty.name,
                  label: facultyLabel(target.faculty),
                }
              : null,
            room: target.room?.name ?? null,
            periodSpan: target.periodSpan,
            startPeriod: target.startPeriod,
          }
        : null,
      grid: { slots, workingDays: cfg.workingDays, numPeriods: cfg.numPeriods },
      availableFaculty: candidates,
      busyCount: busyFacultyIds.size,
      totalActiveFaculty: allFaculty.length,
    })
  })
)
