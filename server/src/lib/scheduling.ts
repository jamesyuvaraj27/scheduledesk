/**
 * The conflict engine.
 *
 * This module is deliberately pure — no Prisma, no Express, no I/O. Callers
 * load the relevant rows and hand them in. That keeps the actual scheduling
 * rules (the part that must never be wrong) unit-testable in isolation, and
 * lets the same code answer two different questions:
 *
 *   1. "Is this placement legal?"        -> validatePlacement()
 *   2. "Where COULD this go?"            -> computeAvailability()
 *
 * The second is what makes the UI clash-blocked rather than clash-warning:
 * the grid greys out every slot that would fail before the user clicks.
 */

import { occupiedPeriods } from "./periods.js"

export type Day = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"

export type EntryType = "THEORY" | "LAB" | "LIBRARY" | "SEMINAR" | "COUNSELING"

export type RoomType = "CLASSROOM" | "LAB" | "LIBRARY" | "SEMINAR_HALL"

export type ConflictCode =
  | "SECTION_CLASH"
  | "FACULTY_CLASH"
  | "ROOM_CLASH"
  | "INVALID_SPAN"
  | "OUT_OF_RANGE"
  | "NOT_A_WORKING_DAY"
  | "SUBJECT_NOT_IN_CURRICULUM"
  | "FACULTY_NOT_ASSIGNED"
  | "WRONG_ROOM_TYPE"
  | "MISSING_ROOM"
  | "MISSING_SUBJECT"

export interface Conflict {
  code: ConflictCode
  message: string
  /** The existing entry we collided with, when the conflict is a clash. */
  conflictingEntryId?: string
}

/** An entry already placed on the timetable (any section, any year). */
export interface PlacedEntry {
  id: string
  sectionId: string
  dayOfWeek: Day
  startPeriod: number
  periodSpan: number
  entryType: EntryType
  subjectId: string | null
  facultyId: string | null
  roomId: string | null
}

/** A placement the user is attempting. */
export interface Candidate {
  /** Set when editing/moving an existing entry, so it doesn't clash with itself. */
  id?: string
  sectionId: string
  dayOfWeek: Day
  startPeriod: number
  periodSpan: number
  entryType: EntryType
  subjectId?: string | null
  facultyId?: string | null
  roomId?: string | null
}

export interface TimeConfigLike {
  numPeriods: number
  morningPeriodDurationMin: number
  afternoonPeriodDurationMin: number
  startTime: string
  breakAfterPeriod: number
  breakDurationMin: number
  lunchAfterPeriod: number
  lunchDurationMin: number
  workingDays: string[]
}

export interface CurriculumEntry {
  subjectId: string
  subjectCode: string
  weeklyTheoryHrs: number
  weeklyLabHrs: number
}

export interface SchedulingContext {
  timeConfig: TimeConfigLike
  /** Every entry in the active term, across all sections and years. */
  entries: PlacedEntry[]
  /** Curriculum for the section being edited. */
  curriculum: CurriculumEntry[]
  /** subjectId -> facultyId locked in during term setup. */
  assignments: Map<string, string>
  rooms: Map<string, { id: string; name: string; type: RoomType }>
  /** Display names, used only to write readable conflict messages. */
  names?: {
    faculty?: Map<string, string>
    sections?: Map<string, string>
    subjects?: Map<string, string>
  }
}

/** Two placements collide if they share a day and any period number. */
export function overlaps(
  aStart: number,
  aSpan: number,
  bStart: number,
  bSpan: number
): boolean {
  return aStart < bStart + bSpan && bStart < aStart + aSpan
}

/** Entry types that occupy a teaching slot but have no subject of their own. */
export const ACTIVITY_TYPES: EntryType[] = ["LIBRARY", "SEMINAR", "COUNSELING"]

export function isActivity(type: EntryType): boolean {
  return ACTIVITY_TYPES.includes(type)
}

/** Every activity happens once a week per section. */
export const ACTIVITY_WEEKLY_HOURS = 1

/**
 * The single source of truth for whether a placement is legal.
 * Returns every reason it fails — an empty array means it's fine.
 */
export function validatePlacement(
  candidate: Candidate,
  ctx: SchedulingContext
): Conflict[] {
  const conflicts: Conflict[] = []
  const { timeConfig } = ctx
  const facultyName = (id: string) => ctx.names?.faculty?.get(id) ?? "That faculty member"
  const sectionName = (id: string) => ctx.names?.sections?.get(id) ?? "another section"

  /* ---- shape of the placement itself ---- */

  if (!timeConfig.workingDays.includes(candidate.dayOfWeek)) {
    conflicts.push({
      code: "NOT_A_WORKING_DAY",
      message: `${candidate.dayOfWeek} is not a working day for this term.`,
    })
  }

  // Labs may span as many consecutive periods as the admin chooses; only
  // non-lab entries are pinned to a single period.
  if (!Number.isInteger(candidate.periodSpan) || candidate.periodSpan < 1) {
    conflicts.push({
      code: "INVALID_SPAN",
      message: "A class must cover at least one period.",
    })
  } else if (candidate.entryType !== "LAB" && candidate.periodSpan !== 1) {
    conflicts.push({
      code: "INVALID_SPAN",
      message: "Only labs can cover more than one period.",
    })
  } else if (candidate.periodSpan > timeConfig.numPeriods) {
    conflicts.push({
      code: "INVALID_SPAN",
      message: `The day only has ${timeConfig.numPeriods} periods.`,
    })
  }

  if (
    candidate.startPeriod < 1 ||
    candidate.startPeriod + candidate.periodSpan - 1 > timeConfig.numPeriods
  ) {
    conflicts.push({
      code: "OUT_OF_RANGE",
      message: `That doesn't fit — the day has ${timeConfig.numPeriods} periods.`,
    })
  }

  /* ---- subject / faculty consistency ---- */

  if (!isActivity(candidate.entryType)) {
    if (!candidate.subjectId) {
      conflicts.push({
        code: "MISSING_SUBJECT",
        message: "Choose a subject for this class.",
      })
    } else {
      const inCurriculum = ctx.curriculum.find(
        (c) => c.subjectId === candidate.subjectId
      )
      if (!inCurriculum) {
        conflicts.push({
          code: "SUBJECT_NOT_IN_CURRICULUM",
          message: "That subject isn't in this section's curriculum.",
        })
      }

      // The faculty for a subject is fixed for the term during setup, so a
      // placement must use that person — no ad-hoc substitutes.
      const assigned = ctx.assignments.get(candidate.subjectId)
      if (assigned && candidate.facultyId && candidate.facultyId !== assigned) {
        conflicts.push({
          code: "FACULTY_NOT_ASSIGNED",
          message: `${facultyName(candidate.facultyId)} isn't the faculty assigned to this subject for this section.`,
        })
      }
      if (!assigned) {
        conflicts.push({
          code: "FACULTY_NOT_ASSIGNED",
          message:
            "No faculty is assigned to this subject yet. Set it in Curriculum first.",
        })
      }
    }
  }

  /* ---- room rules ---- */

  if (candidate.roomId) {
    const room = ctx.rooms.get(candidate.roomId)
    if (room) {
      if (candidate.entryType === "LAB" && room.type !== "LAB") {
        conflicts.push({
          code: "WRONG_ROOM_TYPE",
          message: `${room.name} isn't a laboratory.`,
        })
      }
      if (candidate.entryType === "THEORY" && room.type === "LAB") {
        conflicts.push({
          code: "WRONG_ROOM_TYPE",
          message: `${room.name} is a laboratory — theory classes use the section's home room.`,
        })
      }
    }
  } else if (candidate.entryType === "LAB") {
    conflicts.push({
      code: "MISSING_ROOM",
      message: "Choose which laboratory this lab runs in.",
    })
  }

  /* ---- clashes with what's already placed ---- */

  for (const entry of ctx.entries) {
    if (entry.id === candidate.id) continue
    if (entry.dayOfWeek !== candidate.dayOfWeek) continue
    if (
      !overlaps(
        candidate.startPeriod,
        candidate.periodSpan,
        entry.startPeriod,
        entry.periodSpan
      )
    ) {
      continue
    }

    if (entry.sectionId === candidate.sectionId) {
      conflicts.push({
        code: "SECTION_CLASH",
        message: "This section already has a class in that slot.",
        conflictingEntryId: entry.id,
      })
    }

    if (
      candidate.facultyId &&
      entry.facultyId &&
      entry.facultyId === candidate.facultyId &&
      entry.sectionId !== candidate.sectionId
    ) {
      conflicts.push({
        code: "FACULTY_CLASH",
        message: `${facultyName(candidate.facultyId)} is teaching ${sectionName(entry.sectionId)} at that time.`,
        conflictingEntryId: entry.id,
      })
    }

    if (
      candidate.roomId &&
      entry.roomId &&
      entry.roomId === candidate.roomId &&
      entry.sectionId !== candidate.sectionId
    ) {
      const room = ctx.rooms.get(candidate.roomId)
      conflicts.push({
        code: "ROOM_CLASH",
        message: `${room?.name ?? "That room"} is in use by ${sectionName(entry.sectionId)} at that time.`,
        conflictingEntryId: entry.id,
      })
    }
  }

  return conflicts
}

/* -------------------------------------------------------------------------- */
/*                                 Availability                               */
/* -------------------------------------------------------------------------- */

export interface SlotAvailability {
  dayOfWeek: Day
  startPeriod: number
  available: boolean
  /** Why not, when unavailable — shown as a tooltip on the blocked cell. */
  reasons: Conflict[]
}

/**
 * Which (day, startPeriod) combinations could hold this placement?
 * Drives the clash-blocked grid: the user picks a subject and immediately
 * sees only the slots that would actually work.
 */
export function computeAvailability(
  base: Omit<Candidate, "dayOfWeek" | "startPeriod">,
  ctx: SchedulingContext
): SlotAvailability[] {
  const out: SlotAvailability[] = []
  const days = ctx.timeConfig.workingDays as Day[]
  const span = base.periodSpan

  for (const dayOfWeek of days) {
    for (let startPeriod = 1; startPeriod <= ctx.timeConfig.numPeriods; startPeriod++) {
      if (startPeriod + span - 1 > ctx.timeConfig.numPeriods) continue

      const reasons = validatePlacement({ ...base, dayOfWeek, startPeriod }, ctx)
      out.push({
        dayOfWeek,
        startPeriod,
        available: reasons.length === 0,
        reasons,
      })
    }
  }

  return out
}

/* -------------------------------------------------------------------------- */
/*                            Weekly hour accounting                          */
/* -------------------------------------------------------------------------- */

export interface SubjectProgress {
  subjectId: string
  subjectCode: string
  requiredTheory: number
  placedTheory: number
  requiredLab: number
  placedLab: number
  complete: boolean
}

export interface ActivityProgress {
  entryType: EntryType
  required: number
  placed: number
  complete: boolean
}

export interface SectionValidation {
  subjects: SubjectProgress[]
  activities: ActivityProgress[]
  /** Blocking problems — save is refused while any exist. */
  errors: string[]
  /** Non-blocking advisories, e.g. a heavy teaching day. */
  warnings: string[]
  valid: boolean
}

/**
 * Soft cap on THEORY hours in a single day.
 *
 * The college norm is six theory hours a day. Labs sit on top of that — the
 * staff's own example of 4 theory plus a 3-hour lab (7 hours total) is
 * explicitly valid, so the threshold counts theory only, not total load.
 */
export const DEFAULT_DAILY_THEORY_WARN = 6

/**
 * Full check of one section's timetable. Weekly hours are a HARD rule: a
 * section can't be saved under or over its required hours, because a
 * timetable that doesn't deliver the syllabus isn't usable.
 */
export function validateSection(
  sectionId: string,
  ctx: SchedulingContext,
  options: { dailyTheoryWarnHours?: number; hasHomeRoom?: boolean } = {}
): SectionValidation {
  const warnAt = options.dailyTheoryWarnHours ?? DEFAULT_DAILY_THEORY_WARN
  const mine = ctx.entries.filter((e) => e.sectionId === sectionId)
  const errors: string[] = []
  const warnings: string[] = []

  // Without a home room, non-lab classes are stored with no room at all, so
  // there is nothing for room-clash detection to compare — two sections could
  // silently be put in the same place. Worth saying out loud.
  if (options.hasHomeRoom === false) {
    warnings.push(
      "This section has no home classroom, so room clashes can't be checked for its theory, library, seminar and counseling hours. Set one in Master Data."
    )
  }

  const subjects: SubjectProgress[] = ctx.curriculum.map((c) => {
    const forSubject = mine.filter((e) => e.subjectId === c.subjectId)
    const placedTheory = forSubject
      .filter((e) => e.entryType === "THEORY")
      .reduce((n, e) => n + e.periodSpan, 0)
    const placedLab = forSubject
      .filter((e) => e.entryType === "LAB")
      .reduce((n, e) => n + e.periodSpan, 0)

    const complete =
      placedTheory === c.weeklyTheoryHrs && placedLab === c.weeklyLabHrs

    if (placedTheory !== c.weeklyTheoryHrs) {
      errors.push(
        `${c.subjectCode}: ${placedTheory} of ${c.weeklyTheoryHrs} theory hours placed.`
      )
    }
    if (placedLab !== c.weeklyLabHrs) {
      errors.push(
        `${c.subjectCode}: ${placedLab} of ${c.weeklyLabHrs} lab hours placed.`
      )
    }

    return {
      subjectId: c.subjectId,
      subjectCode: c.subjectCode,
      requiredTheory: c.weeklyTheoryHrs,
      placedTheory,
      requiredLab: c.weeklyLabHrs,
      placedLab,
      complete,
    }
  })

  const activities: ActivityProgress[] = ACTIVITY_TYPES.map((type) => {
    const placed = mine.filter((e) => e.entryType === type).length
    if (placed !== ACTIVITY_WEEKLY_HOURS) {
      errors.push(
        `${title(type)}: ${placed} of ${ACTIVITY_WEEKLY_HOURS} weekly hour placed.`
      )
    }
    return {
      entryType: type,
      required: ACTIVITY_WEEKLY_HOURS,
      placed,
      complete: placed === ACTIVITY_WEEKLY_HOURS,
    }
  })

  // Any placement that has since become invalid (e.g. timings were edited
  // after the timetable was built) shows up here too.
  for (const entry of mine) {
    const problems = validatePlacement({ ...entry }, ctx)
    for (const p of problems) {
      const msg = `${entry.dayOfWeek} period ${entry.startPeriod}: ${p.message}`
      if (!errors.includes(msg)) errors.push(msg)
    }
  }

  // Soft advisory: an unusually heavy day of theory teaching.
  for (const [facultyId, byDay] of facultyDailyLoad(ctx.entries)) {
    for (const [day, load] of byDay) {
      if (load.theory > warnAt) {
        const name = ctx.names?.faculty?.get(facultyId) ?? "A faculty member"
        warnings.push(
          `${name} has ${load.theory} theory hours on ${day} (${load.total} including labs).`
        )
      }
    }
  }

  return { subjects, activities, errors, warnings, valid: errors.length === 0 }
}

export interface DailyLoad {
  /** All teaching periods, labs included. */
  total: number
  /** Theory periods only — what the six-hour norm applies to. */
  theory: number
}

/** facultyId -> day -> periods taught that day. */
export function facultyDailyLoad(
  entries: PlacedEntry[]
): Map<string, Map<Day, DailyLoad>> {
  const out = new Map<string, Map<Day, DailyLoad>>()
  for (const e of entries) {
    if (!e.facultyId) continue
    if (!out.has(e.facultyId)) out.set(e.facultyId, new Map())
    const byDay = out.get(e.facultyId)!
    const current = byDay.get(e.dayOfWeek) ?? { total: 0, theory: 0 }
    byDay.set(e.dayOfWeek, {
      total: current.total + e.periodSpan,
      theory: current.theory + (e.entryType === "THEORY" ? e.periodSpan : 0),
    })
  }
  return out
}

/** All period numbers an entry sits on — handy for rendering and tests. */
export function entryPeriods(entry: {
  startPeriod: number
  periodSpan: number
}): number[] {
  return occupiedPeriods(entry.startPeriod, entry.periodSpan)
}

function title(type: EntryType): string {
  return type.charAt(0) + type.slice(1).toLowerCase()
}
