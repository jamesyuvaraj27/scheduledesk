import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { buildDayCells, buildDayLanes, displayTime } from "./gridLayout.js"
import type { GridSlot, Day } from "@/lib/types"

/** The real 8:00-3:00 day: break after period 2, lunch after period 5. */
const SLOTS: GridSlot[] = [
  { kind: "PERIOD", period: 1, startTime: "08:00", endTime: "08:50", durationMin: 50 },
  { kind: "PERIOD", period: 2, startTime: "08:50", endTime: "09:40", durationMin: 50 },
  { kind: "BREAK", period: null, startTime: "09:40", endTime: "10:00", durationMin: 20 },
  { kind: "PERIOD", period: 3, startTime: "10:00", endTime: "10:50", durationMin: 50 },
  { kind: "PERIOD", period: 4, startTime: "10:50", endTime: "11:40", durationMin: 50 },
  { kind: "PERIOD", period: 5, startTime: "11:40", endTime: "12:30", durationMin: 50 },
  { kind: "LUNCH", period: null, startTime: "12:30", endTime: "13:20", durationMin: 50 },
  { kind: "PERIOD", period: 6, startTime: "13:20", endTime: "14:10", durationMin: 50 },
  { kind: "PERIOD", period: 7, startTime: "14:10", endTime: "15:00", durationMin: 50 },
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

describe("lanes for shared hours", () => {
  test("a day with nothing overlapping is a single lane", () => {
    const lanes = buildDayLanes<E>("MON", SLOTS, [
      e({ id: "a", startPeriod: 1 }),
      e({ id: "b", startPeriod: 3 }),
    ])
    assert.equal(lanes.length, 1)
    assert.deepEqual(shape(lanes[0]), [
      "a:1", "_2", "BREAK", "b:1", "_4", "_5", "LUNCH", "_6", "_7",
    ])
  })

  test("an empty day still yields one lane, so the row is drawn", () => {
    const lanes = buildDayLanes<E>("MON", SLOTS, [])
    assert.equal(lanes.length, 1)
    assert.deepEqual(shape(lanes[0]), [
      "_1", "_2", "BREAK", "_3", "_4", "_5", "LUNCH", "_6", "_7",
    ])
  })

  test("two classes in one hour become two lanes, neither lost", () => {
    // The combined-section and shared-room case. Before lanes existed the
    // second of these silently overwrote the first and vanished.
    const lanes = buildDayLanes<E>("MON", SLOTS, [
      e({ id: "csm-a", startPeriod: 1 }),
      e({ id: "csm-b", startPeriod: 1 }),
    ])
    assert.equal(lanes.length, 2)
    assert.deepEqual(shape(lanes[0])[0], "csm-a:1")
    assert.deepEqual(shape(lanes[1])[0], "csm-b:1")
  })

  test("only the shared hour spills over; the rest stays on lane one", () => {
    // The point the spec is emphatic about: one shared hour must not
    // duplicate a whole timetable.
    const lanes = buildDayLanes<E>("MON", SLOTS, [
      e({ id: "shared-a", startPeriod: 1 }),
      e({ id: "shared-b", startPeriod: 1 }),
      e({ id: "solo", startPeriod: 4 }),
    ])
    assert.equal(lanes.length, 2)
    assert.deepEqual(shape(lanes[0]), [
      "shared-a:1", "_2", "BREAK", "_3", "solo:1", "_5", "LUNCH", "_6", "_7",
    ])
    // Lane two carries the extra class and nothing else.
    assert.deepEqual(shape(lanes[1]), [
      "shared-b:1", "_2", "BREAK", "_3", "_4", "_5", "LUNCH", "_6", "_7",
    ])
  })

  test("a second lane is reused across the day rather than stacking up", () => {
    const lanes = buildDayLanes<E>("MON", SLOTS, [
      e({ id: "a1", startPeriod: 1 }),
      e({ id: "a2", startPeriod: 1 }),
      e({ id: "b1", startPeriod: 4 }),
      e({ id: "b2", startPeriod: 4 }),
    ])
    assert.equal(lanes.length, 2, "two shared hours still need only two lanes")
    assert.deepEqual(shape(lanes[1]), [
      "a2:1", "_2", "BREAK", "_3", "b2:1", "_5", "LUNCH", "_6", "_7",
    ])
  })

  test("three in one hour give three lanes", () => {
    const lanes = buildDayLanes<E>("MON", SLOTS, [
      e({ id: "x", startPeriod: 2 }),
      e({ id: "y", startPeriod: 2 }),
      e({ id: "z", startPeriod: 2 }),
    ])
    assert.equal(lanes.length, 3)
  })

  test("a lab overlapping a single class pushes only that class down", () => {
    const lanes = buildDayLanes<E>("MON", SLOTS, [
      e({ id: "lab", startPeriod: 3, periodSpan: 3 }),
      e({ id: "clash", startPeriod: 4 }),
    ])
    assert.equal(lanes.length, 2)
    assert.deepEqual(shape(lanes[0]), [
      "_1", "_2", "BREAK", "lab:3", "LUNCH", "_6", "_7",
    ])
    assert.deepEqual(shape(lanes[1]), [
      "_1", "_2", "BREAK", "_3", "clash:1", "_5", "LUNCH", "_6", "_7",
    ])
  })

  test("other days are still ignored", () => {
    const lanes = buildDayLanes<E>("MON", SLOTS, [
      e({ id: "tue1", dayOfWeek: "TUE", startPeriod: 1 }),
      e({ id: "tue2", dayOfWeek: "TUE", startPeriod: 1 }),
    ])
    assert.equal(lanes.length, 1, "Tuesday's shared hour must not widen Monday")
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
