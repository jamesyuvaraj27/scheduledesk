import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { buildDayGrid } from "./periods.js"
import {
  parseTimetableSheet,
  normalizeTimeRow,
  parseLegend,
  normalizeCode,
} from "./importer.js"

const CONFIG = {
  startTime: "08:00",
  numPeriods: 7,
  periodDurationMin: 50,
  breakAfterPeriod: 2,
  breakDurationMin: 20,
  lunchAfterPeriod: 5,
  lunchDurationMin: 50,
}
const SLOTS = buildDayGrid(CONFIG)

/**
 * The real 4th-year CSM sheet, transcribed as Excel would hand it over with
 * merged cells expanded. Column 0 is the day label; break and lunch sit in
 * their own columns spelled out vertically (hence the stray letters).
 */
const SAMPLE: string[][] = [
  ["Year & Sem : IV - I(CSM)", "", "", "", "", "", "", "", "", ""],
  ["Time", "08:00", "08:50", "09:40", "10:00", "10:50", "11:40", "12:30", "01:20", "02:10"],
  ["Day",  "08:50", "09:40", "10:00", "10:50", "11:40", "12:30", "01:20", "02:10", "03:00"],
  ["MON", "RL",   "NPTEL(SWM)", "B", "HRPM", "BDA",  "ESIA", "L", "BCT",  "NPTEL(SWM)"],
  ["TUE", "BDA",  "HRPM",       "R", "RL",   "HRPM", "BCT",  "U", "ESIA", "BCT"],
  ["WED", "ESIA", "RL",         "E", "BCT",  "BDA",  "ESIA", "N", "BDA",  "HRPM"],
  ["THU", "BDA",  "HRPM",       "A", "ESIA", "PE LAB", "PE LAB", "C", "PE LAB", ""],
  ["FRI", "HRPM", "RL",         "K", "BDA",  "NPTEL(SWM)", "NPTEL(SWM)", "H", "BCT", "HRPM"],
  ["SAT", "NPTEL(SWM)", "ESIA", "",  "RL",   "NPTEL(SWM)", "BCT", "", "PE LAB", "PE LAB"],
  ["", "", "", "", "", "", "", "", "", ""],
  ["RL:", "Dr. R Arichandran", "", "", "", "PE LAB:", "Dr. R Arichandran", "", "", ""],
  ["BCT:", "Mr. V Paparao", "", "", "", "NPTEL(SWM):", "Ms. G. Sujini", "", "", ""],
  ["HRPM:", "Ms. P. Venkata Ramana", "", "", "", "", "", "", "", ""],
  ["ESIA:", "Mr. K Sriramulu", "", "", "", "", "", "", "", ""],
  ["BDA:", "Ms. K. Ramya Yashoda Lakshmi", "", "", "", "", "", "", "", ""],
]

const find = (r: ReturnType<typeof parseTimetableSheet>, day: string, period: number) =>
  r.entries.find((e) => e.dayOfWeek === day && e.startPeriod === period)

describe("12-hour afternoon times", () => {
  test("times after noon are read as afternoon", () => {
    assert.deepEqual(
      normalizeTimeRow(["08:00", "11:40", "12:30", "01:20", "02:10"]),
      ["08:00", "11:40", "12:30", "13:20", "14:10"]
    )
  })

  test("non-time cells become null", () => {
    assert.deepEqual(normalizeTimeRow(["Time", "08:00", "MON"]), [null, "08:00", null])
  })

  test("morning times are left alone", () => {
    assert.deepEqual(normalizeTimeRow(["08:00", "08:50"]), ["08:00", "08:50"])
  })
})

describe("parsing the real sample sheet", () => {
  const result = parseTimetableSheet(SAMPLE, SLOTS, CONFIG.numPeriods)

  test("reads without error", () => {
    assert.equal(result.error, undefined)
  })

  test("finds all six teaching days", () => {
    const days = [...new Set(result.entries.map((e) => e.dayOfWeek))]
    assert.deepEqual(days.sort(), ["FRI", "MON", "SAT", "THU", "TUE", "WED"])
  })

  test("maps columns to the right period numbers", () => {
    // MON: RL at 08:00 is period 1; BCT at 01:20 is period 6.
    assert.equal(find(result, "MON", 1)?.code, "RL")
    assert.equal(find(result, "MON", 6)?.code, "BCT")
    assert.equal(find(result, "MON", 7)?.code, "NPTEL(SWM)")
  })

  test("skips the break and lunch columns entirely", () => {
    // The vertical "B R E A K" / "L U N C H" letters must not become subjects.
    for (const code of result.codes) {
      assert.ok(
        !["B", "R", "E", "A", "K", "L", "U", "N", "C", "H"].includes(code),
        `stray letter "${code}" leaked in from a pause column`
      )
    }
  })

  test("collapses a 3-period lab into one block", () => {
    // THU: PE LAB runs 11:40, 12:30(lunch skipped), 01:20 -> periods 4,5,6.
    const lab = find(result, "THU", 4)
    assert.equal(lab?.code, "PE LAB")
    assert.equal(lab?.periodSpan, 3)
    assert.equal(lab?.looksLikeLab, true)
  })

  test("a lab may span lunch, exactly as on the sheet", () => {
    const thu = result.entries.filter((e) => e.dayOfWeek === "THU")
    assert.equal(thu.filter((e) => e.code === "PE LAB").length, 1, "should be one block, not three")
  })

  test("consecutive identical theory hours merge", () => {
    // FRI has NPTEL(SWM) twice in a row -> flagged, split into single hours.
    const fri = result.entries.filter((e) => e.dayOfWeek === "FRI" && e.code === "NPTEL(SWM)")
    assert.equal(fri.length, 2, "a 2-period run is split into two single hours")
    assert.ok(result.warnings.some((w) => w.includes("FRI") && w.includes("2 periods")))
  })

  test("collects every distinct subject code", () => {
    assert.deepEqual(result.codes, [
      "BCT", "BDA", "ESIA", "HRPM", "NPTEL(SWM)", "PE LAB", "RL",
    ])
  })

  test("reads the faculty legend from split cells", () => {
    const byCode = Object.fromEntries(result.legend.map((l) => [l.code, l.facultyName]))
    assert.equal(byCode["RL"], "Dr. R Arichandran")
    assert.equal(byCode["BDA"], "Ms. K. Ramya Yashoda Lakshmi")
    assert.equal(byCode["NPTEL(SWM)"], "Ms. G. Sujini")
    assert.equal(byCode["PE LAB"], "Dr. R Arichandran")
  })

  test("does not mistake the time header for legend entries", () => {
    assert.ok(!result.legend.some((l) => /^\d/.test(l.code)))
  })

  test("every entry lands inside the configured day", () => {
    for (const e of result.entries) {
      assert.ok(
        e.startPeriod >= 1 && e.startPeriod + e.periodSpan - 1 <= CONFIG.numPeriods,
        `${e.dayOfWeek} ${e.code} runs outside the day`
      )
    }
  })
})

describe("refusing to guess", () => {
  test("a sheet with no day rows is rejected", () => {
    const result = parseTimetableSheet([["Time", "08:00"], ["", "RL"]], SLOTS, 7)
    assert.match(result.error ?? "", /No day rows/)
  })

  test("timings that don't match the term are rejected with guidance", () => {
    const wrong = SAMPLE.map((row) => [...row])
    wrong[1] = ["Time", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]
    wrong[2] = ["Day", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]
    const result = parseTimetableSheet(wrong, SLOTS, 7)
    assert.match(result.error ?? "", /don't match the term's daily timings/)
    assert.match(result.error ?? "", /Update Term Setup/)
  })

  test("falls back to column order when there is no time header, and says so", () => {
    const noTimes = [
      ["MON", "RL", "BDA"],
      ["TUE", "ESIA", "BCT"],
    ]
    const result = parseTimetableSheet(noTimes, SLOTS, 7)
    assert.equal(result.error, undefined)
    assert.ok(result.warnings.some((w) => w.includes("matched by position")))
    assert.equal(result.entries.find((e) => e.dayOfWeek === "MON")?.code, "RL")
  })
})

describe("cell tidying", () => {
  test("codes are upper-cased and whitespace collapsed", () => {
    assert.equal(normalizeCode("  pe   lab "), "PE LAB")
  })

  test("blank and placeholder cells are not subjects", () => {
    const rows = [
      ["Time", "08:00", "08:50"],
      ["Day", "08:50", "09:40"],
      ["MON", "-", "NIL"],
    ]
    assert.equal(parseTimetableSheet(rows, SLOTS, 7).entries.length, 0)
  })

  test("legend ignores rows it was told to skip", () => {
    const legend = parseLegend([["RL:", "Dr X"]], new Set([0]))
    assert.deepEqual(legend, [])
  })
})
