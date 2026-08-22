export type RoomType = "CLASSROOM" | "LAB" | "LIBRARY" | "SEMINAR_HALL"
export type SubjectType = "THEORY" | "LAB"
export type Day = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"

export interface Department {
  id: string
  name: string
  code: string
  branches?: Branch[]
  _count?: { branches: number; faculty: number }
}

export interface Branch {
  id: string
  departmentId: string
  name: string
  code: string
  department?: Department
  _count?: { sections: number; subjects: number }
}

export type Block = "A" | "L" | "V"
export type Floor = "GF" | "FF" | "SF" | "TF" | "LF"

export const BLOCKS: Block[] = ["A", "L", "V"]
export const FLOORS: Floor[] = ["GF", "FF", "SF", "TF", "LF"]

export const FLOOR_LABELS: Record<Floor, string> = {
  GF: "Ground floor",
  FF: "First floor",
  SF: "Second floor",
  TF: "Third floor",
  LF: "Last floor",
}

export interface Room {
  id: string
  name: string
  type: RoomType
  capacity: number | null
  block: Block | null
  floor: Floor | null
  /** Year the room is set aside for; null = any year may use it. */
  year: number | null
}

export interface Section {
  id: string
  branchId: string
  year: number
  name: string
  homeRoomId: string | null
  branch?: Branch
  homeRoom?: Room | null
}

export interface Subject {
  id: string
  branchId: string
  name: string
  code: string
  type: SubjectType
  branch?: Branch
  eligibleFaculty?: { faculty: Faculty }[]
}

export interface Faculty {
  id: string
  /** Unique, human-facing code (FAC001). Never used as a foreign key. */
  facultyNo: string
  name: string
  departmentId: string
  isActive: boolean
  department?: Department
  eligibleSubjects?: { subject: Subject }[]
}

export interface GridSlot {
  kind: "PERIOD" | "BREAK" | "LUNCH"
  period: number | null
  startTime: string
  endTime: string
  durationMin: number
}

export interface ComputedGrid {
  slots: GridSlot[]
  endTime: string
}

export interface TimeConfig {
  id: string
  termId: string
  startTime: string
  numPeriods: number
  morningPeriodDurationMin: number
  afternoonPeriodDurationMin: number
  breakAfterPeriod: number
  breakDurationMin: number
  lunchAfterPeriod: number
  lunchDurationMin: number
  workingDays: Day[]
}

export interface AcademicTerm {
  id: string
  year: number
  semester: number
  label: string
  isActive: boolean
  timeConfig: TimeConfig | null
  grid: ComputedGrid | null
  _count?: {
    timetableEntries: number
    sectionAssignments: number
    sectionSubjects?: number
  }
  copiedCurriculumRows?: number
}

export interface Summary {
  counts: {
    departments: number
    branches: number
    sections: number
    rooms: number
    faculty: number
    subjects: number
  }
  sectionsByYear: { year: number; count: number }[]
  activeTerm: (AcademicTerm & { timeConfig: TimeConfig | null }) | null
}

/* ----------------------------- Phase 2 types ----------------------------- */

export interface CurriculumRow {
  id: string
  subject: Subject
  weeklyTheoryHrs: number
  weeklyLabHrs: number
  faculty: Faculty | null
  eligibleFaculty: Faculty[]
}

export interface CurriculumResponse {
  section: Section
  term: { id: string; label: string }
  rows: CurriculumRow[]
  availableSubjects: Subject[]
  totals: {
    subjects: number
    weeklyHours: number
    missingFaculty: string[]
    weeklyActivityHours: number
  }
}

export interface SectionStatus {
  section: Section
  subjectCount: number
  assignedCount: number
  weeklyHours: number
  ready: boolean
}

export interface CurriculumStatusResponse {
  term: { id: string; label: string } | null
  sections: SectionStatus[]
}

export interface FacultyWorkloadRow {
  faculty: Faculty
  weeklyHours: number
  assignments: {
    subject: string
    section: string
    year: number
    hours: number
  }[]
}

export interface FacultyWorkloadResponse {
  term: { id: string; label: string } | null
  faculty: FacultyWorkloadRow[]
}

/* --------------------------- Phase 3/4/5 types --------------------------- */

export type EntryType = "THEORY" | "LAB" | "LIBRARY" | "SEMINAR" | "COUNSELING" | "SPORTS"

export interface Conflict {
  code: string
  message: string
  conflictingEntryId?: string
}

export interface TimetableGrid {
  slots: GridSlot[]
  endTime: string
  workingDays: Day[]
  numPeriods: number
}

export interface TimetableEntry {
  id: string
  dayOfWeek: Day
  startPeriod: number
  periodSpan: number
  entryType: EntryType
  subject: Subject | null
  faculty: Faculty | null
  room: Room | null
}

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
  errors: string[]
  warnings: string[]
  valid: boolean
}

export interface LegendRow {
  subjectId: string
  code: string
  facultyName: string | null
  facultyNo?: string | null
}

export interface SectionTimetable {
  term: { id: string; label: string }
  section: Section
  grid: TimetableGrid
  entries: TimetableEntry[]
  legend: LegendRow[]
  validation: SectionValidation
  version?: VersionRef
}

export interface SlotAvailability {
  dayOfWeek: Day
  startPeriod: number
  available: boolean
  reasons: Conflict[]
  /**
   * Blocked as an ordinary placement, but legal as a combined class taught
   * alongside this existing entry — one teacher, one subject, two sections,
   * one room. Null whenever combining wouldn't be valid either.
   */
  combinableWithEntryId?: string | null
}

export interface AvailabilityResponse {
  periodSpan: number
  facultyId: string | null
  roomId: string | null
  slots: SlotAvailability[]
}

export interface FacultyTimetable {
  term: { id: string; label: string }
  faculty: Faculty
  grid: TimetableGrid
  entries: (Omit<TimetableEntry, "faculty"> & {
    section: {
      id: string
      name: string
      year: number
      branchCode: string
      departmentCode: string
    }
  })[]
  summary: {
    weeklyPeriods: number
    freePeriods: number
    byDay: Record<string, number>
  }
}

/* ---------------------------- Phase 8 overview --------------------------- */

export type BuildStage =
  | "needs-room"
  | "needs-curriculum"
  | "needs-faculty"
  | "ready-to-build"
  | "in-progress"
  | "done"

export interface BuildStatusRow {
  section: {
    id: string
    name: string
    year: number
    branchCode: string
    branchName: string
    departmentCode: string
    homeRoom: string | null
  }
  curriculum: { subjectCount: number; assignedCount: number; ready: boolean }
  timetable: {
    placedPeriods: number
    requiredPeriods: number
    complete: boolean
    errorCount: number
    warnings: string[]
  }
  stage: BuildStage
}

export interface BuildStatusResponse {
  term: { id: string; label: string } | null
  years: { year: number; sections: BuildStatusRow[]; done: number; total: number }[]
  totals?: { sections: number; done: number; notStarted: number }
}

export interface PrintAllResponse {
  term: { id: string; label: string }
  grid: TimetableGrid
  sections: {
    section: {
      id: string
      name: string
      year: number
      branch: { code: string; name: string }
      department: { code: string }
      homeRoom: Room | null
    }
    entries: TimetableEntry[]
    legend: LegendRow[]
  }[]
}

/* --------------------------- Bulk print (faculty / rooms) ----------------- */

/**
 * Every faculty member's week in one response, for "Print all faculty
 * timetables". Same entry shape the single-faculty page uses, so one cell
 * component renders both.
 */
export interface PrintAllFacultyResponse {
  term: { id: string; label: string }
  grid: TimetableGrid
  faculty: {
    faculty: {
      id: string
      facultyNo: string
      name: string
      departmentCode: string
    }
    entries: FacultyTimetable["entries"]
    summary: { weeklyPeriods: number; freePeriods: number }
  }[]
}

/** Every room's week in one response, for "Print all room timetables". */
export interface PrintAllRoomsResponse {
  term: { id: string; label: string }
  grid: TimetableGrid
  rooms: {
    room: Room
    entries: RoomTimetableEntry[]
  }[]
}

/* --------------------------- Room allocation ----------------------------- */

/**
 * A class as seen from a room's point of view. `label` is the
 * YEAR_SECTION_SUBJECT string built server-side from real data.
 */
export interface RoomTimetableEntry {
  id: string
  dayOfWeek: Day
  startPeriod: number
  periodSpan: number
  entryType: EntryType
  label: string
  section: { id: string; name: string; year: number; branchCode: string }
  subject: { id: string; code: string; name: string } | null
  faculty: { id: string; name: string; facultyNo: string } | null
}

export interface RoomTimetable {
  term: { id: string; label: string }
  room: Room
  grid: TimetableGrid
  entries: RoomTimetableEntry[]
}

/*
 * `SectionHomeRoomTimetable` used to live here — the home room's own week,
 * attached to the public section timetable and to /print/sections so both
 * could draw a second grid underneath the first. Removed 2026-08-22: the room
 * is now printed inside each timetable cell, and the room's own week belongs
 * to the Rooms section alone (`RoomTimetable` above).
 */

/** A class that could take a given room on a given day/period. */
export interface AllocatableOption {
  entryId: string
  label: string
  entryType: EntryType
  periodSpan: number
  startPeriod: number
  currentRoom: { id: string; name: string } | null
  alreadyHere: boolean
  available: boolean
  reasons: Conflict[]
  /**
   * Blocked as an ordinary move because the room is already in use, but
   * legal if the office says the two are meant to run side by side — the
   * Shared Room case. False when sharing wouldn't fix it either (a faculty
   * member can't take two different subjects at once, room or no room).
   */
  shareable?: boolean
  /** The class already in the room, to be shared with. */
  shareWithEntryId?: string | null
}

export interface AllocatableResponse {
  room: Room
  dayOfWeek: Day
  startPeriod: number
  options: AllocatableOption[]
}

/* --------------------------- Live / Working ------------------------------ */

export type VersionKind = "LIVE" | "WORKING" | "ARCHIVED"

export interface VersionRef {
  id: string
  kind: VersionKind
  label: string
}

export interface VersionSummary extends VersionRef {
  note: string | null
  createdAt: string
  publishedAt: string | null
  entryCount: number
}

export interface VersionState {
  term: { id: string; label: string }
  live: VersionSummary
  working: VersionSummary | null
  /** True while a working copy exists — the live timetable is then read-only. */
  liveLocked: boolean
}

/* ------------------------------ Public views ----------------------------- */

/**
 * A faculty member as the public side is allowed to see them: name only.
 *
 * `facultyNo` is deliberately absent — the college's own numbering is admin
 * information and `server/src/routes/public.ts` strips it from every response,
 * so there is nothing to type here. `id` is an opaque cuid the Class
 * Adjustment page uses as a select value; it is never rendered.
 */
export interface PublicFacultyRef {
  id: string
  name: string
  label: string
}

/**
 * The subject -> faculty key printed under a public grid. Keyed by subject
 * CODE (not id — the public route builds it from what's actually placed, so
 * activities like Library appear too) and carries no faculty number.
 */
export interface PublicLegendRow {
  code: string
  facultyName: string | null
}

export interface PublicSectionRef {
  id: string
  name: string
  branchCode: string
  branchName: string
  label: string
}

export interface PublicMeta {
  term: { id: string; label: string }
  published: { label: string; publishedAt: string | null }
  grid: TimetableGrid
  days: { value: Day; label: string }[]
  years: { year: number; roman: string; sections: PublicSectionRef[] }[]
  /** Active faculty, ordered by name — the Faculty Timetable page selector. */
  faculty: PublicFacultyRef[]
}

export interface PublicTimetableEntry {
  id: string
  dayOfWeek: Day
  startPeriod: number
  periodSpan: number
  entryType: EntryType
  subject: { id: string; code: string; name: string } | null
  faculty: PublicFacultyRef | null
  room: { id: string; name: string } | null
}

export interface PublicSectionTimetable {
  term: { id: string; label: string }
  published: { label: string; publishedAt: string | null }
  section: {
    id: string
    name: string
    year: number
    label: string
    branchCode: string
    branchName: string
    departmentCode: string
    homeRoom: string | null
  }
  grid: TimetableGrid
  entries: PublicTimetableEntry[]
  /** Subject code -> faculty, printed under the grid. */
  legend: PublicLegendRow[]
}

/**
 * One faculty member's week, public and read-only — the same shape as the
 * admin FacultyTimetable, minus `facultyNo`. When a Combined Section puts
 * this teacher in two sections at once, `entries` simply has two rows for
 * that hour (one per section); the grid's `lanes` prop draws the second as
 * an extra row. A Shared Room never adds a row here, because the room's
 * *other* occupant has a different facultyId and so never appears in this
 * facultyId-filtered list.
 */
export interface PublicFacultyTimetable {
  term: { id: string; label: string }
  published: { label: string; publishedAt: string | null }
  faculty: PublicFacultyRef & { departmentCode: string; departmentName: string }
  grid: TimetableGrid
  entries: {
    id: string
    dayOfWeek: Day
    startPeriod: number
    periodSpan: number
    entryType: EntryType
    subject: { id: string; code: string; name: string } | null
    room: { id: string; name: string } | null
    section: {
      id: string
      name: string
      year: number
      branchCode: string
      departmentCode: string
    }
  }[]
  summary: {
    weeklyPeriods: number
    freePeriods: number
    byDay: Record<string, number>
  }
}

/* --------------------------- Day-wise report ------------------------------ */

/** One section row of the public day-wise report. */
export interface PublicDayWiseSection {
  section: {
    id: string
    name: string
    year: number
    label: string
    branch: { code: string; name: string }
    department: { code: string }
    homeRoom: { id: string; name: string } | null
  }
  entries: PublicTimetableEntry[]
}

export interface PublicDayWiseReport {
  term: { id: string; label: string }
  published: { label: string; publishedAt: string | null }
  grid: TimetableGrid
  sections: PublicDayWiseSection[]
}

/* ------------------------------ Class adjustment --------------------------- */

/** What's on at one period/break/lunch slot, when a faculty member is busy. */
export interface AdjustmentSlotDetail {
  subjectCode: string | null
  subjectName: string | null
  sectionId: string
  sectionLabel: string
  sectionDepartmentId: string
  room: string | null
  entryType: EntryType
}

/** One slot of a faculty member's day on the Class Adjustment page. */
export interface AdjustmentDaySlot {
  kind: "PERIOD" | "BREAK" | "LUNCH"
  period: number | null
  startTime: string
  endTime: string
  busy: boolean
  detail: AdjustmentSlotDetail | null
}

export interface AdjustmentFacultyRef extends PublicFacultyRef {
  departmentId: string
  departmentCode: string
  departmentName: string
}

/** One faculty member's complete day, plus every section they teach all week. */
export interface AdjustmentFacultyRow {
  faculty: AdjustmentFacultyRef
  day: AdjustmentDaySlot[]
  sectionIds: string[]
  periodsTaughtToday: number
}

export interface AdjustmentResponse {
  readOnly: true
  term: { id: string; label: string }
  published: { label: string; publishedAt: string | null }
  query: { dayOfWeek: Day; dayLabel: string }
  grid: { slots: GridSlot[]; workingDays: Day[]; numPeriods: number }
  faculty: AdjustmentFacultyRow[]
}
