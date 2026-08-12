const B = "http://localhost:4000/api"
const j = async (m, p, b) => {
  const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined })
  const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null }
}
let pass = 0, fail = 0
const ok = (l, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${l}${x ? "  — " + x : ""}`) }

// Empty database first.
let r = await j("GET", "/build-status")
ok("build-status copes with no term", r.status === 200 && r.body.term === null)

const dept = (await j("POST", "/departments", { name: "Allied CSE", code: "asce" })).body
const [br, room, lab] = await Promise.all([
  j("POST", "/branches", { departmentId: dept.id, name: "CS & ML", code: "csm" }),
  j("POST", "/rooms", { name: "Room 301", type: "CLASSROOM" }),
  j("POST", "/rooms", { name: "Lab 1", type: "LAB" }),
]).then(rs => rs.map(x => x.body))

// Four sections, each deliberately left at a different stage.
const [noRoom, noCurriculum, noFaculty, buildable] = await Promise.all([
  j("POST", "/sections", { branchId: br.id, year: 4, name: "a" }),                       // no home room
  j("POST", "/sections", { branchId: br.id, year: 4, name: "b", homeRoomId: room.id }),  // no subjects
  j("POST", "/sections", { branchId: br.id, year: 3, name: "a", homeRoomId: room.id }),  // subjects, no faculty
  j("POST", "/sections", { branchId: br.id, year: 2, name: "a", homeRoomId: room.id }),  // fully ready
]).then(rs => rs.map(x => x.body))

await j("POST", "/terms", { year: 2026, semester: 1, label: "2026-27 Sem I", makeActive: true })

const [ml, dbms] = await Promise.all([
  j("POST", "/subjects", { branchId: br.id, name: "Machine Learning", code: "ml", type: "THEORY" }),
  j("POST", "/subjects", { branchId: br.id, name: "DBMS Lab", code: "dbmsl", type: "LAB" }),
]).then(rs => rs.map(x => x.body))
const sai = (await j("POST", "/faculty", { name: "Sai Sir", departmentId: dept.id })).body
await j("PUT", `/faculty/${sai.id}/subjects`, { subjectIds: [ml.id, dbms.id] })

await Promise.all([
  j("POST", `/sections/${noFaculty.id}/curriculum`, { subjectId: ml.id, weeklyTheoryHrs: 4, weeklyLabHrs: 0 }),
  j("POST", `/sections/${buildable.id}/curriculum`, { subjectId: ml.id, weeklyTheoryHrs: 4, weeklyLabHrs: 0 }),
])
await j("PUT", `/sections/${buildable.id}/assignments/${ml.id}`, { facultyId: sai.id })

// ---- stages ----
r = await j("GET", "/build-status")
const all = r.body.years.flatMap(y => y.sections)
const stageOf = id => all.find(s => s.section.id === id)?.stage
ok("stage: no home room", stageOf(noRoom.id) === "needs-room", stageOf(noRoom.id))
ok("stage: no curriculum", stageOf(noCurriculum.id) === "needs-curriculum", stageOf(noCurriculum.id))
ok("stage: faculty missing", stageOf(noFaculty.id) === "needs-faculty", stageOf(noFaculty.id))
ok("stage: ready to build", stageOf(buildable.id) === "ready-to-build", stageOf(buildable.id))

ok("grouped by year", r.body.years.length === 3, `${r.body.years.length} years`)
ok("years are sorted", JSON.stringify(r.body.years.map(y => y.year)) === "[2,3,4]")
ok("totals reported", r.body.totals.sections === 4 && r.body.totals.notStarted === 4,
   JSON.stringify(r.body.totals))

const roomless = all.find(s => s.section.id === noRoom.id)
ok("roomless section warns about clash checking",
   roomless.timetable.warnings.some(w => w.includes("no home classroom")),
   JSON.stringify(roomless.timetable.warnings))

const ready = all.find(s => s.section.id === buildable.id)
ok("required periods include the 3 weekly activities",
   ready.timetable.requiredPeriods === 4 + 3, `${ready.timetable.requiredPeriods}`)

// ---- build one section fully, watch the stage move ----
for (const [day, p] of [["MON",1],["TUE",1],["WED",1],["THU",1]]) {
  await j("POST", `/sections/${buildable.id}/entries`, { dayOfWeek: day, startPeriod: p, entryType: "THEORY", subjectId: ml.id })
}
r = await j("GET", "/build-status")
ok("stage moves to in progress",
   r.body.years.flatMap(y => y.sections).find(s => s.section.id === buildable.id)?.stage === "in-progress")

for (const [type, p] of [["LIBRARY",2],["SEMINAR",3],["COUNSELING",4]]) {
  await j("POST", `/sections/${buildable.id}/entries`, { dayOfWeek: "FRI", startPeriod: p, entryType: type })
}
r = await j("GET", "/build-status")
const finished = r.body.years.flatMap(y => y.sections).find(s => s.section.id === buildable.id)
ok("stage reaches done", finished?.stage === "done", finished?.stage)
ok("progress is 7 of 7 periods", finished.timetable.placedPeriods === 7, `${finished.timetable.placedPeriods}`)
ok("totals count the finished one", r.body.totals.done === 1, JSON.stringify(r.body.totals))

// ---- print all ----
r = await j("GET", "/print/sections")
ok("print returns every section", r.body.sections.length === 4, `${r.body.sections.length}`)
ok("print includes the shared grid", r.body.grid.slots.length === 9)
const printed = r.body.sections.find(s => s.section.id === buildable.id)
ok("print includes entries", printed.entries.length === 7, `${printed.entries.length}`)
ok("print includes the faculty legend", printed.legend[0]?.facultyName === "Sai Sir", printed.legend[0]?.facultyName)

r = await j("GET", "/print/sections?year=2")
ok("print filters by year", r.body.sections.length === 1 && r.body.sections[0].section.year === 2)

console.log(`\n${pass} passed, ${fail} failed`)
