/**
 * HTTP-level verification of Merge Classes — the post-assignment "select two
 * existing entries, merge them" flow — under the room-sharing business rule:
 * ANY subject/faculty combination may merge (same/different subject ×
 * same/different faculty), the two entries keep their own subject/faculty,
 * only the room is shared. Distinct from the older "combine at placement"
 * mechanism (`shareWithEntryId`, still covered by
 * integration-combined-fix-verify.mjs and left untouched) — except where
 * this file specifically proves the two interact correctly (a same-faculty
 * pair MUST use combine-at-placement, since normal FACULTY_CLASH stays
 * strict for an untagged pair; and a combine-at-placement group must NOT
 * show up in Merge Classes' "currently merged" list).
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
const aff3 = (await post("/rooms", { name: "TZ-AFF3", type: "CLASSROOM" })).json
const lab1 = (await post("/rooms", { name: "TZ-LAB1", type: "LAB" })).json
const lab2 = (await post("/rooms", { name: "TZ-LAB2", type: "LAB" })).json

await patch(`/sections/${secA.id}`, { homeRoomId: aff1.id })
await patch(`/sections/${secB.id}`, { homeRoomId: aff2.id })
await patch(`/sections/${secC.id}`, { homeRoomId: aff3.id })

const ravi = (await post("/faculty", { facultyNo: "TZFAC001", name: "Ravi", departmentId: dept.id })).json
const priya = (await post("/faculty", { facultyNo: "TZFAC002", name: "Priya", departmentId: dept.id })).json
// A third faculty, used only for the "third section already in the
// destination room" fixture below — keeps that section's own class from
// accidentally faculty-clashing with Ravi or Priya's unrelated classes.
const kumar = (await post("/faculty", { facultyNo: "TZFAC003", name: "Kumar", departmentId: dept.id })).json

const dbms = (await post("/subjects", { branchId: branch.id, name: "TZ DBMS", code: "TZDBMS", type: "THEORY" })).json
const os = (await post("/subjects", { branchId: branch.id, name: "TZ OS", code: "TZOS", type: "THEORY" })).json
const net = (await post("/subjects", { branchId: branch.id, name: "TZ Networks", code: "TZNET", type: "THEORY" })).json
const dbmsLab = (await post("/subjects", { branchId: branch.id, name: "TZ DBMS Lab", code: "TZDBMSL", type: "LAB" })).json
const extra = (await post("/subjects", { branchId: branch.id, name: "TZ Extra", code: "TZEXT", type: "THEORY" })).json

// Ravi and Priya both eligible for dbmsLab, so a diff-faculty LAB pair
// (combo 2: same subject, different faculty) can be placed independently.
await put(`/faculty/${ravi.id}/subjects`, { subjectIds: [dbms.id, os.id, net.id, dbmsLab.id] })
await put(`/faculty/${priya.id}/subjects`, { subjectIds: [os.id, dbmsLab.id] })
await put(`/faculty/${kumar.id}/subjects`, { subjectIds: [extra.id] })

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
  await post(`/sections/${sec.id}/curriculum`, { subjectId: dbms.id, weeklyTheoryHrs: 3, weeklyLabHrs: 0 })
  await post(`/sections/${sec.id}/curriculum`, { subjectId: os.id, weeklyTheoryHrs: 1, weeklyLabHrs: 0 })
  await post(`/sections/${sec.id}/curriculum`, { subjectId: dbmsLab.id, weeklyTheoryHrs: 0, weeklyLabHrs: 3 })
}
// NET is only in secB's curriculum — used for the combo-3-via-combine-at-
// placement demonstration below (different subject, same faculty).
await post(`/sections/${secB.id}/curriculum`, { subjectId: net.id, weeklyTheoryHrs: 1, weeklyLabHrs: 0 })
// EXTRA/Kumar is only in secC's curriculum — used for the third-party
// room-clash fixture below, so it never competes with Ravi/Priya's schedule.
await post(`/sections/${secC.id}/curriculum`, { subjectId: extra.id, weeklyTheoryHrs: 1, weeklyLabHrs: 0 })
await put(`/sections/${secC.id}/assignments/${extra.id}`, { facultyId: kumar.id })

for (const sec of [secA, secB, secC]) {
  await put(`/sections/${sec.id}/assignments/${dbms.id}`, { facultyId: ravi.id })
}
// OS: Ravi teaches it to A, Priya teaches it to B — combo 2 (same subject,
// different faculty) fixture.
await put(`/sections/${secA.id}/assignments/${os.id}`, { facultyId: ravi.id })
await put(`/sections/${secB.id}/assignments/${os.id}`, { facultyId: priya.id })
await put(`/sections/${secB.id}/assignments/${net.id}`, { facultyId: ravi.id })
// DBMS Lab: Ravi teaches A and B, Priya teaches C — another same-subject,
// different-faculty fixture, this time for the LAB/periodSpan case.
await put(`/sections/${secA.id}/assignments/${dbmsLab.id}`, { facultyId: ravi.id })
await put(`/sections/${secB.id}/assignments/${dbmsLab.id}`, { facultyId: ravi.id })
await put(`/sections/${secC.id}/assignments/${dbmsLab.id}`, { facultyId: priya.id })

/* -------------------------------------------------------------------------- */
/*  Combo 4 — different subject, different faculty (A/DBMS/Ravi + B/OS/Priya) */
/* -------------------------------------------------------------------------- */

let entryA4, entryB4, sharedSlot4
console.log("\n=== Combo 4 (different subject + different faculty): independent placement, then merge ===")
{
  const a = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok("CSM-A DBMS/Ravi Mon P1 placed with no special flag (201)", a.status === 201, a.json)
  entryA4 = a.json

  const b = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: os.id,
  })
  ok("CSM-B OS/Priya Mon P1 placed independently, no clash (201)", b.status === 201, b.json)
  entryB4 = b.json
  ok("the two entries are in DIFFERENT (home) rooms", entryA4.roomId !== entryB4.roomId, {
    a: entryA4.roomId,
    b: entryB4.roomId,
  })

  const opts = await get(`/merge/options?dayOfWeek=MON&startPeriod=1`)
  const oa = opts.json.options.find((o) => o.entryId === entryA4.id)
  const ob = opts.json.options.find((o) => o.entryId === entryB4.id)
  ok(
    "different-subject/different-faculty pair IS offered as compatible",
    oa?.compatibleWith?.includes(entryB4.id) && ob?.compatibleWith?.includes(entryA4.id),
    { oa, ob }
  )

  const merged = await post("/merge", { entryIdA: entryA4.id, entryIdB: entryB4.id, roomId: aff1.id })
  ok("combo 4 merge succeeds (201)", merged.status === 201, merged.json)
  sharedSlot4 = merged.json?.sharedSlotId
  ok(
    "both entries now share AFF1, KEEPING their own subject/faculty",
    merged.json?.a?.roomId === aff1.id &&
      merged.json?.b?.roomId === aff1.id &&
      merged.json?.a?.subjectId === dbms.id &&
      merged.json?.b?.subjectId === os.id,
    merged.json
  )
}

console.log("\n=== Faculty + Room timetables reflect each entry's OWN faculty/subject ===")
{
  const fac = (await get(`/faculty/${ravi.id}/timetable`)).json
  const mon1 = fac.entries.filter((e) => e.dayOfWeek === "MON" && e.startPeriod === 1)
  ok("Ravi's timetable shows only HIS class at Mon P1 (DBMS, CSM-A)", mon1.length === 1, mon1)

  const roomTt = (await get(`/rooms/${aff1.id}/timetable`)).json
  const mon1Room = roomTt.entries.filter((e) => e.dayOfWeek === "MON" && e.startPeriod === 1)
  ok("AFF1's timetable shows 2 entries (lanes) at Mon P1", mon1Room.length === 2, mon1Room)
}

console.log("\n=== Unmerge combo 4 restores original rooms ===")
{
  const res = await post(`/entries/${entryA4.id}/unmerge`)
  ok("unmerge succeeds (200)", res.status === 200, res.json)
  const restoredA = res.json?.entries?.find((e) => e.id === entryA4.id)
  const restoredB = res.json?.entries?.find((e) => e.id === entryB4.id)
  ok("A's room is restored to its ORIGINAL room", restoredA?.roomId === entryA4.roomId, restoredA)
  ok("B's room is restored to its ORIGINAL (different) room", restoredB?.roomId === entryB4.roomId, restoredB)
  ok("both tags are cleared", !restoredA?.sharedSlotId && !restoredB?.sharedSlotId, { restoredA, restoredB })
}

/* -------------------------------------------------------------------------- */
/*  Combo 2 — same subject, different faculty (A/OS/Ravi + B/OS/Priya)        */
/* -------------------------------------------------------------------------- */

let entryA2, entryB2, sharedSlot2
console.log("\n=== Combo 2 (same subject + different faculty): independent placement, then merge ===")
{
  const a = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 2,
    entryType: "THEORY",
    subjectId: os.id,
  })
  ok("CSM-A OS/Ravi Mon P2 placed (201)", a.status === 201, a.json)
  entryA2 = a.json

  const b = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 2,
    entryType: "THEORY",
    subjectId: os.id,
  })
  ok("CSM-B OS/Priya Mon P2 placed independently, no clash (201)", b.status === 201, b.json)
  entryB2 = b.json

  const merged = await post("/merge", { entryIdA: entryA2.id, entryIdB: entryB2.id, roomId: aff2.id })
  ok("combo 2 (same subject, different faculty) merge succeeds (201)", merged.status === 201, merged.json)
  sharedSlot2 = merged.json?.sharedSlotId
  ok(
    "both keep subject OS but their own faculty",
    merged.json?.a?.subjectId === os.id &&
      merged.json?.b?.subjectId === os.id &&
      merged.json?.a?.facultyId === ravi.id &&
      merged.json?.b?.facultyId === priya.id,
    merged.json
  )
}

/* -------------------------------------------------------------------------- */
/*  Combo 1 & 3 — same faculty: normal FACULTY_CLASH stays strict; the only   */
/*  way to share a room is "combine at placement" (shareWithEntryId), which  */
/*  is a DIFFERENT mechanism from Merge Classes and must not appear in it.   */
/* -------------------------------------------------------------------------- */

console.log("\n=== Rule 1/2: a same-faculty pair CANNOT be placed independently anymore ===")
{
  const a = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 3,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok("CSM-A DBMS/Ravi Mon P3 placed (201)", a.status === 201, a.json)

  const bBlocked = await post(`/sections/${secC.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 3,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok(
    "CSM-C DBMS/Ravi Mon P3, WITHOUT shareWithEntryId, is refused (409 FACULTY_CLASH)",
    bBlocked.status === 409 &&
      bBlocked.json?.details?.some?.((c) => c.code === "FACULTY_CLASH"),
    bBlocked.json
  )

  const bShared = await post(`/sections/${secC.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 3,
    entryType: "THEORY",
    subjectId: dbms.id,
    shareWithEntryId: a.json.id,
  })
  ok(
    "the SAME placement WITH shareWithEntryId succeeds (combo 1: same subject, same faculty)",
    bShared.status === 201,
    bShared.json
  )
  ok(
    "it lands directly in A's room, already tagged",
    bShared.json?.roomId === a.json.roomId && Boolean(bShared.json?.sharedSlotId),
    bShared.json
  )

  const active1 = await get("/merge/active")
  ok(
    "this combine-at-placement pair does NOT appear in Merge Classes' 'currently merged' list",
    !active1.json?.active?.some((g) => g.sharedSlotId === bShared.json?.sharedSlotId),
    active1.json
  )
}

console.log("\n=== Combo 3 (different subject, same faculty) also only via combine-at-placement ===")
{
  const a = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 4,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok("CSM-A DBMS/Ravi Mon P4 placed (201)", a.status === 201, a.json)

  const b = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 4,
    entryType: "THEORY",
    subjectId: net.id,
    shareWithEntryId: a.json.id,
  })
  ok(
    "CSM-B Networks/Ravi shared onto A's slot succeeds (combo 3: different subject, same faculty)",
    b.status === 201,
    b.json
  )
  ok("different subjects, same faculty, same room", a.json.subjectId !== b.json.subjectId && b.json.roomId === a.json.roomId, {
    a: a.json,
    b: b.json,
  })

  const active3 = await get("/merge/active")
  ok(
    "this one ALSO does not appear in Merge Classes' 'currently merged' list",
    !active3.json?.active?.some((g) => g.sharedSlotId === b.json?.sharedSlotId),
    active3.json
  )
}

/* -------------------------------------------------------------------------- */
/*  LAB pair, 3-period span, combo 2 (same subject, different faculty)        */
/* -------------------------------------------------------------------------- */

let entryLabA, entryLabC
console.log("\n=== LAB pair, 3-period span (same subject, different faculty) ===")
{
  const a = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 3,
    entryType: "LAB",
    subjectId: dbmsLab.id,
    roomId: lab1.id,
    periodSpan: 3,
  })
  ok("CSM-A DBMS Lab/Ravi Tue P3-5 placed (201)", a.status === 201, a.json)
  entryLabA = a.json

  const c = await post(`/sections/${secC.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 3,
    entryType: "LAB",
    subjectId: dbmsLab.id,
    roomId: lab2.id,
    periodSpan: 3,
  })
  ok("CSM-C DBMS Lab/Priya Tue P3-5 placed, different lab (201)", c.status === 201, c.json)
  entryLabC = c.json

  const merged = await post("/merge", { entryIdA: entryLabA.id, entryIdB: entryLabC.id, roomId: lab1.id })
  ok("LAB merge succeeds (201)", merged.status === 201, merged.json)
  ok("both LAB entries now in LAB1", merged.json?.a?.roomId === lab1.id && merged.json?.b?.roomId === lab1.id, merged.json)

  const unmerged = await post(`/entries/${entryLabA.id}/unmerge`)
  ok("LAB unmerge restores LAB1/LAB2 respectively", unmerged.status === 200, unmerged.json)
  const restoredA = unmerged.json?.entries?.find((e) => e.id === entryLabA.id)
  const restoredC = unmerged.json?.entries?.find((e) => e.id === entryLabC.id)
  ok("A back in LAB1", restoredA?.roomId === lab1.id, restoredA)
  ok("C back in LAB2", restoredC?.roomId === lab2.id, restoredC)
}

/* -------------------------------------------------------------------------- */
/*  Negative cases at POST /merge and GET /merge/active shape                 */
/* -------------------------------------------------------------------------- */

console.log("\n=== Negative: merging a class with itself ===")
{
  const bad = await post("/merge", { entryIdA: entryA4.id, entryIdB: entryA4.id, roomId: aff1.id })
  ok("merging a class with itself is refused (422)", bad.status === 422, bad.json)
}

console.log("\n=== Negative: merging an already-merged pair again ===")
{
  const merged = await post("/merge", { entryIdA: entryA2.id, entryIdB: entryB2.id, roomId: aff2.id })
  ok("merging an already-merged pair again is refused (422)", merged.status === 422, merged.json)
}

console.log("\n=== Negative: different day/period refused ===")
{
  const c = await post(`/sections/${secC.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 1,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok("CSM-C DBMS/Ravi Tue P1 placed", c.status === 201, c.json)

  const a2 = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 5,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok("CSM-A DBMS/Ravi Mon P5 placed", a2.status === 201, a2.json)

  const bad = await post("/merge", { entryIdA: a2.json.id, entryIdB: c.json.id, roomId: aff1.id })
  ok("merging entries at different day/period is refused (422)", bad.status === 422, bad.json)
}

console.log("\n=== Negative: mismatched entryType (THEORY vs LAB) refused ===")
{
  // Tue P2 — deliberately a fresh slot, since Ravi is already busy Tue P3-5
  // from the LAB pair above.
  const theoryEntry = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 2,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  ok("CSM-B DBMS/Ravi THEORY Tue P2 placed", theoryEntry.status === 201, theoryEntry.json)

  // A fresh LAB entry at the very same day/period, different section/faculty
  // so it places cleanly.
  const labEntry = await post(`/sections/${secC.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 2,
    entryType: "LAB",
    subjectId: dbmsLab.id,
    roomId: lab2.id,
    periodSpan: 1,
  })
  ok("CSM-C DBMS Lab/Priya Tue P2 (span 1) placed", labEntry.status === 201, labEntry.json)

  const bad = await post("/merge", { entryIdA: theoryEntry.json.id, entryIdB: labEntry.json.id, roomId: aff2.id })
  ok(
    "merging a THEORY entry with a LAB entry is refused (422, entryType mismatch)",
    bad.status === 422,
    bad.json
  )
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
    subjectId: os.id,
  })
  ok("two more classes placed for the wrong-room-type check", a3.status === 201 && b3.status === 201, { a3: a3.json, b3: b3.json })

  const bad = await post("/merge", { entryIdA: a3.json.id, entryIdB: b3.json.id, roomId: lab1.id })
  ok("merging THEORY into a LAB room is refused (409 WRONG_ROOM_TYPE)", bad.status === 409, bad.json)

  // And the failed attempt must not have left either entry tagged or moved.
  const check = (await get(`/sections/${secA.id}/timetable`)).json
  const still = check.entries.find((e) => e.id === a3.json.id)
  ok("the refused merge left entry A's room untouched", still?.room?.id === a3.json.room?.id, still)
  const activeAfterBad = await get("/merge/active")
  ok(
    "the refused merge left no trace in /merge/active",
    !activeAfterBad.json?.active?.some((g) => g.sections?.some((s) => s.entryId === a3.json.id)),
    activeAfterBad.json
  )
}

console.log("\n=== Negative: merging into a room a THIRD section already occupies ===")
{
  const a4 = await post(`/sections/${secA.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 7,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  const b4 = await post(`/sections/${secB.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 7,
    entryType: "THEORY",
    subjectId: os.id,
  })
  ok("two classes placed for the third-party room-clash check", a4.status === 201 && b4.status === 201, { a4: a4.json, b4: b4.json })

  // A third, unrelated section's class (its own faculty, Kumar, so it can't
  // ever faculty-clash with Ravi/Priya's classes above) already sitting in
  // AFF3 at this hour.
  const third = await post(`/sections/${secC.id}/entries`, {
    dayOfWeek: "TUE",
    startPeriod: 7,
    entryType: "THEORY",
    subjectId: extra.id,
  })
  ok("CSM-C's own class already occupies its home room AFF3 at this hour", third.status === 201 && third.json.roomId === aff3.id, third.json)

  const bad = await post("/merge", { entryIdA: a4.json.id, entryIdB: b4.json.id, roomId: aff3.id })
  ok(
    "merging A and B into AFF3 (already occupied by C) is refused (409 ROOM_CLASH)",
    bad.status === 409 && bad.json?.details?.some?.((c) => c.code === "ROOM_CLASH"),
    bad.json
  )

  const check = (await get(`/sections/${secA.id}/timetable`)).json
  const stillA = check.entries.find((e) => e.id === a4.json.id)
  ok("the refused merge left A's room untouched", stillA?.room?.id === a4.json.room?.id, stillA)
  const activeAfterRoomClash = await get("/merge/active")
  ok(
    "the refused merge left no trace in /merge/active",
    !activeAfterRoomClash.json?.active?.some((g) => g.sections?.some((s) => s.entryId === a4.json.id)),
    activeAfterRoomClash.json
  )
}

console.log("\n=== Negative: unmerging a never-merged entry ===")
{
  const solo = await post(`/sections/${secC.id}/entries`, {
    dayOfWeek: "MON",
    startPeriod: 6,
    entryType: "THEORY",
    subjectId: dbms.id,
  })
  const bad = await post(`/entries/${solo.json.id}/unmerge`)
  ok("unmerging a class that was never merged is refused (422)", bad.status === 422, bad.json)
}

console.log("\n=== GET /merge/active shape: subject/faculty are PER-SECTION, not group-level ===")
{
  // Combo 2's merge (above) was never unmerged — reuse it rather than
  // merging again, since these two entries are already tagged together.
  const active = await get("/merge/active")
  const group = active.json?.active?.find((g) => g.sharedSlotId === sharedSlot2)
  ok("the merge appears in /merge/active", Boolean(group), active.json)
  ok("no group-level subject/faculty fields", !("subject" in (group ?? {})) && !("faculty" in (group ?? {})), group)
  ok("group has both sections, each with its OWN subject/faculty", group?.sections?.length === 2, group)
  const secAEntry = group?.sections?.find((s) => s.entryId === entryA2.id)
  const secBEntry = group?.sections?.find((s) => s.entryId === entryB2.id)
  ok(
    "CSM-A's member shows subject OS / faculty Ravi",
    secAEntry?.subject?.id === os.id && secAEntry?.faculty?.id === ravi.id,
    secAEntry
  )
  ok(
    "CSM-B's member shows subject OS / faculty Priya",
    secBEntry?.subject?.id === os.id && secBEntry?.faculty?.id === priya.id,
    secBEntry
  )
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
