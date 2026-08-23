/**
 * Reproduces, end-to-end over real HTTP, the exact scenarios from the user's
 * "FIX COMBINED SECTION FACULTY ASSIGNMENT" spec, against a scratch database
 * (see guard.mjs — this refuses to run against a non-empty DB).
 *
 * Does NOT modify any application code. Pure verification.
 */
import "./admin-fetch.mjs"
import { requireEmptyDatabase } from "./guard.mjs"

const BASE = process.env.API ?? "http://localhost:4000/api"
let pass = 0
let fail = 0

function ok(label, cond, extra) {
  if (cond) {
    pass++
    console.log(`  ok   - ${label}`)
  } else {
    fail++
    console.log(`  FAIL - ${label}${extra ? " :: " + JSON.stringify(extra) : ""}`)
  }
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}
async function put(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}
async function get(path) {
  const res = await fetch(`${BASE}${path}`)
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

await requireEmptyDatabase(BASE)

console.log("=== Setting up fixtures (dept, branch, 2 sections, rooms, faculty, subjects) ===")

const dept = (await post("/departments", { name: "TEST-ASCE", code: "TZASCE" })).json
const branch = (await post("/branches", { departmentId: dept.id, name: "TEST-CSM", code: "TZCSM" })).json
const secA = (await post("/sections", { branchId: branch.id, year: 3, name: "A" })).json
const secB = (await post("/sections", { branchId: branch.id, year: 3, name: "B" })).json

const roomTheory = (await post("/rooms", { name: "TZ-AFF1", type: "CLASSROOM" })).json
const roomLab = (await post("/rooms", { name: "TZ-LAB1", type: "LAB" })).json

// Give each section its own home room so room-clash detection has something
// to compare (matches the existing "no home room" warning rule).
await fetch(`${BASE}/sections/${secA.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ homeRoomId: roomTheory.id }),
})
await fetch(`${BASE}/sections/${secB.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ homeRoomId: roomTheory.id }),
})

const ravi = (await post("/faculty", { facultyNo: "TZFAC001", name: "Ravi", departmentId: dept.id })).json
const priya = (await post("/faculty", { facultyNo: "TZFAC002", name: "Priya", departmentId: dept.id })).json

const dbms = (await post("/subjects", { branchId: branch.id, name: "TZ DBMS", code: "TZDBMS", type: "THEORY" })).json
const dbmsLab = (await post("/subjects", { branchId: branch.id, name: "TZ DBMS Lab", code: "TZDBMSL", type: "LAB" })).json
const os = (await post("/subjects", { branchId: branch.id, name: "TZ OS", code: "TZOS", type: "THEORY" })).json

await put(`/faculty/${ravi.id}/subjects`, { subjectIds: [dbms.id, dbmsLab.id, os.id] })
await put(`/faculty/${priya.id}/subjects`, { subjectIds: [os.id] })

const term = (
  await post("/terms", {
    year: 2099,
    semester: 1,
    label: "TEST-FIXTURE-TERM",
    makeActive: true,
  })
).json

// Standard 7-period day, no break/lunch complications needed for this test.
await fetch(`${BASE}/terms/${term.id}/time-config`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    startTime: "08:00",
    numPeriods: 7,
    morningPeriodDurationMin: 50,
    afternoonPeriodDurationMin: 50,
    breakAfterPeriod: 2,
    breakDurationMin: 10,
    lunchAfterPeriod: 4,
    lunchDurationMin: 40,
    workingDays: ["MON", "TUE"],
  }),
})

// Curriculum: both sections study DBMS (theory), DBMS Lab, and OS.
for (const sec of [secA, secB]) {
  await post(`/sections/${sec.id}/curriculum`, {
    subjectId: dbms.id,
    weeklyTheoryHrs: 2,
    weeklyLabHrs: 0,
  })
  await post(`/sections/${sec.id}/curriculum`, {
    subjectId: dbmsLab.id,
    weeklyTheoryHrs: 0,
    weeklyLabHrs: 3,
  })
  await post(`/sections/${sec.id}/curriculum`, {
    subjectId: os.id,
    weeklyTheoryHrs: 1,
    weeklyLabHrs: 0,
  })
}

// Assignments: Ravi teaches DBMS + DBMS Lab to BOTH sections (this is what
// makes the combined-section scenario legitimate — same faculty, same
// subject, intentionally, in both sections' curricula).
for (const sec of [secA, secB]) {
  await put(`/sections/${sec.id}/assignments/${dbms.id}`, { facultyId: ravi.id })
  await put(`/sections/${sec.id}/assignments/${dbmsLab.id}`, { facultyId: ravi.id })
}
// OS: Ravi teaches it to A, Priya teaches it to B — sets up the "different
// faculty, different subject, shared room" and the "same faculty, different
// subject" block cases.
await put(`/sections/${secA.id}/assignments/${os.id}`, { facultyId: ravi.id })
await put(`/sections/${secB.id}/assignments/${os.id}`, { facultyId: priya.id })

console.log("\n=== CASE 3: Combined THEORY — same faculty, same subject, two sections, one room ===")
{
  // Place CSM-A -> DBMS -> Ravi -> AFF1, Mon P1 (ordinary placement).
  const first = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok("first entry (CSM-A DBMS Mon P1) placed", first.status === 201, first.json)
  const firstEntryId = first.json?.id

  // The RAW placement attempt for CSM-B at the same hour, WITHOUT declaring a
  // share, must still be refused — this is the exact "system currently
  // blocks the second Ravi assignment" behaviour from the spec, and it is
  // supposed to happen: an accidental double-booking must still fail.
  const rawSecond = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok(
    "un-declared second placement is refused (409 FACULTY_CLASH)",
    rawSecond.status === 409 &&
      rawSecond.json?.details?.some((d) => d.code === "FACULTY_CLASH"),
    rawSecond.json
  )

  // The availability grid must offer the "combine" option for exactly this
  // slot, pointing at the first entry.
  const avail = await get(
    `/sections/${secB.id}/availability?entryType=THEORY&subjectId=${dbms.id}`
  )
  const mon1 = avail.json?.slots?.find((s) => s.dayOfWeek === "MON" && s.startPeriod === 1)
  ok(
    "availability offers combinableWithEntryId for the blocked slot",
    mon1 && mon1.available === false && mon1.combinableWithEntryId === firstEntryId,
    mon1
  )

  // Now place it AS a combined class (the fix path: shareWithEntryId).
  const combined = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: dbms.id,
    shareWithEntryId: firstEntryId,
  })
  ok("combined placement (shareWithEntryId) is ALLOWED (201)", combined.status === 201, combined.json)
  ok("combined entry inherits the joined room (AFF1)", combined.json?.roomId === roomTheory.id, combined.json)
}

console.log("\n=== CASE 4: Combined LAB — same faculty, same subject, two sections, one lab ===")
{
  const first = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 5,
    entryType: "LAB",
    subjectId: dbmsLab.id,
    roomId: roomLab.id,
    periodSpan: 3,
  })
  ok("first LAB entry (CSM-A DBMS Lab Mon P5-7) placed", first.status === 201, first.json)
  const firstEntryId = first.json?.id

  const rawSecond = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 5,
    entryType: "LAB",
    subjectId: dbmsLab.id,
    roomId: roomLab.id,
    periodSpan: 3,
  })
  ok(
    "un-declared second LAB placement is refused (409 FACULTY_CLASH)",
    rawSecond.status === 409 &&
      rawSecond.json?.details?.some((d) => d.code === "FACULTY_CLASH"),
    rawSecond.json
  )

  const combined = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 5,
    entryType: "LAB",
    subjectId: dbmsLab.id,
    roomId: roomLab.id,
    periodSpan: 3,
    shareWithEntryId: firstEntryId,
  })
  ok("combined LAB placement (shareWithEntryId) is ALLOWED (201)", combined.status === 201, combined.json)
}

console.log("\n=== CASE 5: Same faculty, DIFFERENT subject, same time -> must stay BLOCKED ===")
{
  // Ravi -> OS -> CSM-A, Tue P1 (ordinary placement).
  const osEntry = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: os.id,
  })
  ok("Ravi/OS/CSM-A Tue P1 placed", osEntry.status === 201, osEntry.json)

  // Try Ravi -> DBMS -> CSM-B at the same hour. Different subject, same
  // faculty -> must be blocked, and must NOT be offered a combine option.
  const clash = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok(
    "Ravi teaching a DIFFERENT subject at the same hour is refused",
    clash.status === 409 && clash.json?.details?.some((d) => d.code === "FACULTY_CLASH"),
    clash.json
  )

  const avail = await get(
    `/sections/${secB.id}/availability?entryType=THEORY&subjectId=${dbms.id}`
  )
  const tue1 = avail.json?.slots?.find((s) => s.dayOfWeek === "TUE" && s.startPeriod === 1)
  ok(
    "no combine option is offered for a genuine double-booking",
    tue1 && tue1.available === false && tue1.combinableWithEntryId == null,
    tue1
  )
}

console.log("\n=== CASE 6/7: Shared room (different faculty) — existing behaviour must be untouched ===")
{
  // Ravi -> OS -> CSM-A already sits at TUE P1 in CSM-A's home room (AFF1,
  // since OS has no lab and no explicit room -> defaults to home room).
  const target = await get(`/sections/${secA.id}/timetable`)
  const raviOsEntry = target.json.entries.find(
    (e) => e.dayOfWeek === "TUE" && e.startPeriod === 1 && e.subject?.id === os.id
  )
  ok("found Ravi/OS/CSM-A Tue P1 to share against", Boolean(raviOsEntry), raviOsEntry)

  // Priya -> OS -> CSM-B, same room, same hour, DIFFERENT faculty: a shared
  // room, not a combined section. Must be reachable via the same
  // shareWithEntryId mechanism (room-share path), independent of the
  // faculty-combine fix above.
  const shared = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: os.id,
    shareWithEntryId: raviOsEntry.id,
  })
  ok("shared-room placement (different faculty) still ALLOWED", shared.status === 201, shared.json)
}

console.log("\n=== CASE 9: Only one Faculty Master record for Ravi ===")
{
  const facultyList = (await get("/faculty")).json
  const ravis = facultyList.filter((f) => f.name === "Ravi")
  ok("exactly one Faculty row named Ravi exists", ravis.length === 1, ravis)
}

console.log("\n=== CASE 10: Section timetable stays a normal, independent list per section ===")
{
  const a = (await get(`/sections/${secA.id}/timetable`)).json
  const b = (await get(`/sections/${secB.id}/timetable`)).json
  const raw = JSON.stringify(a) + JSON.stringify(b)
  const match = raw.match(/combined|duplicate|original|shared|lane/i)
  if (match) {
    console.log("    debug context:", raw.slice(Math.max(0, match.index - 50), match.index + 50))
  }
  ok(
    "section timetable JSON contains none of combined/duplicate/original/shared/lane",
    !match
  )
  const aMon1 = a.entries.filter((e) => e.dayOfWeek === "MON" && e.startPeriod === 1)
  const bMon1 = b.entries.filter((e) => e.dayOfWeek === "MON" && e.startPeriod === 1)
  ok("CSM-A has exactly ONE entry at Mon P1", aMon1.length === 1, aMon1)
  ok("CSM-B has exactly ONE entry at Mon P1", bMon1.length === 1, bMon1)
}

console.log("\n=== CASE 11: Faculty individual timetable shows BOTH combined entries at the same hour ===")
{
  const fac = (await get(`/faculty/${ravi.id}/timetable`)).json
  const mon1 = fac.entries.filter((e) => e.dayOfWeek === "MON" && e.startPeriod === 1)
  ok(
    "Ravi's timetable has 2 entries at Mon P1 (CSM-A + CSM-B, both DBMS)",
    mon1.length === 2 &&
      mon1.every((e) => e.subject?.id === dbms.id) &&
      new Set(mon1.map((e) => e.section.id)).size === 2,
    mon1
  )

  const mon5 = fac.entries.filter((e) => e.dayOfWeek === "MON" && e.startPeriod === 5)
  ok(
    "Ravi's timetable has 2 LAB entries at Mon P5 (combined lab)",
    mon5.length === 2 && mon5.every((e) => e.entryType === "LAB"),
    mon5
  )

  const tue1 = fac.entries.filter((e) => e.dayOfWeek === "TUE" && e.startPeriod === 1)
  ok(
    "Ravi's timetable still shows just ONE entry at Tue P1 (OS, not doubled)",
    tue1.length === 1,
    tue1
  )
}

console.log("\n=== CASE 12: Room timetable shows both combined entries at the same hour ===")
{
  const roomTt = (await get(`/rooms/${roomTheory.id}/timetable`)).json
  const mon1 = roomTt.entries.filter((e) => e.dayOfWeek === "MON" && e.startPeriod === 1)
  ok(
    "AFF1's timetable has 2 entries at Mon P1 (both sections' DBMS)",
    mon1.length === 2 && new Set(mon1.map((e) => e.section.id)).size === 2,
    mon1
  )

  const labTt = (await get(`/rooms/${roomLab.id}/timetable`)).json
  const mon5 = labTt.entries.filter((e) => e.dayOfWeek === "MON" && e.startPeriod === 5)
  ok(
    "LAB1's timetable has 2 entries at Mon P5 (both sections' DBMS Lab)",
    mon5.length === 2 && mon5.every((e) => e.entryType === "LAB"),
    mon5
  )
}

console.log("\n=== Cleanup ===")
{
  // Delete order respects the RESTRICT FKs documented in project memory.
  await fetch(`${BASE}/terms/delete-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      confirmText: "DELETE ALL DATA",
      password: process.env.ADMIN_PASSWORD ?? "dev-admin",
    }),
  }).catch(() => {})
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
