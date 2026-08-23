import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  validatePlacement,
  validateSection,
  computeAvailability,
  overlaps,
  facultyDailyLoad,
  unmergedFacultyTwins,
  requiresNoRoom,
  type SchedulingContext,
  type PlacedEntry,
  type Candidate,
  type ConflictCode,
} from "./scheduling.js"

const TIME_CONFIG = {
  startTime: "08:00",
  numPeriods: 7,
  morningPeriodDurationMin: 50,
  afternoonPeriodDurationMin: 50,
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
  sharedSlotId: null,
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

  test("SPORTS needs no subject, faculty or room either", () => {
    const c = theory({
      entryType: "SPORTS",
      subjectId: null,
      facultyId: null,
      roomId: null,
    })
    assert.deepEqual(validatePlacement(c, context()), [])
  })
})

describe("SPORTS and LIBRARY carry no room or faculty", () => {
  test("requiresNoRoom is true only for SPORTS and LIBRARY", () => {
    assert.equal(requiresNoRoom("SPORTS"), true)
    assert.equal(requiresNoRoom("LIBRARY"), true)
    assert.equal(requiresNoRoom("SEMINAR"), false)
    assert.equal(requiresNoRoom("COUNSELING"), false)
    assert.equal(requiresNoRoom("THEORY"), false)
    assert.equal(requiresNoRoom("LAB"), false)
  })

  test("four sections can all have SPORTS in the same slot, no room, no faculty", () => {
    const sportsEntry = (sectionId: string, id: string) =>
      placed({
        id,
        sectionId,
        entryType: "SPORTS",
        subjectId: null,
        facultyId: null,
        roomId: null,
        startPeriod: 5,
      })

    const ctx = context({
      entries: [
        sportsEntry(SEC_B, "sports-b"),
        sportsEntry("sec-csd-a", "sports-csd-a"),
        sportsEntry("sec-cai-a", "sports-cai-a"),
      ],
    })

    const candidate: Candidate = {
      sectionId: SEC_A,
      dayOfWeek: "MON",
      startPeriod: 5,
      periodSpan: 1,
      entryType: "SPORTS",
      subjectId: null,
      facultyId: null,
      roomId: null,
    }

    assert.deepEqual(validatePlacement(candidate, ctx), [])
  })

  test("four sections can all have LIBRARY in the same slot too", () => {
    const libraryEntry = (sectionId: string, id: string) =>
      placed({
        id,
        sectionId,
        entryType: "LIBRARY",
        subjectId: null,
        facultyId: null,
        roomId: null,
        startPeriod: 6,
      })

    const ctx = context({
      entries: [libraryEntry(SEC_B, "lib-b"), libraryEntry("sec-csd-a", "lib-csd-a")],
    })

    const candidate: Candidate = {
      sectionId: SEC_A,
      dayOfWeek: "MON",
      startPeriod: 6,
      periodSpan: 1,
      entryType: "LIBRARY",
      subjectId: null,
      facultyId: null,
      roomId: null,
    }

    assert.deepEqual(validatePlacement(candidate, ctx), [])
  })

  test("SPORTS in two sections at once does not raise ROOM_CLASH or FACULTY_CLASH", () => {
    const ctx = context({
      entries: [
        placed({
          id: "other-sports",
          sectionId: SEC_B,
          entryType: "SPORTS",
          subjectId: null,
          facultyId: null,
          roomId: null,
          startPeriod: 5,
        }),
      ],
    })
    const candidate: Candidate = {
      sectionId: SEC_A,
      dayOfWeek: "MON",
      startPeriod: 5,
      periodSpan: 1,
      entryType: "SPORTS",
      subjectId: null,
      facultyId: null,
      roomId: null,
    }
    const result = validatePlacement(candidate, ctx)
    assert.ok(!codes(result).includes("ROOM_CLASH"))
    assert.ok(!codes(result).includes("FACULTY_CLASH"))
    assert.ok(!codes(result).includes("SECTION_CLASH"), "different section, so no section clash")
  })

  test("SPORTS still clashes for the SAME section at the same time", () => {
    const ctx = context({
      entries: [
        placed({
          id: "already-busy",
          sectionId: SEC_A,
          entryType: "THEORY",
          startPeriod: 5,
        }),
      ],
    })
    const candidate: Candidate = {
      sectionId: SEC_A,
      dayOfWeek: "MON",
      startPeriod: 5,
      periodSpan: 1,
      entryType: "SPORTS",
      subjectId: null,
      facultyId: null,
      roomId: null,
    }
    assert.ok(codes(validatePlacement(candidate, ctx)).includes("SECTION_CLASH"))
  })
})

describe("clash detection", () => {
  test("a section cannot hold two classes at once", () => {
    const ctx = context({ entries: [placed({ startPeriod: 3 })] })
    const result = validatePlacement(theory({ startPeriod: 3 }), ctx)
    assert.ok(codes(result).includes("SECTION_CLASH"))
  })

  test("one faculty member cannot teach two DIFFERENT subjects to two sections at once", () => {
    // Same subject would now be an allowed "twin" (see the combined-sections
    // describe block below) — this test isolates the case that must still
    // always be blocked: two different subjects, same person, same hour.
    const ctx = context({
      entries: [placed({ id: "other", sectionId: SEC_B, startPeriod: 3 })],
    })
    const result = validatePlacement(
      theory({ startPeriod: 3, subjectId: DBMS_LAB }),
      ctx
    )
    assert.ok(codes(result).includes("FACULTY_CLASH"))
    assert.match(result[0].message, /Sai Sir/)
    assert.match(result[0].message, /AIML-B/)
  })

  test("faculty clash is detected across different years", () => {
    // Exactly the real scenario: 2nd year must fit around 3rd/4th year.
    // Different subject, so this stays a real clash regardless of the
    // same-subject "twin" exemption.
    const ctx = context({
      entries: [
        placed({
          id: "y4",
          sectionId: "sec-csm-4th",
          startPeriod: 6,
          facultyId: SAI,
          subjectId: DBMS_LAB,
        }),
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

describe("combined sections and shared rooms", () => {
  const PRIYA = "fac-priya"
  const OS = "sub-os"
  const SLOT = "slot-mon-p3"

  /** Ravi teaching DBMS(ML) to AIML-A in room 204, Mon P3. */
  const anchor = (over: Partial<PlacedEntry> = {}) =>
    placed({
      id: "anchor",
      sectionId: SEC_A,
      startPeriod: 3,
      subjectId: ML,
      facultyId: SAI,
      roomId: ROOM_204,
      ...over,
    })

  /** The other section trying to join that same hour and room. */
  const joiner = (over: Partial<Candidate> = {}): Candidate => ({
    sectionId: SEC_B,
    dayOfWeek: "MON",
    startPeriod: 3,
    periodSpan: 1,
    entryType: "THEORY",
    subjectId: ML,
    facultyId: SAI,
    roomId: ROOM_204,
    ...over,
  })

  // The context is always the JOINING section's, so its curriculum and its
  // assignments are what matter. `mlTakenBy` is who teaches ML *to that
  // section* — the same subject can be a different person per section,
  // which is exactly the shared-room case below.
  const twoSectionCtx = (
    entries: PlacedEntry[],
    mlTakenBy: string = SAI
  ): SchedulingContext =>
    context({
      entries,
      curriculum: [
        { subjectId: ML, subjectCode: "ML", weeklyTheoryHrs: 4, weeklyLabHrs: 0 },
        { subjectId: OS, subjectCode: "OS", weeklyTheoryHrs: 4, weeklyLabHrs: 0 },
        { subjectId: DBMS_LAB, subjectCode: "DBMSL", weeklyTheoryHrs: 0, weeklyLabHrs: 3 },
      ],
      assignments: new Map([
        [ML, mlTakenBy],
        [OS, PRIYA],
        [DBMS_LAB, SAI],
      ]),
    })

  test("untagged twins in the SAME room still clash on the room", () => {
    // Same teacher, same subject, same room, no tag: placing straight into
    // the same room is still a real ROOM_CLASH — reaching one room together
    // is exactly what Merge Classes (the tag) is for, not an accident.
    const result = validatePlacement(joiner(), twoSectionCtx([anchor()]))
    assert.ok(codes(result).includes("ROOM_CLASH"))
    assert.ok(
      !codes(result).includes("FACULTY_CLASH"),
      "same teacher + same subject is never a faculty clash by itself"
    )
  })

  test("STEP 1 — untagged twins in DIFFERENT rooms are two ordinary, independent placements", () => {
    // The whole premise of Merge Classes: both sections can be assigned the
    // same subject/faculty at the same hour as plain, independent entries —
    // no special action, no clash — as long as each has its own room. Only
    // choosing to put them in the SAME room (above) or the same tag needs a
    // deliberate step.
    const result = validatePlacement(
      joiner({ roomId: ROOM_205 }),
      twoSectionCtx([anchor()])
    )
    assert.deepEqual(result, [])
  })

  test("CASE 1 — same teacher, same subject, two sections, one room is allowed", () => {
    const result = validatePlacement(
      joiner({ sharedSlotId: SLOT }),
      twoSectionCtx([anchor({ sharedSlotId: SLOT })])
    )
    assert.deepEqual(result, [])
  })

  test("CASE 1 invalid — same teacher, DIFFERENT subjects stays a faculty clash", () => {
    // Ravi cannot take DBMS to one section and OS to another at one time,
    // and saying "combined" does not make him able to.
    const result = validatePlacement(
      joiner({ sharedSlotId: SLOT, subjectId: OS }),
      twoSectionCtx([anchor({ sharedSlotId: SLOT })])
    )
    assert.ok(
      codes(result).includes("FACULTY_CLASH"),
      "a tag must never excuse one person teaching two subjects at once"
    )
  })

  test("CASE 2 — shared room, different teachers, different subjects is allowed", () => {
    const result = validatePlacement(
      joiner({ sharedSlotId: SLOT, subjectId: OS, facultyId: PRIYA }),
      twoSectionCtx([anchor({ sharedSlotId: SLOT })])
    )
    assert.deepEqual(result, [])
  })

  test("CASE 2 — shared room, different teachers, SAME subject is allowed", () => {
    // Two sections both doing ML in one hall, each with their own teacher.
    const result = validatePlacement(
      joiner({ sharedSlotId: SLOT, facultyId: PRIYA }),
      twoSectionCtx([anchor({ sharedSlotId: SLOT })], PRIYA)
    )
    assert.deepEqual(result, [])
  })

  test("a tag never excuses a section being in two places at once", () => {
    const result = validatePlacement(
      joiner({ sectionId: SEC_A, sharedSlotId: SLOT }),
      twoSectionCtx([anchor({ sharedSlotId: SLOT })])
    )
    assert.ok(codes(result).includes("SECTION_CLASH"))
  })

  test("different tags don't excuse landing in the same ROOM", () => {
    // Same subject/faculty exempts FACULTY_CLASH regardless of tags (see
    // above) — but a mismatched tag still means nothing was agreed about
    // sharing this ROOM, so that half of it stays blocked.
    const result = validatePlacement(
      joiner({ sharedSlotId: "some-other-slot" }),
      twoSectionCtx([anchor({ sharedSlotId: SLOT })])
    )
    assert.ok(!codes(result).includes("FACULTY_CLASH"))
    assert.ok(codes(result).includes("ROOM_CLASH"))
  })

  test("a tag on one side only is not a share of the ROOM", () => {
    const result = validatePlacement(
      joiner({ sharedSlotId: SLOT }),
      twoSectionCtx([anchor({ sharedSlotId: null })])
    )
    assert.ok(!codes(result).includes("FACULTY_CLASH"))
    assert.ok(codes(result).includes("ROOM_CLASH"))
  })

  test("a shared slot does not leak into other hours", () => {
    // Same tag, but the joiner is at P4 while the anchor is at P3. They
    // don't overlap, so there was never anything to excuse — and nothing
    // about the tag should make the engine think otherwise.
    const result = validatePlacement(
      joiner({ sharedSlotId: SLOT, startPeriod: 4 }),
      twoSectionCtx([anchor({ sharedSlotId: SLOT })])
    )
    assert.deepEqual(result, [])
  })

  test("a shared activity hour with no subject on either side is allowed", () => {
    const result = validatePlacement(
      joiner({
        sharedSlotId: SLOT,
        entryType: "LIBRARY",
        subjectId: null,
        facultyId: null,
      }),
      twoSectionCtx([
        anchor({
          sharedSlotId: SLOT,
          entryType: "LIBRARY",
          subjectId: null,
          facultyId: null,
        }),
      ])
    )
    assert.deepEqual(result, [])
  })

  test("a third section can join an existing pair", () => {
    const result = validatePlacement(
      joiner({ sectionId: "sec-csd-a", sharedSlotId: SLOT }),
      twoSectionCtx([
        anchor({ sharedSlotId: SLOT }),
        anchor({ id: "second", sectionId: SEC_B, sharedSlotId: SLOT }),
      ])
    )
    assert.deepEqual(result, [])
  })
})

describe("lab rules", () => {
  test("a lab may now straddle the break — the admin decides", () => {
    const c = theory({
      entryType: "LAB",
      subjectId: DBMS_LAB,
      periodSpan: 3,
      startPeriod: 1, // 1,2,3 — break sits after period 2
      roomId: LAB_1,
    })
    assert.deepEqual(validatePlacement(c, context()), [])
  })

  test("a lab can be any number of periods", () => {
    for (const periodSpan of [1, 2, 3, 4]) {
      const c = theory({
        entryType: "LAB",
        subjectId: DBMS_LAB,
        periodSpan,
        startPeriod: 3,
        roomId: LAB_1,
      })
      assert.deepEqual(
        validatePlacement(c, context()),
        [],
        `span ${periodSpan} should be legal`
      )
    }
  })

  test("a lab still cannot run past the end of the day", () => {
    const c = theory({
      entryType: "LAB",
      subjectId: DBMS_LAB,
      periodSpan: 3,
      startPeriod: 6, // 6,7,8 — the day only has 7
      roomId: LAB_1,
    })
    assert.ok(codes(validatePlacement(c, context())).includes("OUT_OF_RANGE"))
  })

  test("a lab span of zero is rejected", () => {
    const c = theory({
      entryType: "LAB",
      subjectId: DBMS_LAB,
      periodSpan: 0,
      startPeriod: 3,
      roomId: LAB_1,
    })
    assert.ok(codes(validatePlacement(c, context())).includes("INVALID_SPAN"))
  })

  test("only labs may cover more than one period", () => {
    const c = theory({ subjectId: ML, periodSpan: 2, startPeriod: 3 })
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

  test("blocks exactly the slot where the faculty is busy with a DIFFERENT subject", () => {
    // Different subject, so this is a real clash — same-subject twins are
    // covered separately below, and are no longer blocked at all.
    const ctx = context({
      entries: [
        placed({
          id: "busy",
          sectionId: SEC_B,
          dayOfWeek: "WED",
          startPeriod: 4,
          subjectId: DBMS_LAB,
        }),
      ],
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

  test("does NOT block a same-subject twin in a different room", () => {
    // The Merge Classes premise: this section's teacher already teaching
    // the same subject to another section, in another room, at this hour is
    // not a clash — it's exactly the state Merge Classes expects to find.
    const ctx = context({
      entries: [placed({ id: "busy", sectionId: SEC_B, dayOfWeek: "WED", startPeriod: 4 })],
    })
    const slots = computeAvailability(
      { sectionId: SEC_A, periodSpan: 1, entryType: "THEORY", subjectId: ML, facultyId: SAI, roomId: ROOM_205 },
      ctx
    )
    const blocked = slots.filter((s) => !s.available)
    assert.equal(blocked.length, 0)
  })

  test("a 3-period lab is offered anywhere it fits in the day", () => {
    // Spans are free now: the break no longer blocks a window, so the only
    // limit is that 3 periods must fit inside the 7-period day.
    const slots = computeAvailability(
      { sectionId: SEC_A, periodSpan: 3, entryType: "LAB", subjectId: DBMS_LAB, facultyId: SAI, roomId: LAB_1 },
      context()
    )
    const openMonday = slots
      .filter((s) => s.dayOfWeek === "MON" && s.available)
      .map((s) => s.startPeriod)
    assert.deepEqual(openMonday, [1, 2, 3, 4, 5])
  })

  test("a longer lab is offered at correspondingly fewer starts", () => {
    const slots = computeAvailability(
      { sectionId: SEC_A, periodSpan: 5, entryType: "LAB", subjectId: DBMS_LAB, facultyId: SAI, roomId: LAB_1 },
      context()
    )
    const openMonday = slots
      .filter((s) => s.dayOfWeek === "MON" && s.available)
      .map((s) => s.startPeriod)
    assert.deepEqual(openMonday, [1, 2, 3])
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
    placed({ id: "spo", dayOfWeek: "WED", startPeriod: 4, entryType: "SPORTS", subjectId: null, facultyId: null, roomId: null }),
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

describe("unmerged twin warning", () => {
  const namesCtx = () =>
    context({
      names: {
        faculty: new Map([[SAI, "Sai Sir"]]),
        sections: new Map([
          [SEC_A, "AIML-A"],
          [SEC_B, "AIML-B"],
        ]),
        subjects: new Map([[ML, "ML"]]),
      },
    })

  test("flags a same-subject twin sitting in two different rooms", () => {
    const entries = [
      placed({ id: "a", sectionId: SEC_A, roomId: ROOM_204 }),
      placed({ id: "b", sectionId: SEC_B, roomId: ROOM_205 }),
    ]
    const msgs = unmergedFacultyTwins(entries, namesCtx())
    assert.equal(msgs.length, 1)
    assert.match(msgs[0], /Sai Sir/)
    assert.match(msgs[0], /ML/)
    assert.match(msgs[0], /Room 204/)
    assert.match(msgs[0], /Room 205/)
    assert.match(msgs[0], /Merge Classes/)
  })

  test("says nothing once the pair is tagged (merged)", () => {
    const entries = [
      placed({ id: "a", sectionId: SEC_A, roomId: ROOM_204, sharedSlotId: "tag-1" }),
      placed({ id: "b", sectionId: SEC_B, roomId: ROOM_204, sharedSlotId: "tag-1" }),
    ]
    assert.deepEqual(unmergedFacultyTwins(entries, namesCtx()), [])
  })

  test("says nothing when the two are already in the same room untagged", () => {
    // Shouldn't normally exist (ROOM_CLASH blocks it at placement), but the
    // warning should not double up on it regardless.
    const entries = [
      placed({ id: "a", sectionId: SEC_A, roomId: ROOM_204 }),
      placed({ id: "b", sectionId: SEC_B, roomId: ROOM_204 }),
    ]
    assert.deepEqual(unmergedFacultyTwins(entries, namesCtx()), [])
  })

  test("says nothing about a genuine different-subject clash", () => {
    const entries = [
      placed({ id: "a", sectionId: SEC_A, roomId: ROOM_204, subjectId: ML }),
      placed({ id: "b", sectionId: SEC_B, roomId: ROOM_205, subjectId: DBMS_LAB }),
    ]
    assert.deepEqual(unmergedFacultyTwins(entries, namesCtx()), [])
  })

  test("surfaces through validateSection's warnings", () => {
    const entries = [
      ...fullWeekFixture(),
      placed({ id: "twin", sectionId: SEC_B, roomId: ROOM_205, startPeriod: 1 }),
    ]
    const result = validateSection(SEC_A, context({ entries }))
    assert.ok(result.warnings.some((w) => w.includes("Merge Classes")))
  })
})

/** A section's timetable that fully satisfies its curriculum, for reuse. */
function fullWeekFixture(): PlacedEntry[] {
  return [
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
    placed({ id: "spo", dayOfWeek: "WED", startPeriod: 4, entryType: "SPORTS", subjectId: null, facultyId: null, roomId: null }),
  ]
}
