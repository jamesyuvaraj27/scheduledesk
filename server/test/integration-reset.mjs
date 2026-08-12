const B = "http://localhost:4000/api"
const j = async (m, p, b) => {
  const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined })
  const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : null }
}
let pass = 0, fail = 0
const ok = (l, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${l}${x ? "  — " + x : ""}`) }

const SHEET = [
  ["Time", "08:00", "08:50", "09:40", "10:00", "10:50", "11:40", "12:30", "01:20", "02:10"],
  ["Day",  "08:50", "09:40", "10:00", "10:50", "11:40", "12:30", "01:20", "02:10", "03:00"],
  ["MON", "RL", "BDA", "B", "HRPM", "BDA", "ESIA", "L", "BCT", "RL"],
  ["TUE", "BDA", "HRPM", "R", "RL", "HRPM", "BCT", "U", "ESIA", "BCT"],
  ["RL:", "Dr. R Arichandran"],
  ["BCT:", "Mr. V Paparao"],
  ["HRPM:", "Ms. P. Venkata Ramana"],
  ["ESIA:", "Mr. K Sriramulu"],
  ["BDA:", "Ms. K. Ramya"],
]

const dept = (await j("POST", "/departments", { name: "Allied CSE", code: "asce" })).body
const [br, room] = await Promise.all([
  j("POST", "/branches", { departmentId: dept.id, name: "CS & ML", code: "csm" }),
  j("POST", "/rooms", { name: "Room 301", type: "CLASSROOM" }),
]).then(rs => rs.map(r => r.body))
const sec = (await j("POST", "/sections", { branchId: br.id, year: 4, name: "a", homeRoomId: room.id })).body
const term1 = (await j("POST", "/terms", { year: 2026, semester: 1, label: "2026-27 Sem I", makeActive: true })).body

// Populate year one via import so there is real data to preserve.
const imported = (await j("POST", `/sections/${sec.id}/import/commit`, { rows: SHEET, replaceExisting: true, createMissing: true })).body
ok("year one populated", imported.imported > 0, `${imported.imported} classes`)

const before = (await j("GET", "/summary")).body.counts
const tt1 = (await j("GET", `/sections/${sec.id}/timetable`)).body

// ---- preview ----
let r = await j("GET", "/terms/reset-preview")
ok("preview reports current term", r.body.currentTerm?.id === term1.id)
ok("preview counts what is preserved", r.body.preserved.faculty === before.faculty && r.body.preserved.subjects === before.subjects,
   `fac=${r.body.preserved.faculty} sub=${r.body.preserved.subjects}`)
ok("preview counts what is archived", r.body.archived.entries === imported.imported, `${r.body.archived.entries}`)
ok("suggests the next semester", r.body.suggestion.year === 2026 && r.body.suggestion.semester === 2,
   `${r.body.suggestion.year} sem ${r.body.suggestion.semester}`)

// ---- reset ----
r = await j("POST", "/terms/reset", {
  year: 2026, semester: 2, label: "2026-27 Sem II",
  copyTimeConfigFromTermId: term1.id,
  copyCurriculumFromTermId: term1.id,
})
ok("reset creates the new term", r.status === 201 && r.body.isActive === true)
const term2 = r.body
ok("curriculum carried over", term2.copiedCurriculumRows === tt1.validation.subjects.length,
   `${term2.copiedCurriculumRows} of ${tt1.validation.subjects.length}`)
ok("timings carried over", term2.timeConfig.startTime === "08:00" && term2.timeConfig.numPeriods === 7)

// ---- what survived ----
const after = (await j("GET", "/summary")).body.counts
ok("master data untouched",
   after.departments === before.departments && after.branches === before.branches &&
   after.sections === before.sections && after.rooms === before.rooms &&
   after.faculty === before.faculty && after.subjects === before.subjects,
   JSON.stringify(after))

r = await j("GET", `/sections/${sec.id}/timetable`)
ok("new term starts with an empty timetable", r.body.entries.length === 0, `${r.body.entries.length}`)
ok("but the curriculum is already there", r.body.validation.subjects.length > 0, `${r.body.validation.subjects.length} subjects`)
ok("faculty assignments deliberately NOT copied",
   r.body.legend.every(l => l.facultyName === null),
   JSON.stringify(r.body.legend.map(l => l.facultyName)))

// ---- old term intact ----
r = await j("GET", "/terms")
const archived = r.body.find(t => t.id === term1.id)
ok("old term still exists", archived != null)
ok("old term keeps its classes", archived._count.timetableEntries === imported.imported,
   `${archived._count.timetableEntries}`)
ok("old term keeps its assignments", archived._count.sectionAssignments > 0)
ok("only one term is active", r.body.filter(t => t.isActive).length === 1)

// ---- switch back and confirm history is readable ----
await j("POST", `/terms/${term1.id}/activate`)
r = await j("GET", `/sections/${sec.id}/timetable`)
ok("last year's timetable reads back exactly", r.body.entries.length === imported.imported,
   `${r.body.entries.length} vs ${imported.imported}`)
ok("last year's faculty still attached", r.body.legend.some(l => l.facultyName === "Dr. R Arichandran"))

// ---- delete guards ----
r = await j("DELETE", `/terms/${term1.id}`)
ok("refuses to delete the active term", r.status === 409, r.body?.error)

await j("POST", `/terms/${term2.id}/activate`)
r = await j("DELETE", `/terms/${term1.id}`)
ok("deletes an inactive term", r.status === 204)
r = await j("GET", "/terms")
ok("deleted term is gone", !r.body.some(t => t.id === term1.id))
const finalCounts = (await j("GET", "/summary")).body.counts
ok("deleting a term does not touch master data",
   finalCounts.faculty === before.faculty && finalCounts.subjects === before.subjects,
   JSON.stringify(finalCounts))

console.log(`\n${pass} passed, ${fail} failed`)
