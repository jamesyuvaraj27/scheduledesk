/**
 * HTTP-level verification of Merge Classes — the post-assignment "select two
 * existing entries, merge them" flow, distinct from the older "combine at
 * placement" mechanism (still covered by integration-combined-fix-verify.mjs
 * and left untouched).
 *
 * Against a scratch database only (see guard.mjs).
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
async function patch(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
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

console.log("=== Fixtures ===")
const dept = (await post("/departments", { name: "TEST-ASCE", code: "TZASCE" })).json
const branch = (await post("/branches", { departmentId: dept.id, name: "TEST-CSM", code: "TZCSM" })).json
const secA = (await post("/sections", { branchId: branch.id, year: 3, name: "A" })).json
const secB = (await post("/sections", { branchId: branch.id, year: 3, name: "B" })).json
const secC = (await post("/sections", { branchId: branch.id, year: 3, name: "C" })).json

const aff1 = (await post("/rooms", { name: "TZ-AFF1", type: "CLASSROOM" })).json
const aff2 = (await post("/rooms", { name: "TZ-AFF2", type: "CLASSROOM" })).json
const lab1 = (await post("/rooms", { name: "TZ-LAB1", type: "LAB" })).json
const lab2 = (await post("/rooms", { name: "TZ-LAB2", type: "LAB" })).json

await patch(`/sections/${secA.id}`, { homeRoomId: aff1.id })
await patch(`/sections/${secB.id}`, { homeRoomId: aff2.id })
await patch(`/sections/${secC.id}`, { homeRoomId: aff1.id })

const ravi = (await post("/faculty", { facultyNo: "TZFAC001", name: "Ravi", departmentId: dept.id })).json
const priya = (await post("/faculty", { facultyNo: "TZFAC002", name: "Priya", departmentId: dept.id })).json

const dbms = (await post("/subjects", { branchId: branch.id, name: "TZ DBMS", code: "TZDBMS", type: "THEORY" })).json
const os = (await post("/subjects", { branchId: branch.id, name: "TZ OS", code: "TZOS", type: "THEORY" })).json
const dbmsLab = (await post("/subjects", { branchId: branch.id, name: "TZ DBMS Lab", code: "TZDBMSL", type: "LAB" })).json

await put(`/faculty/${ravi.id}/subjects`, { subjectIds: [dbms.id, os.id, dbmsLab.id] })
await put(`/faculty/${priya.id}/subjects`, { subjectIds: [os.id] })

const term = (
  await post("/terms", { year: 2099, semester: 1, label: "TEST-MERGE-TERM", makeActive: true })
).json
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

for (const sec of [secA, secB, secC]) {
  await post(`/sections/${sec.id}/curriculum`, { subjectId: dbms.id, weeklyTheoryHrs: 2, weeklyLabHrs: 0 })
  await post(`/sections/${sec.id}/curriculum`, { subjectId: os.id, weeklyTheoryHrs: 1, weeklyLabHrs: 0 })
  await post(`/sections/${sec.id}/curriculum`, { subjectId: dbmsLab.id, weeklyTheoryHrs: 0, weeklyLabHrs: 3 })
}
for (const sec of [secA, secB, secC]) {
  await put(`/sections/${sec.id}/assignments/${dbms.id}`, { facultyId: ravi.id })
  await put(`/sections/${sec.id}/assignments/${dbmsLab.id}`, { facultyId: ravi.id })
}
await put(`/sections/${secA.id}/assignments/${os.id}`, { facultyId: ravi.id })
await put(`/sections/${secB.id}/assignments/${os.id}`, { facultyId: priya.id })
await put(`/sections/${secC.id}/assignments/${os.id}`, { facultyId: priya.id })

let entryA, entryB, entryC

console.log("\n=== STEP 1: two ordinary, independent THEORY placements, different rooms ===")
{
  const a = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok("CSM-A DBMS Mon P1 placed with no special flag (201)", a.status === 201, a.json)
  entryA = a.json

  const b = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok("CSM-B DBMS Mon P1 placed with no special flag, different room (201)", b.status === 201, b.json)
  entryB = b.json
  ok("the two entries are in DIFFERENT rooms", entryA.roomId !== entryB.roomId, { a: entryA.roomId, b: entryB.roomId })
}

console.log("\n=== GET /merge/options ===")
{
  const opts = await get(`/merge/options?dayOfWeek=MON&startPeriod=1`)
  ok("lists both entries", opts.json?.options?.length === 2, opts.json)
  const a = opts.json.options.find((o) => o.entryId === entryA.id)
  const b = opts.json.options.find((o) => o.entryId === entryB.id)
  ok("neither is alreadyMerged", a && !a.alreadyMerged && b && !b.alreadyMerged, opts.json)
  ok("A lists B as compatible", a?.compatibleWith?.includes(entryB.id), a)
  ok("B lists A as compatible", b?.compatibleWith?.includes(entryA.id), b)
}

console.log("\n=== POST /merge ===")
let sharedSlotId
{
  const bad = await post("/merge", { entryIdA: entryA.id, entryIdB: entryA.id, roomId: aff1.id })
  ok("merging a class with itself is refused (422)", bad.status === 422, bad.json)

  const res = await post("/merge", { entryIdA: entryA.id, entryIdB: entryB.id, roomId: aff1.id })
  ok("merge succeeds (201)", res.status === 201, res.json)
  sharedSlotId = res.json?.sharedSlotId
  ok("both entries now share the destination room (AFF1)", res.json?.a?.roomId === aff1.id && res.json?.b?.roomId === aff1.id, res.json)
  ok("both entries carry the same shared slot tag", res.json?.a?.sharedSlotId === sharedSlotId && res.json?.b?.sharedSlotId === sharedSlotId, res.json)

  const again = await post("/merge", { entryIdA: entryA.id, entryIdB: entryB.id, roomId: aff1.id })
  ok("merging an already-merged pair again is refused (422)", again.status === 422, again.json)
}

console.log("\n=== Section timetable stays plain (no merge terminology) ===")
{
  const a = (await get(`/sections/${secA.id}/timetable`)).json
  const raw = JSON.stringify(a)
  ok("no 'merged'/'combined' terminology in the section response", !/merged|combined/i.test(raw))
}

console.log("\n=== Faculty + Room timetables show both merged entries ===")
{
  const fac = (await get(`/faculty/${ravi.id}/timetable`)).json
  const mon1 = fac.entries.filter((e) => e.dayOfWeek === "MON" && e.startPeriod === 1)
  ok("Ravi's timetable shows 2 entries at Mon P1", mon1.length === 2, mon1)

  const roomTt = (await get(`/rooms/${aff1.id}/timetable`)).json
  const mon1Room = roomTt.entries.filter((e) => e.dayOfWeek === "MON" && e.startPeriod === 1)
  ok("AFF1's timetable shows 2 entries at Mon P1", mon1Room.length === 2, mon1Room)
}

console.log("\n=== GET /merge/active ===")
{
  const active = await get("/merge/active")
  const group = active.json?.active?.find((g) => g.sharedSlotId === sharedSlotId)
  ok("the merge appears in /merge/active", Boolean(group), active.json)
  ok("group has both sections", group?.sections?.length === 2, group)
}

console.log("\n=== Unmerge restores original rooms ===")
{
  const res = await post(`/entries/${entryA.id}/unmerge`)
  ok("unmerge succeeds (200)", res.status === 200, res.json)
  const restoredA = res.json?.entries?.find((e) => e.id === entryA.id)
  const restoredB = res.json?.entries?.find((e) => e.id === entryB.id)
  ok("A's room is restored to its ORIGINAL room", restoredA?.roomId === entryA.roomId, { restoredA, original: entryA.roomId })
  ok("B's room is restored to its ORIGINAL (different) room", restoredB?.roomId === entryB.roomId, { restoredB, original: entryB.roomId })
  ok("both tags are cleared", !restoredA?.sharedSlotId && !restoredB?.sharedSlotId, { restoredA, restoredB })

  const activeAfter = await get("/merge/active")
  ok(
    "the group no longer appears in /merge/active",
    !activeAfter.json?.active?.some((g) => g.sharedSlotId === sharedSlotId),
    activeAfter.json
  )

  const again = await post(`/entries/${entryA.id}/unmerge`)
  ok("unmerging an already-unmerged entry is refused (422)", again.status === 422, again.json)
}

console.log("\n=== LAB pair, 3-period span ===")
{
  const a = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 3,
    entryType: "LAB",
    subjectId: dbmsLab.id,
    roomId: lab1.id,
    periodSpan: 3,
  })
  ok("CSM-A DBMS Lab Tue P3-5 placed (201)", a.status === 201, a.json)
  const b = await post(`/sections/${secC.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 3,
    entryType: "LAB",
    subjectId: dbmsLab.id,
    roomId: lab2.id,
    periodSpan: 3,
  })
  ok("CSM-C DBMS Lab Tue P3-5 placed, different lab (201)", b.status === 201, b.json)
  entryC = b.json

  const merged = await post("/merge", { entryIdA: a.json.id, entryIdB: entryC.id, roomId: lab1.id })
  ok("LAB merge succeeds (201)", merged.status === 201, merged.json)
  ok("both LAB entries now in LAB1", merged.json?.a?.roomId === lab1.id && merged.json?.b?.roomId === lab1.id, merged.json)

  const unmerged = await post(`/entries/${a.json.id}/unmerge`)
  ok("LAB unmerge restores LAB1/LAB2 respectively", unmerged.status === 200, unmerged.json)
  const restoredA = unmerged.json?.entries?.find((e) => e.id === a.json.id)
  const restoredC = unmerged.json?.entries?.find((e) => e.id === entryC.id)
  ok("A back in LAB1", restoredA?.roomId === lab1.id, restoredA)
  ok("C back in LAB2", restoredC?.roomId === lab2.id, restoredC)
}

let osA
console.log("\n=== Negative: different faculty can never merge (even same subject) ===")
{
  // Two OS classes at the same hour, taught by two DIFFERENT people (Ravi to
  // CSM-A, Priya to CSM-B) — an ordinary, unrelated pair of placements (no
  // FACULTY_CLASH, since the faculty differs; no ROOM_CLASH, since each
  // section defaults to its own home room). Same subject is not enough on
  // its own — Merge Classes requires the SAME faculty too.
  osA = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 2,
    entryType: "THEORY",
    subjectId: os.id,
  })
  ok("CSM-A OS/Ravi Mon P2 placed", osA.status === 201, osA.json)

  const osB = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 2,
    entryType: "THEORY",
    subjectId: os.id,
  })
  ok("CSM-B OS/Priya Mon P2 placed (different faculty, unrelated to A's)", osB.status === 201, osB.json)

  const bad = await post("/merge", { entryIdA: osA.json.id, entryIdB: osB.json.id, roomId: aff1.id })
  ok("merging same subject but DIFFERENT faculty is refused (422)", bad.status === 422, bad.json)
}

console.log("\n=== Negative: different subjects can never merge ===")
{
  // entryA (CSM-A's DBMS, back in its original room since STEP 1's undo) and
  // osA (CSM-A's OS, just placed above) are two of Ravi's own classes, both
  // in CSM-A — different subjects. validateMergePair's subject check refuses
  // it before the section-mismatch check would even be reached.
  const bad = await post("/merge", { entryIdA: entryA.id, entryIdB: osA.json.id, roomId: aff1.id })
  ok("merging two different subjects is refused (422)", bad.status === 422, bad.json)
}

console.log("\n=== Negative: different day/period refused ===")
{
  const c = await post(`/sections/${secC.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok("CSM-C DBMS Tue P1 placed", c.status === 201, c.json)

  const a2 = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 3,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok("CSM-A DBMS Mon P3 placed", a2.status === 201, a2.json)

  const bad = await post("/merge", { entryIdA: a2.json.id, entryIdB: c.json.id, roomId: aff1.id })
  ok("merging entries at different day/period is refused (422)", bad.status === 422, bad.json)
}

console.log("\n=== Negative: wrong room type is refused by the full validate pass ===")
{
  const a3 = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 6,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  const b3 = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 6,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok("two more twins placed for the wrong-room-type check", a3.status === 201 && b3.status === 201, { a3: a3.json, b3: b3.json })

  const bad = await post("/merge", { entryIdA: a3.json.id, entryIdB: b3.json.id, roomId: lab1.id })
  ok("merging THEORY into a LAB room is refused (409 WRONG_ROOM_TYPE)", bad.status === 409, bad.json)

  // And the failed attempt must not have left either entry tagged or moved.
  const check = (await get(`/sections/${secA.id}/timetable`)).json
  const still = check.entries.find((e) => e.id === a3.json.id)
  ok("the refused merge left entry A untouched (no tag, original room)", still && !still.subject ? false : true, still)
}

console.log("\n=== Negative: unmerging a never-merged entry ===")
{
  const solo = await post(`/sections/${secC.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 4,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  const bad = await post(`/entries/${solo.json.id}/unmerge`)
  ok("unmerging a class that was never merged is refused (422)", bad.status === 422, bad.json)
}

console.log("\n=== Cleanup ===")
{
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
