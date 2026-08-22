/**
 * Integration checks for the 2026-08-22 changes.
 *
 *   Part 1  Faculty identifiers never leave the admin side. Every public
 *           endpoint is inspected for `facultyNo` ANYWHERE in its payload —
 *           by walking the whole JSON tree rather than checking the two or
 *           three fields I happen to remember, so a future response that
 *           grows a new nested faculty object fails this test too.
 *
 *   Part 2  The bulk print endpoints return one entry per faculty/room.
 *
 *   Part 3  Delete All Data: refuses without a session, refuses a wrong
 *           password, refuses wrong confirm text, and — only when both gates
 *           pass — empties every table.
 *
 * DESTRUCTIVE. Part 3 empties the database it is pointed at, so this script
 * refuses to start unless DANGEROUS_WIPE_OK=yes is set. Never point it at the
 * live Neon database.
 */

import "./admin-fetch.mjs"

const BASE = process.env.API ?? "http://localhost:4000/api"

if (process.env.DANGEROUS_WIPE_OK !== "yes") {
  console.error(
    "\n  This script empties the database it runs against.\n" +
      "  Re-run with DANGEROUS_WIPE_OK=yes, and only against a throwaway database.\n"
  )
  process.exit(1)
}

let pass = 0
let fail = 0

function ok(label, condition, detail = "") {
  if (condition) {
    pass++
    console.log(`  ok   ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

async function j(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed }
}

/** Same, but with no Authorization header — a genuine public visitor. */
async function anon(method, path, body) {
  const res = await globalThis.__rawFetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed }
}

/**
 * Every path in a JSON tree whose key matches, wherever it is nested.
 * This is the point of the test: checking `entries[0].faculty.facultyNo`
 * only proves the field I already thought of is gone.
 */
function findKeyPaths(value, key, path = "$", found = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findKeyPaths(v, key, `${path}[${i}]`, found))
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === key) found.push(`${path}.${k}`)
      findKeyPaths(v, key, `${path}.${k}`, found)
    }
  }
  return found
}

async function main() {
  console.log(`\nScheduleDesk — visibility + delete-all checks against ${BASE}\n`)

  /* ------------------------------------------------------------------ */
  /* Fixtures                                                            */
  /* ------------------------------------------------------------------ */

  console.log("— Setting up —")

  const dept = (await j("POST", "/departments", { code: "ZWD", name: "Wipe Dept" })).body
  const branch = (
    await j("POST", "/branches", { departmentId: dept.id, code: "ZWB", name: "Wipe Branch" })
  ).body
  const room = (await j("POST", "/rooms", { name: "ZW-901", type: "CLASSROOM" })).body
  const lab = (await j("POST", "/rooms", { name: "ZW-902", type: "LAB" })).body
  const section = (
    await j("POST", "/sections", {
      branchId: branch.id,
      year: 4,
      name: "A",
      homeRoomId: room.id,
    })
  ).body
  const subject = (
    await j("POST", "/subjects", {
      branchId: branch.id,
      code: "ZWCN",
      name: "Wipe Networks",
      type: "THEORY",
    })
  ).body
  const faculty = (
    await j("POST", "/faculty", {
      facultyNo: "ZWF001",
      name: "Dr. Wipe Kumar",
      departmentId: dept.id,
    })
  ).body

  ok("fixtures created", Boolean(dept.id && branch.id && section.id && subject.id && faculty.id))

  await j("PUT", `/faculty/${faculty.id}/subjects`, { subjectIds: [subject.id] })

  const term = (
    await j("POST", "/terms", {
      year: 2099,
      semester: 1,
      label: "ZW 2099 Sem 1",
      makeActive: true,
      timeConfig: {
        startTime: "09:00",
        numPeriods: 6,
        morningPeriodDurationMin: 50,
        afternoonPeriodDurationMin: 50,
        breakAfterPeriod: 2,
        breakDurationMin: 10,
        lunchAfterPeriod: 4,
        lunchDurationMin: 40,
        workingDays: ["MON", "TUE"],
      },
    })
  ).body
  ok("active term created", Boolean(term.id), JSON.stringify(term).slice(0, 120))

  await j("POST", `/sections/${section.id}/curriculum`, {
    subjectId: subject.id,
    weeklyTheoryHrs: 2,
    weeklyLabHrs: 0,
  })
  await j("PUT", `/sections/${section.id}/assignments/${subject.id}`, {
    facultyId: faculty.id,
  })

  const placed = await j("POST", `/sections/${section.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 1,
    periodSpan: 1,
    entryType: "THEORY",
    subjectId: subject.id,
  })
  ok("a class is on the live timetable", placed.status === 201, `HTTP ${placed.status}`)

  /* ------------------------------------------------------------------ */
  /* PART 1 — no faculty identifiers anywhere in public output           */
  /* ------------------------------------------------------------------ */

  console.log("\n— Part 1: faculty identifiers are admin-only —")

  const publicEndpoints = [
    ["/public/meta", "meta"],
    [`/public/sections/${section.id}/timetable`, "section timetable"],
    ["/public/day-wise-report", "day-wise report"],
    ["/public/adjustment?dayOfWeek=MON", "class adjustment"],
  ]

  for (const [path, label] of publicEndpoints) {
    const res = await anon("GET", path)
    ok(`${label} responds to an anonymous visitor`, res.status === 200, `HTTP ${res.status}`)
    const leaks = findKeyPaths(res.body, "facultyNo")
    ok(
      `${label} contains no facultyNo anywhere in the payload`,
      leaks.length === 0,
      leaks.join(", ")
    )
  }

  const pubTt = await anon("GET", `/public/sections/${section.id}/timetable`)
  const shown = pubTt.body.entries[0]
  ok("public entry still names the faculty member", shown.faculty?.name === "Dr. Wipe Kumar", shown.faculty?.name)
  ok("public faculty label is the bare name", shown.faculty?.label === "Dr. Wipe Kumar", shown.faculty?.label)
  ok("public entry still names the room", shown.room?.name === "ZW-901", shown.room?.name)
  ok("public legend carries the faculty name", pubTt.body.legend?.[0]?.facultyName === "Dr. Wipe Kumar")
  ok(
    "public section timetable no longer carries a second room grid",
    pubTt.body.roomTimetable === undefined,
    JSON.stringify(pubTt.body.roomTimetable)
  )

  // The admin side must be UNCHANGED — this is a public-visibility change,
  // not a removal of the field.
  const adminFaculty = await j("GET", "/faculty")
  ok(
    "admin still sees facultyNo",
    adminFaculty.body.some((f) => f.facultyNo === "ZWF001"),
    "admin list lost facultyNo"
  )

  /* ------------------------------------------------------------------ */
  /* PART 2 — bulk print endpoints                                       */
  /* ------------------------------------------------------------------ */

  console.log("\n— Part 2: print all faculty / rooms —")

  const printFaculty = await j("GET", "/print/faculty")
  ok("GET /print/faculty responds", printFaculty.status === 200, `HTTP ${printFaculty.status}`)
  ok(
    "it returns the faculty member who has a class",
    printFaculty.body.faculty?.some((r) => r.faculty.facultyNo === "ZWF001")
  )
  ok(
    "faculty entries carry the section they're teaching",
    printFaculty.body.faculty?.[0]?.entries?.[0]?.section?.branchCode === "ZWB",
    JSON.stringify(printFaculty.body.faculty?.[0]?.entries?.[0]?.section)
  )
  ok("it carries the term's grid", Array.isArray(printFaculty.body.grid?.slots))

  const printFacultyEmpty = await j("GET", "/print/faculty?includeEmpty=1")
  ok(
    "includeEmpty=1 returns at least as many faculty",
    printFacultyEmpty.body.faculty.length >= printFaculty.body.faculty.length,
    `${printFacultyEmpty.body.faculty.length} vs ${printFaculty.body.faculty.length}`
  )

  const printRooms = await j("GET", "/print/rooms")
  ok("GET /print/rooms responds", printRooms.status === 200, `HTTP ${printRooms.status}`)
  ok(
    "it returns the room that is in use",
    printRooms.body.rooms?.some((r) => r.room.name === "ZW-901")
  )
  ok(
    "an unused room is left out by default",
    !printRooms.body.rooms?.some((r) => r.room.name === "ZW-902")
  )
  const withEmptyRooms = await j("GET", "/print/rooms?includeEmpty=1")
  ok(
    "includeEmpty=1 brings the unused room back",
    withEmptyRooms.body.rooms?.some((r) => r.room.name === "ZW-902")
  )
  ok(
    "room entries use the YEAR_BRANCH_SECTION_SUBJECT label",
    printRooms.body.rooms?.[0]?.entries?.[0]?.label === "IV_ZWB_A_ZWCN",
    printRooms.body.rooms?.[0]?.entries?.[0]?.label
  )

  const printSections = await j("GET", "/print/sections")
  ok(
    "print/sections no longer carries a per-section room grid",
    printSections.body.sections?.every((s) => s.roomTimetable === undefined)
  )

  /* ------------------------------------------------------------------ */
  /* PART 3 — Delete All Data                                            */
  /* ------------------------------------------------------------------ */

  console.log("\n— Part 3: Delete All Data —")

  const preview = await j("GET", "/terms/delete-all-preview")
  ok("preview responds", preview.status === 200, `HTTP ${preview.status}`)
  ok("preview names the confirmation phrase", preview.body.confirmPhrase === "DELETE ALL DATA")
  ok("preview counts the placed class", preview.body.counts.timetableEntries >= 1)
  ok("preview counts faculty", preview.body.counts.faculty >= 1)
  ok("preview total is the sum of its parts",
    preview.body.total === Object.values(preview.body.counts).reduce((n, v) => n + v, 0))

  const before = preview.body.total

  // --- gate 1: no admin session at all
  const noAuth = await anon("POST", "/terms/delete-all", {
    password: process.env.ADMIN_PASSWORD ?? "dev-admin",
    confirmText: "DELETE ALL DATA",
  })
  ok("an anonymous request is refused", noAuth.status === 401, `HTTP ${noAuth.status}`)

  // --- gate 2: wrong password
  const wrongPw = await j("POST", "/terms/delete-all", {
    password: "not-the-password",
    confirmText: "DELETE ALL DATA",
  })
  ok("a wrong password is refused", wrongPw.status === 401, `HTTP ${wrongPw.status}`)

  // --- gate 3: wrong confirm text, in several plausible near-misses
  for (const [label, text] of [
    ["empty", ""],
    ["lower case", "delete all data"],
    ["mixed case", "Delete All Data"],
    ["trailing space", "DELETE ALL DATA "],
    ["different words", "DELETE EVERYTHING"],
  ]) {
    const res = await j("POST", "/terms/delete-all", {
      password: process.env.ADMIN_PASSWORD ?? "dev-admin",
      confirmText: text,
    })
    ok(`confirm text refused: ${label}`, res.status === 400, `HTTP ${res.status}`)
  }

  // --- nothing was deleted by any of the refusals
  const stillThere = await j("GET", "/terms/delete-all-preview")
  ok(
    "no refused attempt deleted anything",
    stillThere.body.total === before,
    `${stillThere.body.total} vs ${before}`
  )

  // --- the real thing
  const wipe = await j("POST", "/terms/delete-all", {
    password: process.env.ADMIN_PASSWORD ?? "dev-admin",
    confirmText: "DELETE ALL DATA",
  })
  ok("both gates passed deletes everything", wipe.status === 200, `HTTP ${wipe.status} ${JSON.stringify(wipe.body).slice(0, 200)}`)
  ok("it reports what it deleted", wipe.body?.deleted?.timetableEntries >= 1)

  const after = await j("GET", "/terms/delete-all-preview")
  ok("every table is now empty", after.body.total === 0, `${after.body.total} rows left`)
  for (const [table, count] of Object.entries(after.body.counts)) {
    ok(`  ${table} is empty`, count === 0, `${count} left`)
  }

  // --- the app still works on an empty database rather than 500ing
  const emptyMasterData = await j("GET", "/departments")
  ok("master data reads back as an empty list", emptyMasterData.status === 200 && emptyMasterData.body.length === 0)
  const emptySummary = await j("GET", "/summary")
  ok("the summary still loads with no data", emptySummary.status === 200, `HTTP ${emptySummary.status}`)
  const emptyPublic = await anon("GET", "/public/meta")
  ok(
    "the public page explains itself rather than crashing",
    emptyPublic.status === 409,
    `HTTP ${emptyPublic.status}`
  )

  /* ------------------------------------------------------------------ */

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
