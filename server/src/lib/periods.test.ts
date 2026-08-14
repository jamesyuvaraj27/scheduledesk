import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  buildDayGrid,
  dayEndTime,
  periodDuration,
  validStartPeriods,
} from "./periods.js"

/**
 * Reverse-engineered from the college's real 4th-year CSM sheet, with the
 * morning and afternoon lengths set equal so it reproduces the printed times:
 * 08:00-08:50, 08:50-09:40, break, 10:00-10:50, 10:50-11:40,
 * 11:40-12:30, lunch, 13:20-14:10, 14:10-15:00.
 */
const SAMPLE = {
  startTime: "08:00",
  numPeriods: 7,
  morningPeriodDurationMin: 50,
  afternoonPeriodDurationMin: 50,
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

  test("zero-length break produces no break slot", () => {
    const grid = buildDayGrid({ ...SAMPLE, breakDurationMin: 0 })
    assert.equal(grid.filter((s) => s.kind === "BREAK").length, 0)
  })
})

describe("morning and afternoon period lengths", () => {
  // The college runs 60-minute mornings and 50-minute afternoons.
  const SPLIT = {
    ...SAMPLE,
    startTime: "09:00",
    morningPeriodDurationMin: 60,
    afternoonPeriodDurationMin: 50,
  }

  test("periods up to and including lunch use the morning length", () => {
    for (const p of [1, 2, 3, 4, 5]) {
      assert.equal(periodDuration(SPLIT, p), 60, `period ${p}`)
    }
  })

  test("periods after lunch use the afternoon length", () => {
    assert.equal(periodDuration(SPLIT, 6), 50)
    assert.equal(periodDuration(SPLIT, 7), 50)
  })

  test("the grid shows the change in the clock times", () => {
    const grid = buildDayGrid(SPLIT)
    const periods = grid.filter((s) => s.kind === "PERIOD")

    // Morning: 60-minute blocks from 09:00, with a 20-minute break after P2.
    assert.equal(periods[0].startTime, "09:00")
    assert.equal(periods[0].endTime, "10:00")
    assert.equal(periods[0].durationMin, 60)

    // Afternoon: the first period after lunch is only 50 minutes.
    assert.equal(periods[5].durationMin, 50)
    assert.equal(periods[6].durationMin, 50)
  })

  test("a day with no lunch uses the morning length throughout", () => {
    const noLunch = { ...SPLIT, lunchDurationMin: 0 }
    assert.equal(periodDuration(noLunch, 7), 60)
  })

  test("end of day accounts for both lengths", () => {
    // 09:00 + 5x60 morning + 20 break + 50 lunch + 2x50 afternoon = 16:50
    assert.equal(dayEndTime(SPLIT), "16:50")
  })
})

describe("free-span placement windows", () => {
  test("a lab may now start anywhere it fits, including across the break", () => {
    // Break is after period 2, but that no longer blocks anything — the
    // admin decides where labs go.
    assert.deepEqual(validStartPeriods(SAMPLE, 3), [1, 2, 3, 4, 5])
  })

  test("a single period can start anywhere in the day", () => {
    assert.deepEqual(validStartPeriods(SAMPLE, 1), [1, 2, 3, 4, 5, 6, 7])
  })

  test("a span is refused only when it overruns the day", () => {
    assert.deepEqual(validStartPeriods(SAMPLE, 7), [1])
    assert.deepEqual(validStartPeriods(SAMPLE, 8), [])
  })

  test("a two-period lab is legal now that spans are free", () => {
    assert.deepEqual(validStartPeriods(SAMPLE, 2), [1, 2, 3, 4, 5, 6])
  })
})
