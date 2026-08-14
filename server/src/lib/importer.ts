/**
 * Reading an existing timetable sheet.
 *
 * The premise of the whole app is that 3rd/4th year timetables already exist
 * and 2nd year is built around them. Retyping those by hand is hours of
 * clicking, so this reads the sheets the office already keeps in Excel.
 *
 * Pure, like the conflict engine: the caller hands in a 2D grid of cell
 * strings (merged cells already expanded) and gets back structured entries
 * plus a list of everything it wasn't sure about. It never guesses silently —
 * anything ambiguous becomes a warning for a human to confirm.
 */

import type { GridSlot } from "./periods.js"
import type { Day } from "./scheduling.js"

export const DAY_NAMES: Record<string, Day> = {
  MON: "MON", MONDAY: "MON",
  TUE: "TUE", TUES: "TUE", TUESDAY: "TUE",
  WED: "WED", WEDS: "WED", WEDNESDAY: "WED",
  THU: "THU", THUR: "THU", THURS: "THU", THURSDAY: "THU",
  FRI: "FRI", FRIDAY: "FRI",
  SAT: "SAT", SATURDAY: "SAT",
  SUN: "SUN", SUNDAY: "SUN",
}

export interface ParsedEntry {
  dayOfWeek: Day
  startPeriod: number
  periodSpan: number
  /** The subject code exactly as written in the sheet. */
  code: string
  /** True when the block covers several periods or the code says "LAB". */
  looksLikeLab: boolean
}

export interface ParsedLegend {
  code: string
  facultyName: string
}

export interface ParseResult {
  entries: ParsedEntry[]
  legend: ParsedLegend[]
  /** Distinct subject codes found in the grid. */
  codes: string[]
  warnings: string[]
  /** Set when the sheet couldn't be read at all. */
  error?: string
}

const TIME_RE = /^(\d{1,2})[:.](\d{2})$/

/** "1:20" after noon means 13:20. Times in a row only ever move forward. */
export function normalizeTimeRow(cells: string[]): (string | null)[] {
  const out: (string | null)[] = []
  let previousMinutes = -1

  for (const raw of cells) {
    const match = TIME_RE.exec(String(raw ?? "").trim())
    if (!match) {
      out.push(null)
      continue
    }

    let hour = Number(match[1])
    const minute = Number(match[2])
    if (hour > 23 || minute > 59) {
      out.push(null)
      continue
    }

    // A 12-hour clock restarts at 1 after noon; bump it once we've gone back.
    let minutes = hour * 60 + minute
    while (minutes < previousMinutes && hour < 12) {
      hour += 12
      minutes = hour * 60 + minute
    }

    previousMinutes = minutes
    out.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`)
  }

  return out
}

function cell(rows: string[][], r: number, c: number): string {
  return String(rows[r]?.[c] ?? "").trim()
}

/** Which row looks like a row of clock times? */
function findTimeRows(rows: string[][]): number[] {
  const hits: number[] = []
  rows.forEach((row, i) => {
    const times = row.filter((c) => TIME_RE.test(String(c ?? "").trim())).length
    if (times >= 3) hits.push(i)
  })
  return hits
}

function findDayRows(rows: string[][]): { rowIndex: number; day: Day; col: number }[] {
  const found: { rowIndex: number; day: Day; col: number }[] = []
  const seen = new Set<Day>()

  rows.forEach((row, rowIndex) => {
    for (let col = 0; col < Math.min(row.length, 4); col++) {
      const key = String(row[col] ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "")
      const day = DAY_NAMES[key]
      if (day && !seen.has(day)) {
        seen.add(day)
        found.push({ rowIndex, day, col })
        return
      }
    }
  })

  return found
}

/**
 * Map sheet columns to period numbers by matching the sheet's own start
 * times against the grid computed from the term's settings. If they don't
 * line up, that's a real problem worth stopping for — the timings in Term
 * Setup should describe the sheet being imported.
 */
function mapColumns(
  startTimes: (string | null)[],
  slots: GridSlot[]
): {
  columnToPeriod: Map<number, number>
  matched: number
  /** Times that line up with ANY slot, including break and lunch. */
  recognized: number
  total: number
  unmatched: string[]
} {
  const columnToPeriod = new Map<number, number>()
  const unmatched: string[] = []
  let matched = 0
  let recognized = 0
  let total = 0

  const byStart = new Map<string, GridSlot>()
  for (const slot of slots) byStart.set(slot.startTime, slot)

  startTimes.forEach((time, col) => {
    if (!time) return
    total++
    const slot = byStart.get(time)
    if (!slot) {
      unmatched.push(time)
      return
    }
    recognized++
    if (slot.kind === "PERIOD" && slot.period != null) {
      columnToPeriod.set(col, slot.period)
      matched++
    }
    // break/lunch columns are simply not mapped, so their cells are skipped
  })

  return { columnToPeriod, matched, recognized, total, unmatched }
}

/**
 * A stray coincidental match shouldn't be enough to accept a sheet built on
 * different timings — most of its columns have to line up.
 */
const MIN_TIME_MATCH_RATIO = 0.6

/**
 * Fallback when the sheet has no usable time header: take the non-empty
 * columns after the day label in order. Less reliable, so it warns.
 */
function mapColumnsPositionally(
  rows: string[][],
  dayRows: { rowIndex: number; col: number }[],
  numPeriods: number
): Map<number, number> {
  const columnToPeriod = new Map<number, number>()
  const firstDay = dayRows[0]
  if (!firstDay) return columnToPeriod

  const width = Math.max(...dayRows.map((d) => rows[d.rowIndex]?.length ?? 0))
  let period = 1

  for (let col = firstDay.col + 1; col < width && period <= numPeriods; col++) {
    // Skip columns that spell out BREAK/LUNCH anywhere in the day rows.
    const isPause = dayRows.some((d) => {
      const v = cell(rows, d.rowIndex, col).toUpperCase().replace(/[^A-Z]/g, "")
      return v === "BREAK" || v === "LUNCH" || v === "B" || v === "L"
    })
    if (isPause) continue
    columnToPeriod.set(col, period)
    period++
  }

  return columnToPeriod
}

const LEGEND_RE = /^([A-Za-z0-9()\-&/. ]{1,20}?)\s*:\s*(.{2,80})$/

/**
 * Legend lines look like "RL: Dr. R Arichandran". Excel splits these two
 * ways — all in one cell, or the label in one cell and the name in the next.
 */
export function parseLegend(rows: string[][], skipRows: Set<number>): ParsedLegend[] {
  const out: ParsedLegend[] = []
  const seen = new Set<string>()

  const add = (code: string, name: string) => {
    const key = code.trim().toUpperCase()
    const value = name.trim()
    if (!key || !value || seen.has(key)) return
    if (/^\d/.test(key)) return // "08:50" style noise
    seen.add(key)
    out.push({ code: key, facultyName: value })
  }

  rows.forEach((row, r) => {
    if (skipRows.has(r)) return
    row.forEach((raw, c) => {
      const text = String(raw ?? "").trim()
      if (!text) return

      const inline = LEGEND_RE.exec(text)
      if (inline && !TIME_RE.test(text)) {
        add(inline[1], inline[2])
        return
      }

      // "RL:" in this cell, the name in the next non-empty cell.
      if (text.endsWith(":")) {
        const code = text.slice(0, -1)
        for (let k = c + 1; k < row.length; k++) {
          const next = String(row[k] ?? "").trim()
          if (next) {
            add(code, next)
            break
          }
        }
      }
    })
  })

  return out
}

/** Cell values that mean "nothing scheduled" rather than a subject. */
const IGNORED_CODES = new Set([
  "", "-", "--", "NIL", "FREE", "X", "BREAK", "LUNCH", "B", "R", "E", "A", "K",
  "L", "U", "N", "C", "H",
])

function isIgnorable(code: string): boolean {
  return IGNORED_CODES.has(code.trim().toUpperCase())
}

/** Tidy a cell into a comparable subject code. */
export function normalizeCode(raw: string): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
}

export function parseTimetableSheet(
  rows: string[][],
  slots: GridSlot[],
  numPeriods: number
): ParseResult {
  const warnings: string[] = []

  const dayRows = findDayRows(rows)
  if (dayRows.length === 0) {
    return {
      entries: [],
      legend: [],
      codes: [],
      warnings: [],
      error:
        "No day rows found. The sheet needs a row per day starting with MON, TUE, WED and so on.",
    }
  }

  // Prefer the sheet's own clock times; fall back to column order.
  const timeRowIndexes = findTimeRows(rows)
  let columnToPeriod: Map<number, number>

  if (timeRowIndexes.length > 0) {
    const startTimes = normalizeTimeRow(rows[timeRowIndexes[0]])
    const mapped = mapColumns(startTimes, slots)

    const ratio = mapped.total > 0 ? mapped.recognized / mapped.total : 0
    if (mapped.matched === 0 || ratio < MIN_TIME_MATCH_RATIO) {
      return {
        entries: [],
        legend: [],
        codes: [],
        warnings: [],
        error:
          "The times in this sheet don't match the term's daily timings. " +
          `The sheet starts periods at ${startTimes.filter(Boolean).slice(0, 3).join(", ")}, ` +
          `but this term expects ${slots.filter((s) => s.kind === "PERIOD").slice(0, 3).map((s) => s.startTime).join(", ")}. ` +
          "Update Term Setup to match the sheet, then import again.",
      }
    }

    if (mapped.unmatched.length) {
      warnings.push(
        `Ignored ${mapped.unmatched.length} column(s) whose times aren't in this term's grid: ${mapped.unmatched.join(", ")}.`
      )
    }
    columnToPeriod = mapped.columnToPeriod
  } else {
    warnings.push(
      "No time header row found, so columns were matched by position. Check the preview carefully."
    )
    columnToPeriod = mapColumnsPositionally(rows, dayRows, numPeriods)
  }

  if (columnToPeriod.size === 0) {
    return {
      entries: [],
      legend: [],
      codes: [],
      warnings,
      error: "Could not work out which columns are periods.",
    }
  }

  // Read each day row into period -> code, then collapse runs of the same
  // code into a single block (that's how a 3-period lab appears).
  const entries: ParsedEntry[] = []
  const codes = new Set<string>()
  const periodColumns = [...columnToPeriod.entries()].sort((a, b) => a[1] - b[1])

  for (const { rowIndex, day } of dayRows) {
    const byPeriod = new Map<number, string>()
    for (const [col, period] of periodColumns) {
      const raw = cell(rows, rowIndex, col)
      const code = normalizeCode(raw)
      if (!isIgnorable(code)) byPeriod.set(period, code)
    }

    let period = 1
    while (period <= numPeriods) {
      const code = byPeriod.get(period)
      if (!code) {
        period++
        continue
      }

      let span = 1
      while (byPeriod.get(period + span) === code) span++

      // Any run of identical codes is one multi-period block. Only labs can
      // span more than a period, so a wide block is imported as a lab; the
      // admin is told when the code doesn't obviously read like one.
      const namedLab = /\bLABS?\b/.test(code)
      const looksLikeLab = span > 1 || namedLab

      if (span > 1 && !namedLab) {
        warnings.push(
          `${day}: "${code}" covers ${span} periods, so it was imported as a ${span}-period lab. Change it if that isn't right.`
        )
      }

      entries.push({
        dayOfWeek: day,
        startPeriod: period,
        periodSpan: span,
        code,
        looksLikeLab,
      })

      codes.add(code)
      period += span
    }
  }

  const skipRows = new Set(dayRows.map((d) => d.rowIndex))
  for (const i of timeRowIndexes) skipRows.add(i)
  const legend = parseLegend(rows, skipRows)

  return {
    entries,
    legend,
    codes: [...codes].sort(),
    warnings,
  }
}
