/**
 * Room allocation: the room timetable, the class picker, and the guarantee
 * that clearing an allocation never removes the lesson.
 *
 * Runs against a live server + the real database. It creates its own term,
 * section and rooms (block V, numbers 900+, a reserved namespace) and deletes
 * only what it created. It restores the previously active term.
 */
const BASE = process.env.API ?? "http://localhost:4000/api"

let pass = 0
let fail = 0
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${label}`) }
  else { fail++; console.log(`FAIL  ${label} ${extra}`) }
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
let previouslyActiveTermId = null

async function main() {
  const before = await req("GET", "/terms")
  previouslyActiveTermId = before.body.find((t) => t.isActive)?.id ?? null

  // --- a term of our own ---
  let r = await req("POST", "/terms", {
    year: 2098, semester: 1, label: "TEST-ROOMS",
    timeConfig: {
      startTime: "09:00", numPeriods: 6,
      morningPeriodDurationMin: 60, afternoonPeriodDurationMin: 50,
      breakAfterPeriod: 2, breakDurationMin: 15,
      lunchAfterPeriod: 4, lunchDurationMin: 60,
      workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
    },
  })
  const term = r.body
  created.terms.push(term.id)
  await req("POST", `/terms/${term.id}/activate`)

  // --- rooms, one reserved for year 4 ---
  r = await req("POST", "/rooms/bulk", { block: "V", floor: "SF", type: "CLASSROOM", count: 2, startNumber: 900, year: 4 })
  for (const x of r.body.rooms) created.rooms.push(x.id)
  const [roomA, roomB] = r.body.rooms
  ok("bulk create accepts a year", roomA.year === 4, JSON.stringify(roomA))

  r = await req("POST", "/rooms/bulk", { block: "V", floor: "LF", type: "CLASSROOM", count: 1, startNumber: 900 })
  const roomAnyYear = r.body.rooms[0]
  created.rooms.push(roomAnyYear.id)
  ok("a room can be left open to any year", roomAnyYear.year === null)

  r = await req("GET", "/rooms?block=V&year=4")
  ok("year filter includes year-4 and any-year rooms",
    r.body.length === 3 && r.body.some((x) => x.id === roomAnyYear.id), `${r.body.length}`)
  r = await req("GET", "/rooms?block=V&year=2")
  ok("year filter excludes another year's rooms",
    r.body.length === 1 && r.body[0].id === roomAnyYear.id, `${r.body.length}`)

  // --- structure ---
  r = await req("POST", "/departments", { name: "Room Test Dept", code: "ZZROOM" })
  const dept = r.body; created.depts.push(dept.id)
  r = await req("POST", "/branches", { departmentId: dept.id, name: "Room Test Branch", code: "ZZR" })
  const branch = r.body; created.branches.push(branch.id)
  r = await req("POST", "/sections", { branchId: branch.id, year: 4, name: "A", homeRoomId: roomA.id })
  const secA = r.body
  if (r.status !== 201) throw new Error(`section A setup failed: ${JSON.stringify(r.body)}`)
  created.sections.push(secA.id)
  r = await req("POST", "/sections", { branchId: branch.id, year: 3, name: "B", homeRoomId: roomB.id })
  const secB = r.body
  if (r.status !== 201) throw new Error(`section B setup failed: ${JSON.stringify(r.body)}`)
  created.sections.push(secB.id)

  r = await req("POST", "/faculty", { name: "Room Test Faculty", departmentId: dept.id })
  const facA = r.body; created.faculty.push(facA.id)
  r = await req("POST", "/faculty", { name: "Room Test Faculty 2", departmentId: dept.id })
  const facB = r.body; created.faculty.push(facB.id)

  r = await req("POST", "/subjects", { branchId: branch.id, name: "Computer Networks", code: "ZZCN", type: "THEORY" })
  const cn = r.body; created.subjects.push(cn.id)
  r = await req("POST", "/subjects", { branchId: branch.id, name: "Operating Systems", code: "ZZOS", type: "THEORY" })
  const os = r.body; created.subjects.push(os.id)

  await req("PUT", `/faculty/${facA.id}/subjects`, { subjectIds: [cn.id] })
  await req("PUT", `/faculty/${facB.id}/subjects`, { subjectIds: [os.id] })

  await req("POST", `/sections/${secA.id}/curriculum`, { subjectId: cn.id, weeklyTheoryHrs: 1, weeklyLabHrs: 0 })
  await req("PUT", `/sections/${secA.id}/assignments/${cn.id}`, { facultyId: facA.id })
  await req("POST", `/sections/${secB.id}/curriculum`, { subjectId: os.id, weeklyTheoryHrs: 1, weeklyLabHrs: 0 })
  await req("PUT", `/sections/${secB.id}/assignments/${os.id}`, { facultyId: facB.id })

  // --- place one class in each section, same day/period ---
  r = await req("POST", `/sections/${secA.id}/entries`, {
    dayOfWeek: "MON", startPeriod: 1, entryType: "THEORY", subjectId: cn.id,
  })
  const entryCN = r.body
  ok("class placed on section A", r.status === 201, JSON.stringify(r.body))

  r = await req("POST", `/sections/${secB.id}/entries`, {
    dayOfWeek: "MON", startPeriod: 1, entryType: "THEORY", subjectId: os.id,
  })
  const entryOS = r.body
  ok("class placed on section B", r.status === 201, JSON.stringify(r.body))

  console.log("\n— room timetable —")
  r = await req("GET", `/rooms/${roomA.id}/timetable`)
  ok("room timetable returns the same grid shape",
    r.body.grid.numPeriods === 6 && Array.isArray(r.body.grid.slots))
  ok("home room already shows its section's class", r.body.entries.length === 1, JSON.stringify(r.body.entries))
  ok("label is YEAR_BRANCH_SECTION_SUBJECT",
    r.body.entries[0].label === "IV_ZZR_A_ZZCN", r.body.entries[0]?.label)

  console.log("\n— what can be allocated —")
  r = await req("GET", `/rooms/${roomAnyYear.id}/allocatable?dayOfWeek=MON&startPeriod=1`)
  const labels = r.body.options.map((o) => o.label).sort()
  ok("offers exactly the classes timetabled in that period",
    JSON.stringify(labels) === JSON.stringify(["III_ZZR_B_ZZOS", "IV_ZZR_A_ZZCN"]), JSON.stringify(labels))
  ok("each option reports where it currently is",
    r.body.options.every((o) => o.currentRoom !== null))

  r = await req("GET", `/rooms/${roomAnyYear.id}/allocatable?dayOfWeek=MON&startPeriod=3`)
  ok("a period with no class offers nothing", r.body.options.length === 0)
  r = await req("GET", `/rooms/${roomAnyYear.id}/allocatable?dayOfWeek=WED&startPeriod=1`)
  ok("an empty day offers nothing", r.body.options.length === 0)

  console.log("\n— allocating —")
  r = await req("PATCH", `/entries/${entryCN.id}/room`, { roomId: roomAnyYear.id })
  ok("class moves to the chosen room", r.status === 200 && r.body.roomId === roomAnyYear.id, JSON.stringify(r.body))

  r = await req("GET", `/rooms/${roomAnyYear.id}/timetable`)
  ok("it appears on that room's timetable",
    r.body.entries.length === 1 && r.body.entries[0].label === "IV_ZZR_A_ZZCN")

  r = await req("GET", `/sections/${secA.id}/timetable`)
  let mon1 = r.body.entries.find((e) => e.dayOfWeek === "MON" && e.startPeriod === 1)
  ok("the section's room allocation reflects it immediately",
    mon1.room?.id === roomAnyYear.id, JSON.stringify(mon1.room))
  ok("the subject itself is untouched", mon1.subject?.code === "ZZCN")

  r = await req("GET", `/rooms/${roomA.id}/timetable`)
  ok("the old room is now free", r.body.entries.length === 0)

  console.log("\n— conflicts —")
  r = await req("GET", `/rooms/${roomAnyYear.id}/allocatable?dayOfWeek=MON&startPeriod=1`)
  const cnOpt = r.body.options.find((o) => o.label === "IV_ZZR_A_ZZCN")
  const osOpt = r.body.options.find((o) => o.label === "III_ZZR_B_ZZOS")
  ok("the class already here is flagged as such", cnOpt.alreadyHere === true)
  ok("a second class for an occupied room is not available", osOpt.available === false, JSON.stringify(osOpt.reasons))
  ok("and says the room is occupied",
    osOpt.reasons.some((x) => x.code === "ROOM_CLASH"), JSON.stringify(osOpt.reasons))

  r = await req("PATCH", `/entries/${entryOS.id}/room`, { roomId: roomAnyYear.id })
  ok("assigning it anyway is refused", r.status === 409, `status ${r.status}`)
  ok("with a room clash reason",
    (r.body.details ?? []).some((x) => x.code === "ROOM_CLASH"), JSON.stringify(r.body))

  console.log("\n— removing an allocation —")
  r = await req("PATCH", `/entries/${entryCN.id}/room`, { roomId: null })
  ok("allocation cleared", r.status === 200 && r.body.roomId === null)

  r = await req("GET", `/rooms/${roomAnyYear.id}/timetable`)
  ok("the room cell is empty again", r.body.entries.length === 0)

  r = await req("GET", `/sections/${secA.id}/timetable`)
  mon1 = r.body.entries.find((e) => e.dayOfWeek === "MON" && e.startPeriod === 1)
  ok("THE CLASS IS STILL ON THE SECTION TIMETABLE", Boolean(mon1), "the lesson was lost!")
  ok("its subject is still CN", mon1?.subject?.code === "ZZCN")
  ok("its faculty is still set", mon1?.faculty?.id === facA.id)
  ok("only its room is blank now", mon1?.room === null, JSON.stringify(mon1?.room))

  r = await req("PATCH", `/entries/${entryOS.id}/room`, { roomId: roomAnyYear.id })
  ok("the freed room can now take the other class", r.status === 200, JSON.stringify(r.body))
}

async function cleanup() {
  console.log("\n— cleanup —")
  // A section can't be deleted while it still has classes or curriculum rows
  // pointing at it, so clear those first — otherwise the section survives and
  // its unique branch/year/name blocks the next run.
  for (const id of created.sections) {
    await req("DELETE", `/sections/${id}/entries`)
    const cur = await req("GET", `/sections/${id}/curriculum`)
    const rows = Array.isArray(cur.body)
      ? cur.body
      : (cur.body?.rows ?? cur.body?.curriculum ?? [])
    for (const row of rows) await req("DELETE", `/curriculum/${row.id}`)
    const r = await req("DELETE", `/sections/${id}`)
    if (r.status !== 204) console.log(`  WARNING: section ${id} NOT deleted (${r.status})`)
  }
  for (const id of created.subjects) await req("DELETE", `/subjects/${id}`)
  for (const id of created.faculty) await req("DELETE", `/faculty/${id}`)
  for (const id of created.branches) await req("DELETE", `/branches/${id}`)
  for (const id of created.depts) await req("DELETE", `/departments/${id}`)
  for (const id of created.rooms) await req("DELETE", `/rooms/${id}`)
  if (previouslyActiveTermId) {
    const r = await req("POST", `/terms/${previouslyActiveTermId}/activate`)
    console.log(r.status === 200 ? `  restored active term` : `  WARNING: could not restore active term (${r.status})`)
  }
  for (const id of created.terms) {
    const r = await req("DELETE", `/terms/${id}`)
    if (r.status !== 204 && r.status !== 200) console.log(`  WARNING: term ${id} NOT deleted (${r.status})`)
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
