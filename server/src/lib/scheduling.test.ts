import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  validatePlacement,
  validateSection,
  computeAvailability,
  overlaps,
  facultyDailyLoad,
  type SchedulingContext,
  type PlacedEntry,
  type Candidate,
  type ConflictCode,
} from "./scheduling.js"

const TIME_CONFIG = {
  startTime: "08:00",
  numPeriods: 7,
  periodDurationMin: 50,
  breakAfterPeriod: 2,
  breakDurationMin: 20,
  lunchAfterPeriod: 5,
  lunchDurationMin: 50,
  workingDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
}

const SEC_A = "sec-aiml-a"
const SEC_B = "sec-aiml-b"
const SAI = "fac-sai"
const RAVI = "fac-ravi"
const ML = "sub-ml"
const DBMS_LAB = "sub-dbms-lab"
const ROOM_204 = "room-204"
const ROOM_205 = "room-205"
const LAB_1 = "room-lab1"

function context(overrides: Partial<SchedulingContext> = {}): SchedulingContext {
  return {
    timeConfig: TIME_CONFIG,
    entries: [],
    curriculum: [
      { subjectId: ML, subjectCode: "ML", weeklyTheoryHrs: 4, weeklyLabHrs: 0 },
      { subjectId: DBMS_LAB, subjectCode: "DBMSL", weeklyTheoryHrs: 0, weeklyLabHrs: 3 },
    ],
    assignments: new Map([
      [ML, SAI],
      [DBMS_LAB, SAI],
    ]),
    rooms: new Map([
      [ROOM_204, { id: ROOM_204, name: "Room 204", type: "CLASSROOM" }],
      [ROOM_205, { id: ROOM_205, name: "Room 205", type: "CLASSROOM" }],
      [LAB_1, { id: LAB_1, name: "Lab 1", type: "LAB" }],
    ]),
    names: {
      faculty: new Map([
        [SAI, "Sai Sir"],
        [RAVI, "Ravi Sir"],
      ]),
      sections: new Map([
        [SEC_A, "AIML-A"],
        [SEC_B, "AIML-B"],
      ]),
    },
    ...overrides,
  }
}

const theory = (over: Partial<Candidate> = {}): Candidate => ({
  sectionId: SEC_A,
  dayOfWeek: "MON",
  startPeriod: 1,
  periodSpan: 1,
  entryType: "THEORY",
  subjectId: ML,
  facultyId: SAI,
  roomId: ROOM_204,
  ...over,
})

const placed = (over: Partial<PlacedEntry> = {}): PlacedEntry => ({
  id: "e1",
  sectionId: SEC_A,
  dayOfWeek: "MON",
  startPeriod: 1,
  periodSpan: 1,
  entryType: "THEORY",
  subjectId: ML,
  facultyId: SAI,
  roomId: ROOM_204,
  ...over,
})

const codes = (cs: { code: ConflictCode }[]) => cs.map((c) => c.code)

describe("overlap arithmetic", () => {
  test("identical single periods overlap", () => {
    assert.equal(overlaps(3, 1, 3, 1), true)
  })
  test("adjacent single periods do not overlap", () => {
    assert.equal(overlaps(3, 1, 4, 1), false)
  })
  test("a 3-period lab overlaps a period inside it", () => {
    assert.equal(overlaps(3, 3, 5, 1), true)
  })
  test("a 3-period lab does not overlap the period after it", () => {
    assert.equal(overlaps(3, 3, 6, 1), false)
  })
  test("two labs sharing one period overlap", () => {
    assert.equal(overlaps(3, 3, 5, 3), true)
  })
})

describe("valid placements", () => {
  test("a clean theory placement has no conflicts", () => {
    assert.deepEqual(validatePlacement(theory(), context()), [])
  })

  test("a lab in a lab room at a valid start is fine", () => {
    const c = theory({
      entryType: "LAB",
      subjectId: DBMS_LAB,
      periodSpan: 3,
      startPeriod: 3,
      roomId: LAB_1,
    })
    assert.deepEqual(validatePlacement(c, context()), [])
  })

  test("a lab may span lunch", () => {
    const c = theory({
      entryType: "LAB",
      subjectId: DBMS_LAB,
      periodSpan: 3,
      startPeriod: 4, // periods 4,5,6 — lunch sits between 5 and 6
      roomId: LAB_1,
    })
    assert.deepEqual(validatePlacement(c, context()), [])
  })

  test("activities need no subject or faculty", () => {
    const c = theory({
      entryType: "LIBRARY",
      subjectId: null,
      facultyId: null,
      roomId: null,
    })
    assert.deepEqual(validatePlacement(c, context()), [])
  })
})

describe("clash detection", () => {
  test("a section cannot hold two classes at once", () => {
    const ctx = context({ entries: [placed({ startPeriod: 3 })] })
    const result = validatePlacement(theory({ startPeriod: 3 }), ctx)
    assert.ok(codes(result).includes("SECTION_CLASH"))
  })

  test("one faculty member cannot teach two sections at once", () => {
    const ctx = context({
      entries: [placed({ id: "other", sectionId: SEC_B, startPeriod: 3 })],
    })
    const result = validatePlacement(theory({ startPeriod: 3 }), ctx)
    assert.ok(codes(result).includes("FACULTY_CLASH"))
    assert.match(result[0].message, /Sai Sir/)
    assert.match(result[0].message, /AIML-B/)
  })

  test("faculty clash is detected across different years", () => {
    // Exactly the real scenario: 2nd year must fit around 3rd/4th year.
    const ctx = context({
      entries: [
        placed({ id: "y4", sectionId: "sec-csm-4th", startPeriod: 6, facultyId: SAI }),
      ],
    })
    const result = validatePlacement(theory({ startPeriod: 6 }), ctx)
    assert.ok(codes(result).includes("FACULTY_CLASH"))
  })

  test("a room cannot host two sections at once", () => {
    const ctx = context({
      entries: [
        placed({ id: "other", sectionId: SEC_B, startPeriod: 3, facultyId: RAVI }),
      ],
    })
    const result = validatePlacement(theory({ startPeriod: 3 }), ctx)
    assert.ok(codes(result).includes("ROOM_CLASH"))
    assert.ok(!codes(result).includes("FACULTY_CLASH"), "different faculty, so no faculty clash")
  })

  test("a lab clashes with a class sitting in the middle of it", () => {
    const ctx = context({
      entries: [
        placed({ id: "mid", sectionId: SEC_B, startPeriod: 4, facultyId: SAI, roomId: ROOM_205 }),
      ],
    })
    const c = theory({
      entryType: "LAB",
      subjectId: DBMS_LAB,
      periodSpan: 3,
      startPeriod: 3, // covers 3,4,5 — collides at period 4
      roomId: LAB_1,
    })
    assert.ok(codes(validatePlacement(c, ctx)).includes("FACULTY_CLASH"))
  })

  test("an entry does not clash with itself when moved", () => {
    const existing = placed({ id: "self", startPeriod: 3 })
    const ctx = context({ entries: [existing] })
    const result = validatePlacement(theory({ id: "self", startPeriod: 3 }), ctx)
    assert.deepEqual(result, [])
  })

  test("no clash when the periods do not overlap", () => {
    const ctx = context({ entries: [placed({ id: "other", sectionId: SEC_B, startPeriod: 1 })] })
    assert.deepEqual(validatePlacement(theory({ startPeriod: 2 }), ctx), [])
  })

  test("no clash on a different day", () => {
    const ctx = context({ entries: [placed({ id: "other", sectionId: SEC_B, dayOfWeek: "TUE" })] })
    assert.deepEqual(validatePlacement(theory({ dayOfWeek: "MON" }), ctx), [])
  })
})

describe("lab rules", () => {
  test("a lab cannot straddle the break", () => {
    const c = theory({
      entryType: "LAB",
      subjectId: DBMS_LAB,
      periodSpan: 3,
      startPeriod: 1, // 1,2,3 — break sits after period 2
      roomId: LAB_1,
    })
    assert.ok(codes(validatePlacement(c, context())).includes("INVALID_LAB_WINDOW"))
  })

  test("a lab must be exactly three periods", () => {
    const c = theory({
      entryType: "LAB",
      subjectId: DBMS_LAB,
      periodSpan: 2,
      startPeriod: 3,
      roomId: LAB_1,
    })
    assert.ok(codes(validatePlacement(c, context())).includes("INVALID_SPAN"))
  })

  test("a lab needs a laboratory room", () => {
    const c = theory({
      entryType: "LAB",
      subjectId: DBMS_LAB,
      periodSpan: 3,
      startPeriod: 3,
      roomId: ROOM_204, // a classroom
    })
    assert.ok(codes(validatePlacement(c, context())).includes("WRONG_ROOM_TYPE"))
  })

  test("a lab with no room at all is rejected", () => {
    const c = theory({
      entryType: "LAB",
      subjectId: DBMS_LAB,
      periodSpan: 3,
      startPeriod: 3,
      roomId: null,
    })
    assert.ok(codes(validatePlacement(c, context())).includes("MISSING_ROOM"))
  })

  test("theory cannot be scheduled into a lab room", () => {
    assert.ok(
      codes(validatePlacement(theory({ roomId: LAB_1 }), context())).includes(
        "WRONG_ROOM_TYPE"
      )
    )
  })
})

describe("curriculum and assignment consistency", () => {
  test("a subject outside the curriculum is rejected", () => {
    const c = theory({ subjectId: "sub-unknown" })
    assert.ok(codes(validatePlacement(c, context())).includes("SUBJECT_NOT_IN_CURRICULUM"))
  })

  test("only the assigned faculty may teach a subject", () => {
    const c = theory({ facultyId: RAVI })
    const result = validatePlacement(c, context())
    assert.ok(codes(result).includes("FACULTY_NOT_ASSIGNED"))
  })

  test("a subject with no faculty assigned yet cannot be placed", () => {
    const ctx = context({ assignments: new Map() })
    assert.ok(codes(validatePlacement(theory(), ctx)).includes("FACULTY_NOT_ASSIGNED"))
  })

  test("a theory entry with no subject is rejected", () => {
    assert.ok(codes(validatePlacement(theory({ subjectId: null }), context())).includes("MISSING_SUBJECT"))
  })
})

describe("day and range limits", () => {
  test("Sunday is rejected when it is not a working day", () => {
    assert.ok(codes(validatePlacement(theory({ dayOfWeek: "SUN" }), context())).includes("NOT_A_WORKING_DAY"))
  })

  test("a period beyond the end of the day is rejected", () => {
    assert.ok(codes(validatePlacement(theory({ startPeriod: 8 }), context())).includes("OUT_OF_RANGE"))
  })

  test("a lab that would overrun the day is rejected", () => {
    const c = theory({
      entryType: "LAB",
      subjectId: DBMS_LAB,
      periodSpan: 3,
      startPeriod: 6, // needs 6,7,8
      roomId: LAB_1,
    })
    assert.ok(codes(validatePlacement(c, context())).includes("OUT_OF_RANGE"))
  })
})

describe("availability for the clash-blocked picker", () => {
  test("offers every working day and period for a free section", () => {
    const slots = computeAvailability(
      { sectionId: SEC_A, periodSpan: 1, entryType: "THEORY", subjectId: ML, facultyId: SAI, roomId: ROOM_204 },
      context()
    )
    assert.equal(slots.length, 6 * 7)
    assert.ok(slots.every((s) => s.available))
  })

  test("blocks exactly the slot where the faculty is busy", () => {
    const ctx = context({
      entries: [placed({ id: "busy", sectionId: SEC_B, dayOfWeek: "WED", startPeriod: 4 })],
    })
    const slots = computeAvailability(
      { sectionId: SEC_A, periodSpan: 1, entryType: "THEORY", subjectId: ML, facultyId: SAI, roomId: ROOM_205 },
      ctx
    )
    const blocked = slots.filter((s) => !s.available)
    assert.equal(blocked.length, 1)
    assert.equal(blocked[0].dayOfWeek, "WED")
    assert.equal(blocked[0].startPeriod, 4)
    assert.equal(blocked[0].reasons[0].code, "FACULTY_CLASH")
  })

  test("a lab is only offered at legal 3-period windows", () => {
    const slots = computeAvailability(
      { sectionId: SEC_A, periodSpan: 3, entryType: "LAB", subjectId: DBMS_LAB, facultyId: SAI, roomId: LAB_1 },
      context()
    )
    const openMonday = slots
      .filter((s) => s.dayOfWeek === "MON" && s.available)
      .map((s) => s.startPeriod)
    assert.deepEqual(openMonday, [3, 4, 5])
  })
})

describe("weekly hour validation", () => {
  const fullWeek = (): PlacedEntry[] => [
    ...[1, 2, 3, 4].map((i) => placed({ id: `t${i}`, dayOfWeek: "MON", startPeriod: i })),
    placed({
      id: "lab",
      dayOfWeek: "TUE",
      startPeriod: 3,
      periodSpan: 3,
      entryType: "LAB",
      subjectId: DBMS_LAB,
      roomId: LAB_1,
    }),
    placed({ id: "lib", dayOfWeek: "WED", startPeriod: 1, entryType: "LIBRARY", subjectId: null, facultyId: null, roomId: null }),
    placed({ id: "sem", dayOfWeek: "WED", startPeriod: 2, entryType: "SEMINAR", subjectId: null, facultyId: null, roomId: null }),
    placed({ id: "cou", dayOfWeek: "WED", startPeriod: 3, entryType: "COUNSELING", subjectId: null, facultyId: null, roomId: null }),
  ]

  test("a complete week validates", () => {
    const result = validateSection(SEC_A, context({ entries: fullWeek() }))
    assert.deepEqual(result.errors, [])
    assert.equal(result.valid, true)
  })

  test("under-placed theory hours block saving", () => {
    const entries = fullWeek().filter((e) => e.id !== "t4")
    const result = validateSection(SEC_A, context({ entries }))
    assert.equal(result.valid, false)
    assert.ok(result.errors.some((e) => e.includes("ML: 3 of 4 theory hours")))
  })

  test("over-placed theory hours also block saving", () => {
    const entries = [...fullWeek(), placed({ id: "t5", dayOfWeek: "THU", startPeriod: 1 })]
    const result = validateSection(SEC_A, context({ entries }))
    assert.equal(result.valid, false)
    assert.ok(result.errors.some((e) => e.includes("ML: 5 of 4 theory hours")))
  })

  test("a missing library hour blocks saving", () => {
    const entries = fullWeek().filter((e) => e.id !== "lib")
    const result = validateSection(SEC_A, context({ entries }))
    assert.equal(result.valid, false)
    assert.ok(result.errors.some((e) => e.includes("Library: 0 of 1")))
  })

  test("the lab counts as three hours, not one entry", () => {
    const result = validateSection(SEC_A, context({ entries: fullWeek() }))
    const lab = result.subjects.find((s) => s.subjectCode === "DBMSL")
    assert.equal(lab?.placedLab, 3)
    assert.equal(lab?.complete, true)
  })

  test("another section's entries do not count toward this one", () => {
    const entries = [
      ...fullWeek(),
      placed({ id: "elsewhere", sectionId: SEC_B, dayOfWeek: "FRI", startPeriod: 1, facultyId: RAVI, roomId: ROOM_205 }),
    ]
    const result = validateSection(SEC_A, context({ entries }))
    assert.equal(result.valid, true)
  })

  test("a section with no home room is warned about room clashes", () => {
    const result = validateSection(SEC_A, context({ entries: fullWeek() }), {
      hasHomeRoom: false,
    })
    assert.ok(
      result.warnings.some((w) => w.includes("no home classroom")),
      "should say room clashes can't be checked"
    )
    assert.equal(result.valid, true, "it is a warning, not a blocker")
  })

  test("a section with a home room gets no such warning", () => {
    const result = validateSection(SEC_A, context({ entries: fullWeek() }), {
      hasHomeRoom: true,
    })
    assert.ok(!result.warnings.some((w) => w.includes("no home classroom")))
  })

  test("4 theory plus a 3-hour lab is NOT warned about", () => {
    // The staff's own example of a valid 7-hour day: 4 theory + 3 lab.
    // Only theory counts toward the six-hour norm, so this must stay silent.
    const entries = [
      ...[1, 2, 3, 4].map((i) =>
        placed({ id: `a${i}`, sectionId: SEC_B, dayOfWeek: "FRI", startPeriod: i, facultyId: SAI })
      ),
      placed({
        id: "lab",
        sectionId: SEC_B,
        dayOfWeek: "FRI",
        startPeriod: 5,
        periodSpan: 3,
        entryType: "LAB",
        facultyId: SAI,
        roomId: LAB_1,
        subjectId: DBMS_LAB,
      }),
    ]
    const result = validateSection(SEC_B, context({ entries, curriculum: [] }))
    assert.deepEqual(result.warnings, [], "7 total hours is valid when only 4 are theory")
  })

  test("a seventh theory hour in one day is warned about", () => {
    const entries = [1, 2, 3, 4, 5, 6, 7].map((i) =>
      placed({ id: `h${i}`, sectionId: SEC_B, dayOfWeek: "FRI", startPeriod: i, facultyId: SAI })
    )
    const result = validateSection(SEC_B, context({ entries, curriculum: [] }))
    assert.ok(result.warnings.some((w) => w.includes("Sai Sir") && w.includes("FRI")))
    assert.ok(result.warnings.some((w) => w.includes("7 theory hours")))
  })
})

describe("faculty daily load", () => {
  test("counts labs in the total but not in theory hours", () => {
    const load = facultyDailyLoad([
      placed({ id: "a", dayOfWeek: "MON", startPeriod: 1 }),
      placed({ id: "b", dayOfWeek: "MON", startPeriod: 3, periodSpan: 3, entryType: "LAB" }),
      placed({ id: "c", dayOfWeek: "TUE", startPeriod: 1 }),
    ])
    assert.deepEqual(load.get(SAI)?.get("MON"), { total: 4, theory: 1 })
    assert.deepEqual(load.get(SAI)?.get("TUE"), { total: 1, theory: 1 })
  })

  test("entries with no faculty are ignored", () => {
    const load = facultyDailyLoad([
      placed({ id: "lib", entryType: "LIBRARY", facultyId: null, subjectId: null }),
    ])
    assert.equal(load.size, 0)
  })
})
