import type { GridSlot, Day } from "@/lib/types"

/**
 * Turning entries into table cells.
 *
 * The wrinkle: a lab occupies three consecutive PERIODS, but lunch may sit
 * between two of them. Periods 4-5-6 with lunch after 5 lay out as
 *
 *     [P4][P5][LUNCH][P6]
 *
 * so a single colSpan={3} would wrongly swallow the lunch column. Instead the
 * entry is split into contiguous *runs* of period columns — here a run of two
 * and a run of one — and rendered as two cells that read as one block.
 */

export interface OccupantCell<T> {
  kind: "entry"
  entry: T
  colSpan: number
  /** False for the second half of a block split by lunch. */
  isFirstRun: boolean
}

export interface EmptyCell {
  kind: "empty"
  period: number
  colSpan: 1
}

export interface PauseCell {
  kind: "pause"
  label: string
  slotKind: "BREAK" | "LUNCH"
  colSpan: 1
}

export type DayCell<T> = OccupantCell<T> | EmptyCell | PauseCell

interface HasPlacement {
  dayOfWeek: Day
  startPeriod: number
  periodSpan: number
}

/**
 * Build the cells for one day row, in column order.
 * Break and lunch columns are emitted as `pause` cells so the caller can
 * render them merged across all rows if it wants.
 */
export function buildDayCells<T extends HasPlacement>(
  day: Day,
  slots: GridSlot[],
  entries: T[]
): DayCell<T>[] {
  const forDay = entries.filter((e) => e.dayOfWeek === day)

  // period number -> the entry covering it
  const byPeriod = new Map<number, T>()
  for (const entry of forDay) {
    for (let i = 0; i < entry.periodSpan; i++) {
      byPeriod.set(entry.startPeriod + i, entry)
    }
  }

  const cells: DayCell<T>[] = []
  let consumed: T | null = null // entry whose run we are currently inside

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]

    if (slot.kind !== "PERIOD") {
      // A pause interrupts any run in progress, so the next period column
      // starts a fresh cell even if the same entry continues.
      consumed = null
      cells.push({
        kind: "pause",
        label: slot.kind === "BREAK" ? "BREAK" : "LUNCH",
        slotKind: slot.kind,
        colSpan: 1,
      })
      continue
    }

    const period = slot.period!
    const entry = byPeriod.get(period)

    if (!entry) {
      consumed = null
      cells.push({ kind: "empty", period, colSpan: 1 })
      continue
    }

    if (entry === consumed) continue // already covered by the run's colSpan

    // How many *consecutive period columns* from here belong to this entry?
    let colSpan = 0
    for (let k = i; k < slots.length; k++) {
      const s = slots[k]
      if (s.kind !== "PERIOD") break // a pause ends the run
      if (byPeriod.get(s.period!) !== entry) break
      colSpan++
    }

    cells.push({
      kind: "entry",
      entry,
      colSpan,
      isFirstRun: entry.startPeriod === period,
    })
    consumed = colSpan > 1 ? entry : null
  }

  return cells
}

/**
 * The same day, but split into as many rows as it takes to show everything.
 *
 * A section can only ever be in one place at a time, so its grid is always
 * one row per day and `buildDayCells` above is the whole story. A faculty
 * member's grid and a room's grid are different: both are queries across
 * every section, and the college deliberately puts two things in one hour —
 *
 *   a combined section, where one teacher takes one subject to CSM-A and
 *     CSM-B together, so BOTH sections' entries name that teacher and that
 *     room at the same hour;
 *   a shared room, where two independent classes run in one hall.
 *
 * Feeding those to `buildDayCells` would lose one of them silently: it maps
 * each period to a single entry, so the second simply overwrites the first
 * and vanishes from the sheet. This lays the overlapping entries out as
 * extra rows instead — first-fit, so an hour with nothing to share stays on
 * the first row and the common case looks exactly as it always has.
 *
 * Returns one cell-row per lane, always at least one (an empty day still
 * needs its row drawn).
 */
export function buildDayLanes<T extends HasPlacement>(
  day: Day,
  slots: GridSlot[],
  entries: T[]
): DayCell<T>[][] {
  const forDay = entries
    .filter((e) => e.dayOfWeek === day)
    // Earliest first, so lane assignment is stable and the "extra" row is
    // the later-added class rather than whichever the API happened to
    // return first. Sort is stable, so equal starts keep their input order.
    .slice()
    .sort((a, b) => a.startPeriod - b.startPeriod)

  const covers = (e: T, period: number) =>
    period >= e.startPeriod && period < e.startPeriod + e.periodSpan

  const clashes = (lane: T[], entry: T) =>
    lane.some((other) => {
      for (let p = entry.startPeriod; p < entry.startPeriod + entry.periodSpan; p++) {
        if (covers(other, p)) return true
      }
      return false
    })

  const lanes: T[][] = []
  for (const entry of forDay) {
    const lane = lanes.find((l) => !clashes(l, entry))
    if (lane) lane.push(entry)
    else lanes.push([entry])
  }

  if (lanes.length === 0) return [buildDayCells(day, slots, [])]
  return lanes.map((lane) => buildDayCells(day, slots, lane))
}

/** Day codes to the labels printed on the sheet. */
export const DAY_LABEL: Record<Day, string> = {
  MON: "MON",
  TUE: "TUE",
  WED: "WED",
  THU: "THU",
  FRI: "FRI",
  SAT: "SAT",
  SUN: "SUN",
}

/** "13:20" -> "01:20", matching the printed timetable's 12-hour afternoons. */
export function displayTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number)
  const hour12 = h > 12 ? h - 12 : h
  return `${String(hour12).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}
