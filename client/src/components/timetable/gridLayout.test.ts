import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { buildDayCells, displayTime } from "./gridLayout.js"
import type { GridSlot, Day } from "@/lib/types"

/** The real 8:00-3:00 day: break after period 2, lunch after period 5. */
const SLOTS: GridSlot[] = [
  { kind: "PERIOD", period: 1, startTime: "08:00", endTime: "08:50" },
  { kind: "PERIOD", period: 2, startTime: "08:50", endTime: "09:40" },
  { kind: "BREAK", period: null, startTime: "09:40", endTime: "10:00" },
  { kind: "PERIOD", period: 3, startTime: "10:00", endTime: "10:50" },
  { kind: "PERIOD", period: 4, startTime: "10:50", endTime: "11:40" },
  { kind: "PERIOD", period: 5, startTime: "11:40", endTime: "12:30" },
  { kind: "LUNCH", period: null, startTime: "12:30", endTime: "13:20" },
  { kind: "PERIOD", period: 6, startTime: "13:20", endTime: "14:10" },
  { kind: "PERIOD", period: 7, startTime: "14:10", endTime: "15:00" },
]

interface E {
  id: string
  dayOfWeek: Day
  startPeriod: number
  periodSpan: number
}
const e = (o: Partial<E>): E => ({
  id: "x",
  dayOfWeek: "MON",
  startPeriod: 1,
  periodSpan: 1,
  ...o,
})

const shape = (cells: ReturnType<typeof buildDayCells<E>>) =>
  cells.map((c) =>
    c.kind === "entry"
      ? `${c.entry.id}:${c.colSpan}${c.isFirstRun ? "" : "+"}`
      : c.kind === "pause"
        ? c.label
        : `_${c.period}`
  )

describe("day cell layout", () => {
  test("an empty day is all empty cells plus the two pauses", () => {
    assert.deepEqual(shape(buildDayCells<E>("MON", SLOTS, [])), [
      "_1", "_2", "BREAK", "_3", "_4", "_5", "LUNCH", "_6", "_7",
    ])
  })

  test("a single theory class occupies one column", () => {
    const cells = buildDayCells<E>("MON", SLOTS, [e({ id: "ml", startPeriod: 3 })])
    assert.deepEqual(shape(cells), [
      "_1", "_2", "BREAK", "ml:1", "_4", "_5", "LUNCH", "_6", "_7",
    ])
  })

  test("a lab wholly before lunch spans three columns as one cell", () => {
    const cells = buildDayCells<E>("MON", SLOTS, [
      e({ id: "lab", startPeriod: 3, periodSpan: 3 }),
    ])
    assert.deepEqual(shape(cells), [
      "_1", "_2", "BREAK", "lab:3", "LUNCH", "_6", "_7",
    ])
  })

  test("a lab spanning lunch splits into two runs, never swallowing lunch", () => {
    // Periods 4,5,6 with lunch between 5 and 6 must render as
    // [P4-P5 spanned][LUNCH][P6] — three cells, not one colSpan of 3.
    const cells = buildDayCells<E>("MON", SLOTS, [
      e({ id: "lab", startPeriod: 4, periodSpan: 3 }),
    ])
    assert.deepEqual(shape(cells), [
      "_1", "_2", "BREAK", "_3", "lab:2", "LUNCH", "lab:1+", "_7",
    ])
  })

  test("the continuation run is flagged so only the first shows a label", () => {
    const cells = buildDayCells<E>("MON", SLOTS, [
      e({ id: "lab", startPeriod: 4, periodSpan: 3 }),
    ])
    const runs = cells.filter((c) => c.kind === "entry")
    assert.equal(runs.length, 2)
    assert.equal(runs[0].kind === "entry" && runs[0].isFirstRun, true)
    assert.equal(runs[1].kind === "entry" && runs[1].isFirstRun, false)
  })

  test("a lab at the end of the day spans its final two columns", () => {
    const cells = buildDayCells<E>("MON", SLOTS, [
      e({ id: "lab", startPeriod: 5, periodSpan: 3 }),
    ])
    assert.deepEqual(shape(cells), [
      "_1", "_2", "BREAK", "_3", "_4", "lab:1", "LUNCH", "lab:2+", 
    ])
  })

  test("entries from other days are ignored", () => {
    const cells = buildDayCells<E>("MON", SLOTS, [
      e({ id: "tue", dayOfWeek: "TUE", startPeriod: 1 }),
    ])
    assert.deepEqual(shape(cells), [
      "_1", "_2", "BREAK", "_3", "_4", "_5", "LUNCH", "_6", "_7",
    ])
  })

  test("back-to-back classes stay separate cells", () => {
    const cells = buildDayCells<E>("MON", SLOTS, [
      e({ id: "a", startPeriod: 1 }),
      e({ id: "b", startPeriod: 2 }),
    ])
    assert.deepEqual(shape(cells), [
      "a:1", "b:1", "BREAK", "_3", "_4", "_5", "LUNCH", "_6", "_7",
    ])
  })

  test("a class either side of the break does not merge", () => {
    const cells = buildDayCells<E>("MON", SLOTS, [
      e({ id: "a", startPeriod: 2 }),
      e({ id: "b", startPeriod: 3 }),
    ])
    assert.deepEqual(shape(cells), [
      "_1", "a:1", "BREAK", "b:1", "_4", "_5", "LUNCH", "_6", "_7",
    ])
  })
})

describe("time display", () => {
  test("morning times are unchanged", () => {
    assert.equal(displayTime("08:00"), "08:00")
    assert.equal(displayTime("11:40"), "11:40")
  })
  test("afternoon times print as 12-hour, like the sheet", () => {
    assert.equal(displayTime("13:20"), "01:20")
    assert.equal(displayTime("15:00"), "03:00")
  })
  test("noon stays 12", () => {
    assert.equal(displayTime("12:30"), "12:30")
  })
})
