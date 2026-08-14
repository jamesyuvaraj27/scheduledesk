/**
 * Integration test for the free-lab-span / split-period / room-block /
 * cascade-delete changes. Runs against a live server + real database.
 *
 * Every row it creates is deleted again at the end — the app must never
 * carry demo data.
 */
const BASE = process.env.API ?? "http://localhost:4000/api"

let pass = 0
let fail = 0
const ok = (label, cond, extra = "") => {
  if (cond) {
    pass++
    console.log(`  ok  ${label}`)
  } else {
    fail++
    console.log(`FAIL  ${label} ${extra}`)
  }
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const created = { terms: [], depts: [], branches: [], sections: [], rooms: [], subjects: [], faculty: [] }

/**
 * The app allows exactly one active term, so this test has to make its own
 * term active — which deactivates the real one. That MUST be put back, and a
 * term can't be deleted while active, so cleanup has to restore first.
 */
let previouslyActiveTermId = null

async function main() {
  const before = await req("GET", "/terms")
  previouslyActiveTermId = before.body.find((t) => t.isActive)?.id ?? null
  console.log(
    previouslyActiveTermId
      ? `  (will restore active term ${previouslyActiveTermId} afterwards)`
      : "  (no active term to restore)"
  )

  console.log("\n— term with split morning/afternoon periods —")
  let r = await req("POST", "/terms", {
    year: 2099,
    semester: 1,
    label: "TEST-SPLIT",
    timeConfig: {
      startTime: "09:00",
      numPeriods: 7,
      morningPeriodDurationMin: 60,
      afternoonPeriodDurationMin: 50,
      breakAfterPeriod: 2,
      breakDurationMin: 20,
      lunchAfterPeriod: 5,
      lunchDurationMin: 50,
      workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
    },
  })
  ok("term created", r.status === 201, JSON.stringify(r.body))
  const term = r.body
  created.terms.push(term.id)

  const periods = term.grid.slots.filter((s) => s.kind === "PERIOD")
  ok("morning periods are 60 min", periods[0].durationMin === 60, `got ${periods[0].durationMin}`)
  ok("period up to lunch is still 60 min", periods[4].durationMin === 60, `got ${periods[4].durationMin}`)
  ok("afternoon periods are 50 min", periods[5].durationMin === 50, `got ${periods[5].durationMin}`)
  ok("day ends at 16:50", term.grid.endTime === "16:50", `got ${term.grid.endTime}`)

  await req("POST", `/terms/${term.id}/activate`)

  console.log("\n— rooms: bulk generate by block and floor —")
  // Block V at high numbers, so this can never collide with real rooms.
  // Only ids this run actually created are ever deleted.
  const N0 = 900
  r = await req("POST", "/rooms/bulk", {
    block: "V", floor: "TF", type: "CLASSROOM", count: 4, startNumber: N0,
  })
  ok("bulk created 4 rooms", r.status === 201 && r.body.created === 4, JSON.stringify(r.body))
  ok("names follow block+floor", r.body.rooms[0].name === `VTF-${N0}`, r.body.rooms[0]?.name)
  for (const room of r.body.rooms) created.rooms.push(room.id)

  r = await req("POST", "/rooms/bulk", {
    block: "V", floor: "TF", type: "CLASSROOM", count: 4, startNumber: N0,
  })
  ok("re-running skips existing names", r.body.created === 0 && r.body.skipped.length === 4)

  r = await req("POST", "/rooms/bulk", {
    block: "V", floor: "GF", type: "LAB", count: 2, startNumber: N0,
  })
  ok("a different floor is independent", r.body.created === 2 && r.body.rooms[0].name === `VGF-${N0}`)
  for (const room of r.body.rooms) created.rooms.push(room.id)

  r = await req("GET", "/rooms?block=V")
  ok("rooms filter by block", r.body.length === 6 && r.body.every((x) => x.block === "V"), `${r.body.length} rooms`)
  r = await req("GET", "/rooms?block=V&floor=GF")
  ok("rooms filter by block+floor", r.body.length === 2, `${r.body.length} rooms`)
  r = await req("GET", "/rooms?block=V&type=LAB")
  ok("rooms filter by type", r.body.length === 2 && r.body.every((x) => x.type === "LAB"))

  console.log("\n— structure —")
  r = await req("POST", "/departments", { name: "Test Dept", code: "ZZTEST" })
  const dept = r.body
  created.depts.push(dept.id)

  r = await req("POST", "/branches", { departmentId: dept.id, name: "Test Branch", code: "ZZB" })
  const branch = r.body
  created.branches.push(branch.id)

  const homeRoomId = created.rooms[0]
  r = await req("POST", "/sections", { branchId: branch.id, year: 4, name: "A", homeRoomId })
  const section = r.body
  created.sections.push(section.id)

  r = await req("GET", `/sections?departmentId=${dept.id}`)
  ok("sections filter by department", r.body.length === 1 && r.body[0].id === section.id)

  r = await req("POST", "/faculty", { name: "Test Faculty", departmentId: dept.id })
  const fac = r.body
  created.faculty.push(fac.id)

  r = await req("GET", `/faculty?departmentId=${dept.id}`)
  ok("faculty filter by department", r.body.length === 1)

  r = await req("POST", "/subjects", { branchId: branch.id, name: "Test Lab", code: "ZZLAB", type: "LAB" })
  const labSubject = r.body
  created.subjects.push(labSubject.id)

  r = await req("GET", `/subjects?branchId=${branch.id}`)
  ok("subjects filter by branch", r.body.length === 1)

  await req("PUT", `/faculty/${fac.id}/subjects`, { subjectIds: [labSubject.id] })

  console.log("\n— free lab spans —")
  // 5 lab hours a week: no longer required to be a multiple of 3.
  r = await req("POST", `/sections/${section.id}/curriculum`, {
    subjectId: labSubject.id, weeklyTheoryHrs: 0, weeklyLabHrs: 5,
  })
  ok("lab hours need not be a multiple of 3", r.status === 201, JSON.stringify(r.body))

  await req("PUT", `/sections/${section.id}/assignments/${labSubject.id}`, {
    facultyId: fac.id,
  })

  const labRoom = (await req("GET", "/rooms?block=V&type=LAB")).body[0].id

  // A 2-period lab starting at period 1 straddles nothing; a 3-period lab
  // starting at period 2 crosses the break, which used to be illegal.
  r = await req("POST", `/sections/${section.id}/entries`, {
    dayOfWeek: "MON", startPeriod: 1, entryType: "LAB",
    subjectId: labSubject.id, roomId: labRoom, periodSpan: 2,
  })
  ok("a 2-period lab is accepted", r.status === 201, JSON.stringify(r.body))

  r = await req("POST", `/sections/${section.id}/entries`, {
    dayOfWeek: "TUE", startPeriod: 2, entryType: "LAB",
    subjectId: labSubject.id, roomId: labRoom, periodSpan: 3,
  })
  ok("a lab across the break is now accepted", r.status === 201, JSON.stringify(r.body))

  r = await req("POST", `/sections/${section.id}/entries`, {
    dayOfWeek: "WED", startPeriod: 6, entryType: "LAB",
    subjectId: labSubject.id, roomId: labRoom, periodSpan: 3,
  })
  ok("a lab overrunning the day is still refused", r.status === 409, `status ${r.status}`)

  r = await req("GET", `/sections/${section.id}/availability?entryType=LAB&subjectId=${labSubject.id}&roomId=${labRoom}&periodSpan=4`)
  const openThu = r.body.slots.filter((s) => s.dayOfWeek === "THU" && s.available).map((s) => s.startPeriod)
  ok("availability respects the requested span", JSON.stringify(openThu) === "[1,2,3,4]", JSON.stringify(openThu))

  console.log("\n— cascading subject delete —")
  r = await req("GET", `/subjects/${labSubject.id}/delete-impact`)
  ok("impact reports placed classes", r.body.placedClasses === 2, JSON.stringify(r.body))
  ok("impact reports curriculum rows", r.body.curriculumRows === 1)
  ok("impact reports eligibility", r.body.eligibleFaculty === 1)
  ok("impact reports assignments", r.body.assignments === 1)

  r = await req("DELETE", `/subjects/${labSubject.id}`)
  ok("delete succeeds and reports what went", r.status === 200 && r.body.placedClasses === 2, JSON.stringify(r.body))
  created.subjects = created.subjects.filter((x) => x !== labSubject.id)

  r = await req("GET", `/sections/${section.id}/timetable`)
  ok("its classes are gone from the timetable", r.body.entries.length === 0, `${r.body.entries.length} left`)

  r = await req("GET", `/sections/${section.id}/curriculum`)
  const rows = Array.isArray(r.body) ? r.body : (r.body.rows ?? r.body.curriculum ?? [])
  ok("its curriculum row is gone", rows.length === 0, JSON.stringify(r.body).slice(0, 120))

  r = await req("GET", `/faculty?departmentId=${dept.id}`)
  ok("faculty eligibility is gone", (r.body[0].eligibleSubjects ?? []).length === 0)
}

async function cleanup() {
  console.log("\n— cleanup —")
  for (const id of created.sections) await req("DELETE", `/sections/${id}`)
  for (const id of created.subjects) await req("DELETE", `/subjects/${id}`)
  for (const id of created.faculty) await req("DELETE", `/faculty/${id}`)
  for (const id of created.branches) await req("DELETE", `/branches/${id}`)
  for (const id of created.depts) await req("DELETE", `/departments/${id}`)
  for (const id of created.rooms) await req("DELETE", `/rooms/${id}`)
  // Restore the real active term BEFORE deleting ours — the API refuses to
  // delete an active term, which is exactly how a test term got left behind
  // and stranded the user's real one.
  if (previouslyActiveTermId) {
    const r = await req("POST", `/terms/${previouslyActiveTermId}/activate`)
    console.log(
      r.status === 200
        ? `  restored active term ${previouslyActiveTermId}`
        : `  WARNING: could not restore active term (${r.status})`
    )
  }
  for (const id of created.terms) {
    const r = await req("DELETE", `/terms/${id}`)
    if (r.status !== 204 && r.status !== 200) {
      console.log(`  WARNING: test term ${id} was NOT deleted (${r.status})`)
    }
  }
  console.log("  cleaned up")
}

main()
  .catch((e) => { fail++; console.error("THREW:", e) })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed:", e))
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail === 0 ? 0 : 1)
  })
