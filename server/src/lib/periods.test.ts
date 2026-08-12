import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { buildDayGrid, dayEndTime, validLabStartPeriods } from "./periods.js"

/**
 * Reverse-engineered from the college's real 4th-year CSM sheet:
 * 08:00-08:50, 08:50-09:40, break, 10:00-10:50, 10:50-11:40,
 * 11:40-12:30, lunch, 13:20-14:10, 14:10-15:00.
 */
const SAMPLE = {
  startTime: "08:00",
  numPeriods: 7,
  periodDurationMin: 50,
  breakAfterPeriod: 2,
  breakDurationMin: 20,
  lunchAfterPeriod: 5,
  lunchDurationMin: 50,
}

describe("period grid", () => {
  test("reproduces the real timetable's clock times", () => {
    const grid = buildDayGrid(SAMPLE)
    const summary = grid.map((s) => `${s.kind}:${s.startTime}-${s.endTime}`)

    assert.deepEqual(summary, [
      "PERIOD:08:00-08:50",
      "PERIOD:08:50-09:40",
      "BREAK:09:40-10:00",
      "PERIOD:10:00-10:50",
      "PERIOD:10:50-11:40",
      "PERIOD:11:40-12:30",
      "LUNCH:12:30-13:20",
      "PERIOD:13:20-14:10",
      "PERIOD:14:10-15:00",
    ])
  })

  test("day ends at 3pm as printed on the sheet", () => {
    assert.equal(dayEndTime(SAMPLE), "15:00")
  })

  test("period numbers skip break and lunch slots", () => {
    const periods = buildDayGrid(SAMPLE)
      .filter((s) => s.kind === "PERIOD")
      .map((s) => s.period)
    assert.deepEqual(periods, [1, 2, 3, 4, 5, 6, 7])
  })

  test("9:00 start with 60-minute periods just works", () => {
    const cfg = { ...SAMPLE, startTime: "09:00", periodDurationMin: 60, lunchDurationMin: 60 }
    const grid = buildDayGrid(cfg)
    assert.equal(grid[0].startTime, "09:00")
    assert.equal(grid[0].endTime, "10:00")
    assert.equal(dayEndTime(cfg), "17:20")
  })

  test("zero-length break produces no break slot", () => {
    const grid = buildDayGrid({ ...SAMPLE, breakDurationMin: 0 })
    assert.equal(grid.filter((s) => s.kind === "BREAK").length, 0)
  })
})

describe("lab windows", () => {
  test("a lab may not straddle the morning break", () => {
    // Break is after period 2, so windows 1-3 and 2-4 are impossible.
    const starts = validLabStartPeriods(SAMPLE)
    assert.ok(!starts.includes(1), "1-2-3 crosses the break")
    assert.ok(!starts.includes(2), "2-3-4 crosses the break")
  })

  test("a lab MAY run across lunch", () => {
    // Lunch is after period 5; window 4-5-6 spans it and is allowed,
    // because lunch is not a teaching period.
    const starts = validLabStartPeriods(SAMPLE)
    assert.ok(starts.includes(4), "4-5-6 spans lunch and should be allowed")
  })

  test("the real timetable allows exactly periods 3, 4 and 5 as lab starts", () => {
    assert.deepEqual(validLabStartPeriods(SAMPLE), [3, 4, 5])
  })

  test("no window can start so late that it overruns the day", () => {
    const starts = validLabStartPeriods(SAMPLE)
    assert.ok(!starts.includes(6), "6-7-8 would need an 8th period")
  })

  test("moving the break moves the blocked windows", () => {
    const starts = validLabStartPeriods({ ...SAMPLE, breakAfterPeriod: 4 })
    assert.ok(!starts.includes(3), "3-4-5 now crosses the break")
    assert.ok(starts.includes(1), "1-2-3 is now clear of the break")
  })

  test("a day too short for three periods yields no lab windows", () => {
    assert.deepEqual(validLabStartPeriods({ ...SAMPLE, numPeriods: 2 }), [])
  })
})
