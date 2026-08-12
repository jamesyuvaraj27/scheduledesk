const B = "http://localhost:4000/api"
const j = async (m, p, b) => {
  const r = await fetch(B + p, {
    method: m, headers: { "Content-Type": "application/json" },
    body: b ? JSON.stringify(b) : undefined,
  })
  const t = await r.text()
  return { status: r.status, body: t ? JSON.parse(t) : null }
}
let pass = 0, fail = 0
const ok = (label, cond, extra = "") => {
  cond ? pass++ : fail++
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`)
}

/* ---------- master data: one faculty teaching both 4th and 2nd year ----------
 * Independent creates run in parallel — Neon round-trips dominate runtime.  */
const t0 = Date.now()
const dept = (await j("POST", "/departments", { name: "Allied CSE", code: "asce" })).body

const [aiml, csm, r204, r301, lab1, sai, ravi] = await Promise.all([
  j("POST", "/branches", { departmentId: dept.id, name: "AI & ML", code: "aiml" }),
  j("POST", "/branches", { departmentId: dept.id, name: "CS & ML", code: "csm" }),
  j("POST", "/rooms", { name: "Room 204", type: "CLASSROOM" }),
  j("POST", "/rooms", { name: "Room 301", type: "CLASSROOM" }),
  j("POST", "/rooms", { name: "Lab 1", type: "LAB" }),
  j("POST", "/faculty", { name: "Sai Sir", departmentId: dept.id }),
  j("POST", "/faculty", { name: "Ravi Sir", departmentId: dept.id }),
]).then(rs => rs.map(r => r.body))

const [sec2, sec4, ml, dbms, bda] = await Promise.all([
  j("POST", "/sections", { branchId: aiml.id, year: 2, name: "a", homeRoomId: r204.id }),
  j("POST", "/sections", { branchId: csm.id, year: 4, name: "a", homeRoomId: r301.id }),
  j("POST", "/subjects", { branchId: aiml.id, name: "Machine Learning", code: "ml", type: "THEORY" }),
  j("POST", "/subjects", { branchId: aiml.id, name: "DBMS Lab", code: "dbmsl", type: "LAB" }),
  j("POST", "/subjects", { branchId: csm.id, name: "Big Data Analytics", code: "bda", type: "THEORY" }),
]).then(rs => rs.map(r => r.body))

await Promise.all([
  j("PUT", `/faculty/${sai.id}/subjects`, { subjectIds: [ml.id, dbms.id, bda.id] }),
  j("PUT", `/faculty/${ravi.id}/subjects`, { subjectIds: [ml.id] }),
  j("POST", "/terms", { year: 2026, semester: 1, label: "2026-27 Sem I", makeActive: true }),
])

// Curriculum rows must exist before their assignments.
await Promise.all([
  j("POST", `/sections/${sec4.id}/curriculum`, { subjectId: bda.id, weeklyTheoryHrs: 4, weeklyLabHrs: 0 }),
  j("POST", `/sections/${sec2.id}/curriculum`, { subjectId: ml.id, weeklyTheoryHrs: 4, weeklyLabHrs: 0 }),
  j("POST", `/sections/${sec2.id}/curriculum`, { subjectId: dbms.id, weeklyTheoryHrs: 0, weeklyLabHrs: 3 }),
])
await Promise.all([
  j("PUT", `/sections/${sec4.id}/assignments/${bda.id}`, { facultyId: sai.id }),
  j("PUT", `/sections/${sec2.id}/assignments/${ml.id}`, { facultyId: sai.id }),
  j("PUT", `/sections/${sec2.id}/assignments/${dbms.id}`, { facultyId: sai.id }),
])
console.log(`setup done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)

/* ---------------------------- grid + availability --------------------------- */
let r = await j("GET", `/sections/${sec2.id}/timetable`)
ok("timetable returns grid + legend", r.status === 200 && r.body.grid.slots.length === 9 && r.body.legend.length === 2)
ok("grid exposes lab windows", JSON.stringify(r.body.grid.validLabStartPeriods) === "[3,4,5]")
ok("empty section is invalid (hours unmet)", r.body.validation.valid === false)

r = await j("GET", `/sections/${sec2.id}/availability?entryType=THEORY&subjectId=${ml.id}`)
ok("all 42 slots open initially", r.body.slots.length === 42 && r.body.slots.every(s => s.available))
ok("availability infers assigned faculty", r.body.facultyId === sai.id)
ok("availability defaults to home room", r.body.roomId === r204.id)

/* ------------------- THE core scenario: cross-year clash -------------------- */
r = await j("POST", `/sections/${sec4.id}/entries`, { dayOfWeek: "MON", startPeriod: 1, entryType: "THEORY", subjectId: bda.id })
ok("places 4th-year class", r.status === 201)

r = await j("GET", `/sections/${sec2.id}/availability?entryType=THEORY&subjectId=${ml.id}`)
const blocked = r.body.slots.filter(s => !s.available)
ok("2nd-year MON p1 now blocked by 4th-year commitment",
   blocked.length === 1 && blocked[0].dayOfWeek === "MON" && blocked[0].startPeriod === 1,
   `${blocked.length} blocked`)
ok("blocked reason names the faculty and section",
   blocked[0]?.reasons[0].code === "FACULTY_CLASH" && /Sai Sir/.test(blocked[0].reasons[0].message),
   blocked[0]?.reasons[0].message)

r = await j("POST", `/sections/${sec2.id}/entries`, { dayOfWeek: "MON", startPeriod: 1, entryType: "THEORY", subjectId: ml.id })
ok("server refuses the clashing placement", r.status === 409 && r.body.details[0].code === "FACULTY_CLASH")

/* ------------------------------- lab rules ---------------------------------- */
r = await j("POST", `/sections/${sec2.id}/entries`, { dayOfWeek: "TUE", startPeriod: 1, entryType: "LAB", subjectId: dbms.id, roomId: lab1.id })
ok("rejects lab straddling the break", r.status === 409 && r.body.details.some(d => d.code === "INVALID_LAB_WINDOW"))

r = await j("POST", `/sections/${sec2.id}/entries`, { dayOfWeek: "TUE", startPeriod: 3, entryType: "LAB", subjectId: dbms.id, roomId: r204.id })
ok("rejects lab in a classroom", r.status === 409 && r.body.details.some(d => d.code === "WRONG_ROOM_TYPE"))

r = await j("POST", `/sections/${sec2.id}/entries`, { dayOfWeek: "TUE", startPeriod: 4, entryType: "LAB", subjectId: dbms.id, roomId: lab1.id })
ok("accepts lab spanning lunch (p4,5,6)", r.status === 201 && r.body.periodSpan === 3)
const labId = r.body.id

r = await j("GET", `/sections/${sec2.id}/availability?entryType=THEORY&subjectId=${ml.id}`)
const tueBlocked = r.body.slots.filter(s => s.dayOfWeek === "TUE" && !s.available).map(s => s.startPeriod)
ok("lab blocks all 3 of its periods", JSON.stringify(tueBlocked) === "[4,5,6]", JSON.stringify(tueBlocked))

/* ------------------------- complete the week + validate --------------------- */
// Sequential on purpose: each placement must see the previous one to
// clash-check correctly.
for (const [day, p] of [["MON",2],["WED",1],["THU",1],["FRI",1]]) {
  await j("POST", `/sections/${sec2.id}/entries`, { dayOfWeek: day, startPeriod: p, entryType: "THEORY", subjectId: ml.id })
}
r = await j("GET", `/sections/${sec2.id}/validate`)
ok("still invalid without library/seminar/counseling", r.body.valid === false && r.body.errors.some(e => e.includes("Library")))

for (const [type, p] of [["LIBRARY",2],["SEMINAR",3],["COUNSELING",4]]) {
  await j("POST", `/sections/${sec2.id}/entries`, { dayOfWeek: "WED", startPeriod: p, entryType: type })
}
r = await j("GET", `/sections/${sec2.id}/validate`)
ok("section valid once every requirement is met", r.body.valid === true, JSON.stringify(r.body.errors))

r = await j("POST", `/sections/${sec2.id}/entries`, { dayOfWeek: "SAT", startPeriod: 1, entryType: "THEORY", subjectId: ml.id })
ok("extra hour is accepted but then flagged", r.status === 201)
r = await j("GET", `/sections/${sec2.id}/validate`)
ok("over-placed hours make it invalid", r.body.valid === false && r.body.errors.some(e => e.includes("5 of 4 theory")))
const satEntry = (await j("GET", `/sections/${sec2.id}/timetable`)).body.entries.find(e => e.dayOfWeek === "SAT")
await j("DELETE", `/entries/${satEntry.id}`)

/* --------------------- derived faculty timetable --------------------------- */
r = await j("GET", `/faculty/${sai.id}/timetable`)
ok("faculty timetable spans both years",
   r.body.entries.some(e => e.section.year === 4) && r.body.entries.some(e => e.section.year === 2))
// Sai teaches: 1 period of BDA (4th yr) + 4 of ML (2nd yr) + a 3-period lab = 8.
// Library/seminar/counseling have no assigned faculty, so they never appear here.
ok("faculty summary counts lab as 3 periods", r.body.summary.weeklyPeriods === 8, `got ${r.body.summary.weeklyPeriods}`)
ok("free periods computed", r.body.summary.freePeriods === 42 - 8, `got ${r.body.summary.freePeriods}`)
ok("activities excluded from faculty load", r.body.entries.every(e => e.entryType !== "LIBRARY"))

/* ------------------------------ move + delete ------------------------------ */
r = await j("PATCH", `/entries/${labId}`, { dayOfWeek: "THU", startPeriod: 3 })
ok("moves lab to a free window", r.status === 200 && r.body.dayOfWeek === "THU")
r = await j("PATCH", `/entries/${labId}`, { dayOfWeek: "THU", startPeriod: 1 })
ok("refuses invalid move", r.status === 409 && r.body.details.some(d => d.code === "INVALID_LAB_WINDOW"))

r = await j("DELETE", `/sections/${sec2.id}/entries`)
ok("clears the section", r.status === 200 && r.body.deleted > 0, `deleted ${r.body.deleted}`)
r = await j("GET", `/sections/${sec4.id}/timetable`)
ok("4th year untouched by 2nd-year clear", r.body.entries.length === 1)

console.log(`\n${pass} passed, ${fail} failed`)
