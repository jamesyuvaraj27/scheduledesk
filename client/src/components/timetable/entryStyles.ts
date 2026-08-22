import type { EntryType } from "@/lib/types"

/**
 * One place that decides how a session is labelled and named.
 *
 * Admin, public and print all import from here, so the three can't drift —
 * that was the point of the request: a student, the office and the printed
 * sheet on the noticeboard should be reading the same words.
 *
 * (This used to also carry a colour-coding system — a CSS custom property
 * per session type, registered as Tailwind `bg-tt-*` utilities. That was
 * reverted; cells are plain now.)
 */

/** Everything a timetable cell can be, including the two non-teaching columns. */
export type SessionKind = EntryType | "BREAK" | "LUNCH"

/** How each one is written out. British spelling of counselling, as requested. */
export const SESSION_LABEL: Record<SessionKind, string> = {
  THEORY: "Theory",
  LAB: "Lab",
  SEMINAR: "Seminar",
  COUNSELING: "Counselling",
  LIBRARY: "Library",
  SPORTS: "Sports",
  BREAK: "Break",
  LUNCH: "Lunch",
}

/** The order session types are listed in, where that still matters: teaching first, then the pauses. */
export const SESSION_ORDER: SessionKind[] = [
  "THEORY",
  "LAB",
  "SPORTS",
  "LIBRARY",
  "SEMINAR",
  "COUNSELING",
  "BREAK",
  "LUNCH",
]

/**
 * SPORTS and LIBRARY carry no room or faculty at all — not even the
 * section's home room, and no fake assignment is ever made for them.
 * SEMINAR and COUNSELING are NOT in this set: they keep showing the
 * section's home room and their usual "no faculty" state, unchanged.
 */
export const NO_ROOM_FACULTY_TYPES: EntryType[] = ["SPORTS", "LIBRARY"]

export function hasNoRoomOrFaculty(type: EntryType): boolean {
  return NO_ROOM_FACULTY_TYPES.includes(type)
}

/**
 * What goes on the first line of a cell when there's no subject attached.
 * LIBRARY/SEMINAR/COUNSELING are entry types rather than subjects, so they
 * have no code of their own to print.
 */
export function activityLabel(type: EntryType): string {
  return SESSION_LABEL[type].toUpperCase()
}

/**
 * A faculty name that fits in a ~90px column: the honorific plus the last
 * word of the name. "Dr. K. Venkata Subbaiah" -> "Dr. Subbaiah",
 * "Ms. Y. Sireesha" -> "Ms. Sireesha", "Ravi Kumar" -> "Kumar".
 *
 * Two people sharing a surname read the same here on purpose — the full names
 * are in the legend under the grid, which is where you look when the short
 * form is ambiguous. Squeezing both full names into a cell would make every
 * cell unreadable to solve a problem that only some cells have.
 */
const HONORIFICS = /^(dr|mr|mrs|ms|prof|sri|smt|shri)\.?$/i

export function shortFacultyName(name: string | null | undefined): string | null {
  if (!name) return null
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]

  const last = parts[parts.length - 1]
  const first = parts[0]
  // A one-letter fragment as the last word ("Kumar K") isn't a surname —
  // fall back to the whole name rather than printing an initial on its own.
  if (last.replace(/\./g, "").length <= 1) return name.trim()

  return HONORIFICS.test(first.replace(/\./g, "")) ? `${first} ${last}` : last
}
