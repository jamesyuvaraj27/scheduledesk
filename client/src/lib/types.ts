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

export type EntryType = "THEORY" | "LAB" | "LIBRARY" | "SEMINAR" | "COUNSELING"

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

export interface SectionTimetable {
  term: { id: string; label: string }
  section: Section
  grid: TimetableGrid
  entries: TimetableEntry[]
  legend: { subjectId: string; code: string; facultyName: string | null }[]
  validation: SectionValidation
}

export interface SlotAvailability {
  dayOfWeek: Day
  startPeriod: number
  available: boolean
  reasons: Conflict[]
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
    legend: { subjectId: string; code: string; facultyName: string | null }[]
  }[]
}
