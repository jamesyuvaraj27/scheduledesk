/**
 * The six acceptance tests for the Live/Working, public-view, admin-login and
 * faculty-number work.
 *
 * Namespaced and self-cleaning like integration-rooms.mjs: everything it makes
 * is prefixed (`ZV*` codes, `TEST-VERSIONS` term, block V rooms from 950), it
 * deletes only what it created, and it restores whichever term was active
 * before it started. Safe to run against a database holding a real timetable.
 */
import "./admin-fetch.mjs" // signs in as admin; must come first
const BASE = process.env.API ?? "http://localhost:4000/api"
const PASSWORD = process.env.ADMIN_PASSWORD ?? "dev-admin"

let pass = 0
let fail = 0
const ok = (label, cond, extra = "") => {
  if (cond) pass++
  else fail++
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`)
}

const j = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/** A request with no admin credentials at all — what a public visitor sends. */
const anon = async (method, path, body) => {
  const res = await globalThis.__rawFetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }
  return { status: res.status, body: parsed }
}

const created = { entries: [], sections: [], subjects: [], faculty: [], rooms: [], branches: [], departments: [], terms: [] }
let previousTermId = null

try {
  /* ------------------------------------------------------------------ */
  /* Fixtures                                                            */
  /* ------------------------------------------------------------------ */

  const before = (await j("GET", "/terms/active")).body
  previousTermId = before?.id ?? null

  const dept = (await j("POST", "/departments", { name: "ZV Dept", code: "ZVDEPT" })).body
  created.departments.push(dept.id)

  const branch = (await j("POST", "/branches", { departmentId: dept.id, name: "ZV Branch", code: "ZVB" })).body
  created.branches.push(branch.id)

  const room = (await j("POST", "/rooms", { name: "ZV-950", type: "CLASSROOM", block: "V", year: null })).body
  created.rooms.push(room.id)

  const section = (await j("POST", "/sections", { branchId: branch.id, year: 4, name: "ZVA", homeRoomId: room.id })).body
  created.sections.push(section.id)

  const subject = (await j("POST", "/subjects", { branchId: branch.id, name: "ZV Networks", code: "ZVCN", type: "THEORY" })).body
  created.subjects.push(subject.id)

  /* ---- TEST 6: faculty unique number ---- */

  const one = await j("POST", "/faculty", { facultyNo: "ZVF001", name: "Dr. Same Name", departmentId: dept.id })
  ok("creates faculty with an explicit number", one.status === 201 && one.body.facultyNo === "ZVF001", one.body?.facultyNo)
  created.faculty.push(one.body.id)

  const dupe = await j("POST", "/faculty", { facultyNo: "ZVF001", name: "Someone Else", departmentId: dept.id })
  ok("rejects a duplicate faculty number", dupe.status === 409, `HTTP ${dupe.status}`)

  const two = await j("POST", "/faculty", { facultyNo: "ZVF002", name: "Dr. Same Name", departmentId: dept.id })
  ok(
    "same name, different number = two separate records",
    two.status === 201 && two.body.id !== one.body.id && two.body.facultyNo === "ZVF002"
  )
  created.faculty.push(two.body.id)

  const auto = await j("POST", "/faculty", { name: "Auto Numbered", departmentId: dept.id })
  ok("assigns a number when none is given", auto.status === 201 && /^FAC\d{3}$/.test(auto.body.facultyNo), auto.body?.facultyNo)
  created.faculty.push(auto.body.id)

  const lower = await j("POST", "/faculty", { facultyNo: "zvf001", name: "Case Clash", departmentId: dept.id })
  ok("faculty numbers are case-insensitive for uniqueness", lower.status === 409, `HTTP ${lower.status}`)

  /* ---- a term with a tiny curriculum ---- */

  const term = (await j("POST", "/terms", {
    year: 2099,
    semester: 1,
    label: "TEST-VERSIONS",
    makeActive: true,
    timeConfig: { numPeriods: 6, workingDays: ["MON", "TUE"] },
  })).body
  created.terms.push(term.id)

  await j("POST", `/sections/${section.id}/curriculum`, {
    subjectId: subject.id,
    weeklyTheoryHrs: 2,
    weeklyLabHrs: 0,
  })
  // Eligibility first — the assignment endpoint refuses anyone not marked
  // able to teach the subject.
  await j("PUT", `/faculty/${one.body.id}/subjects`, { subjectIds: [subject.id] })
  const assigned = await j("PUT", `/sections/${section.id}/assignments/${subject.id}`, {
    facultyId: one.body.id,
  })
  ok("assigns the faculty to the subject", assigned.status === 200, `HTTP ${assigned.status}`)

  const placed = await j("POST", `/sections/${section.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: subject.id,
  })
  ok("places a class on the live timetable", placed.status === 201, `HTTP ${placed.status}`)
  if (placed.body?.id) created.entries.push(placed.body.id)

  /* ------------------------------------------------------------------ */
  /* TEST 1 — Live / Working isolation                                   */
  /* ------------------------------------------------------------------ */

  console.log("\n— Test 1: Live/Working isolation —")

  const state0 = await j("GET", "/timetable-versions")
  ok("live version exists with the placed class", state0.body.live.entryCount === 1, `${state0.body.live.entryCount}`)
  ok("no working copy to begin with", state0.body.working === null)

  const copy = await j("POST", "/timetable-versions/working", { note: "acceptance test" })
  ok("creates a working copy", copy.status === 201, `HTTP ${copy.status}`)
  ok("working copy starts identical to live", copy.body.copiedFromLive === 1, `copied ${copy.body.copiedFromLive}`)

  const dupeCopy = await j("POST", "/timetable-versions/working", {})
  ok("refuses a second working copy", dupeCopy.status === 409)

  // Add a class to WORKING only.
  const inWorking = await fetch(`${BASE}/sections/${section.id}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Timetable-Version": "WORKING" },
    body: JSON.stringify({ dayOfWeek: "TUE", startPeriod: 1, entryType: "THEORY", subjectId: subject.id }),
  })
  ok("edits the working copy", inWorking.status === 201, `HTTP ${inWorking.status}`)

  const state1 = await j("GET", "/timetable-versions")
  ok("working copy now has 2 classes", state1.body.working.entryCount === 2, `${state1.body.working.entryCount}`)
  ok("LIVE IS UNCHANGED at 1 class", state1.body.live.entryCount === 1, `${state1.body.live.entryCount}`)
  ok("live is reported as locked", state1.body.liveLocked === true)

  // The safety rule: a request explicitly aimed at LIVE is refused.
  const tryLive = await fetch(`${BASE}/sections/${section.id}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Timetable-Version": "LIVE" },
    body: JSON.stringify({ dayOfWeek: "TUE", startPeriod: 3, entryType: "THEORY", subjectId: subject.id }),
  })
  ok("REFUSES an edit aimed at live while a working copy exists", tryLive.status === 409, `HTTP ${tryLive.status}`)

  const state2 = await j("GET", "/timetable-versions")
  ok("live still at 1 class after the refused edit", state2.body.live.entryCount === 1, `${state2.body.live.entryCount}`)

  /* ------------------------------------------------------------------ */
  /* TEST 4 — public student view shows LIVE, not the working copy       */
  /* ------------------------------------------------------------------ */

  console.log("\n— Test 4: public student view —")

  const pubMeta = await anon("GET", "/public/meta")
  ok("public meta needs no login", pubMeta.status === 200, `HTTP ${pubMeta.status}`)
  ok("public meta lists years and sections", Array.isArray(pubMeta.body.years) && pubMeta.body.years.length > 0)

  const pubTt = await anon("GET", `/public/sections/${section.id}/timetable`)
  ok("public timetable needs no login", pubTt.status === 200, `HTTP ${pubTt.status}`)
  ok("public view shows the LIVE timetable only (1 class)", pubTt.body.entries.length === 1, `${pubTt.body.entries.length} entries`)
  const shown = pubTt.body.entries[0]
  ok("public view shows subject, faculty and room", Boolean(shown.subject?.code && shown.faculty?.name && shown.room?.name))
  ok("public view labels faculty with their number", shown.faculty.label === `${shown.faculty.facultyNo} — ${shown.faculty.name}`, shown.faculty.label)

  /* ------------------------------------------------------------------ */
  /* TEST 5 — admin security at the API level                            */
  /* ------------------------------------------------------------------ */

  console.log("\n— Test 5: admin security —")

  for (const [label, method, path, body] of [
    ["read master data", "GET", "/faculty", null],
    ["read the summary", "GET", "/summary", null],
    ["read a section timetable", "GET", `/sections/${section.id}/timetable`, null],
    ["place a class", "POST", `/sections/${section.id}/entries`, { dayOfWeek: "MON", startPeriod: 5, entryType: "LIBRARY" }],
    ["delete a class", "DELETE", `/entries/${placed.body.id}`, null],
    ["create faculty", "POST", "/faculty", { facultyNo: "ZVX999", name: "Intruder", departmentId: dept.id }],
    ["create a working copy", "POST", "/timetable-versions/working", {}],
    ["publish", "POST", "/timetable-versions/working/publish", { confirm: true }],
    ["reset the year", "POST", "/terms/reset", { year: 2100, semester: 1, label: "hack" }],
  ]) {
    const res = await anon(method, path, body)
    ok(`signed-out visitor cannot ${label}`, res.status === 401, `HTTP ${res.status}`)
  }

  const publicWrite = await anon("POST", "/public/adjustment", {})
  ok("public router refuses non-GET outright", publicWrite.status === 405 || publicWrite.status === 404, `HTTP ${publicWrite.status}`)

  const badLogin = await anon("POST", "/auth/login", { password: "definitely-not-it" })
  ok("wrong password is rejected", badLogin.status === 401, `HTTP ${badLogin.status}`)

  const goodLogin = await anon("POST", "/auth/login", { password: PASSWORD })
  ok("correct password signs in", goodLogin.status === 200 && goodLogin.body.admin === true)

  /* ------------------------------------------------------------------ */
  /* TEST 3 — class adjustment                                           */
  /* ------------------------------------------------------------------ */

  console.log("\n— Test 3: class adjustment —")

  const adj = await anon("GET", `/public/adjustment?sectionId=${section.id}&dayOfWeek=MON&startPeriod=1`)
  ok("class adjustment needs no login", adj.status === 200, `HTTP ${adj.status}`)
  ok("identifies the class that needs covering", adj.body.selectedClass?.subject?.code === "ZVCN", adj.body.selectedClass?.subject?.code)
  ok("names the regular faculty with their number", adj.body.selectedClass?.regularFaculty?.facultyNo === "ZVF001")

  const busyOne = adj.body.availableFaculty.some((c) => c.faculty.id === one.body.id)
  ok("the teaching faculty is NOT listed as free", busyOne === false)

  const freeTwo = adj.body.availableFaculty.find((c) => c.faculty.id === two.body.id)
  ok("a faculty member with no class that hour IS listed as free", Boolean(freeTwo))
  ok("each free faculty comes with their whole day", (freeTwo?.day.length ?? 0) > 0, `${freeTwo?.day.length} rows`)
  const target = freeTwo?.day.find((s) => s.isTarget)
  ok("the target period is flagged for highlighting", target?.period === 1 && target?.busy === false)
  ok("free periods are labelled FREE", target?.label === "FREE", target?.label)

  const stateAfterAdj = await j("GET", "/timetable-versions")
  ok(
    "NOTHING was modified by the adjustment lookup",
    stateAfterAdj.body.live.entryCount === 1 && stateAfterAdj.body.working.entryCount === 2
  )

  // The working copy must not leak into the public adjustment view.
  const adjTue = await anon("GET", `/public/adjustment?sectionId=${section.id}&dayOfWeek=TUE&startPeriod=1`)
  ok("adjustment reads LIVE, not the working copy", adjTue.body.selectedClass === null)

  /* ------------------------------------------------------------------ */
  /* TEST 2 — publish                                                    */
  /* ------------------------------------------------------------------ */

  console.log("\n— Test 2: publish —")

  const noConfirm = await j("POST", "/timetable-versions/working/publish", {})
  ok("publishing without confirmation is refused", noConfirm.status === 422 || noConfirm.status === 400, `HTTP ${noConfirm.status}`)

  const published = await j("POST", "/timetable-versions/working/publish", { confirm: true })
  ok("publishes the working copy", published.status === 200, `HTTP ${published.status}`)
  ok("published version is now LIVE", published.body.kind === "LIVE", published.body.kind)

  const state3 = await j("GET", "/timetable-versions")
  ok("live now has the working copy's 2 classes", state3.body.live.entryCount === 2, `${state3.body.live.entryCount}`)
  ok("there is no working copy any more", state3.body.working === null)
  ok("live is editable again", state3.body.liveLocked === false)

  const pubAfter = await anon("GET", `/public/sections/${section.id}/timetable`)
  ok("STUDENTS SEE THE NEW TIMETABLE", pubAfter.body.entries.length === 2, `${pubAfter.body.entries.length} entries`)

  const history = await j("GET", "/timetable-versions/history")
  ok("the replaced timetable is kept as history", history.body.length >= 1 && history.body[0].entryCount === 1)

  for (const e of pubAfter.body.entries) created.entries.push(e.id)
} finally {
  /* ------------------------------------------------------------------ */
  console.log("\n— cleanup —")

  const del = async (path) => {
    try {
      await fetch(BASE + path, { method: "DELETE" })
    } catch {
      /* keep going — one failure must not strand the rest */
    }
  }

  for (const id of created.entries) await del(`/entries/${id}`)
  if (previousTermId) {
    await fetch(`${BASE}/terms/${previousTermId}/activate`, { method: "POST" })
    console.log(`  restored active term ${previousTermId}`)
  }
  for (const id of created.terms) await del(`/terms/${id}`)
  for (const id of created.subjects) await del(`/subjects/${id}`)
  for (const id of created.faculty) await del(`/faculty/${id}`)
  for (const id of created.sections) await del(`/sections/${id}`)
  for (const id of created.rooms) await del(`/rooms/${id}`)
  for (const id of created.branches) await del(`/branches/${id}`)
  for (const id of created.departments) await del(`/departments/${id}`)
  console.log("  cleaned up")

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
