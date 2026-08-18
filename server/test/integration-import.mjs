const B = "http://localhost:4000/api"

import { requireEmptyDatabase } from "./guard.mjs"
await requireEmptyDatabase(B)
const j = async (m, p, b) => {
  const r = await fetch(B + p, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined })
  const t = await r.text()
  return { status: r.status, body: t ? JSON.parse(t) : null }
}
let pass = 0, fail = 0
const ok = (l, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${l}${x ? "  — " + x : ""}`) }

// The real 4th-year CSM sheet, merges already expanded (as the client does).
const SHEET = [
  ["Year & Sem : IV - I(CSM)"],
  ["Time", "08:00", "08:50", "09:40", "10:00", "10:50", "11:40", "12:30", "01:20", "02:10"],
  ["Day",  "08:50", "09:40", "10:00", "10:50", "11:40", "12:30", "01:20", "02:10", "03:00"],
  ["MON", "RL",   "NPTEL", "B", "HRPM", "BDA",  "ESIA", "L", "BCT",  "NPTEL"],
  ["TUE", "BDA",  "HRPM",  "R", "RL",   "HRPM", "BCT",  "U", "ESIA", "BCT"],
  ["WED", "ESIA", "RL",    "E", "BCT",  "BDA",  "ESIA", "N", "BDA",  "HRPM"],
  ["THU", "BDA",  "HRPM",  "A", "ESIA", "PE LAB", "PE LAB", "C", "PE LAB", ""],
  ["FRI", "HRPM", "RL",    "K", "BDA",  "ESIA", "BCT",  "H", "BCT",  "HRPM"],
  ["SAT", "NPTEL","ESIA",  "",  "RL",   "BDA",  "BCT",  "",  "HRPM", "RL"],
  [""],
  ["RL:", "Dr. R Arichandran", "", "", "", "PE LAB:", "Dr. R Arichandran"],
  ["BCT:", "Mr. V Paparao", "", "", "", "NPTEL:", "Ms. G. Sujini"],
  ["HRPM:", "Ms. P. Venkata Ramana"],
  ["ESIA:", "Mr. K Sriramulu"],
  ["BDA:", "Ms. K. Ramya Yashoda Lakshmi"],
]

const dept = (await j("POST", "/departments", { name: "Allied CSE", code: "asce" })).body
const [csm, aiml, r301, r204, lab1] = await Promise.all([
  j("POST", "/branches", { departmentId: dept.id, name: "CS & ML", code: "csm" }),
  j("POST", "/branches", { departmentId: dept.id, name: "AI & ML", code: "aiml" }),
  j("POST", "/rooms", { name: "Room 301", type: "CLASSROOM" }),
  j("POST", "/rooms", { name: "Room 204", type: "CLASSROOM" }),
  j("POST", "/rooms", { name: "Lab 1", type: "LAB" }),
]).then(rs => rs.map(r => r.body))
const [sec4, sec2] = await Promise.all([
  j("POST", "/sections", { branchId: csm.id, year: 4, name: "a", homeRoomId: r301.id }),
  j("POST", "/sections", { branchId: aiml.id, year: 2, name: "a", homeRoomId: r204.id }),
]).then(rs => rs.map(r => r.body))
await j("POST", "/terms", { year: 2026, semester: 1, label: "2026-27 Sem I", makeActive: true })

// ---- preview changes nothing ----
let r = await j("POST", `/sections/${sec4.id}/import/preview`, { rows: SHEET })
ok("preview succeeds", r.status === 200)
const pv = r.body
ok("finds 6 days", pv.summary.days === 6, `${pv.summary.days}`)
ok("detects PE LAB as a lab", pv.codes.find(c => c.code === "PE LAB")?.type === "LAB")
ok("reads faculty from legend", pv.codes.find(c => c.code === "RL")?.facultyName === "Dr. R Arichandran")
ok("knows nothing exists yet", pv.summary.needsSubjects === 7 && pv.summary.needsFaculty === 7,
   `subj=${pv.summary.needsSubjects} fac=${pv.summary.needsFaculty}`)
r = await j("GET", "/summary")
ok("preview wrote nothing", r.body.counts.subjects === 0 && r.body.counts.faculty === 0,
   `subjects=${r.body.counts.subjects} faculty=${r.body.counts.faculty}`)

// ---- commit ----
r = await j("POST", `/sections/${sec4.id}/import/commit`, { rows: SHEET, replaceExisting: true, createMissing: true })
ok("commit succeeds", r.status === 200)
const res = r.body
ok("nothing rejected", res.rejected.length === 0, JSON.stringify(res.rejected.slice(0,2)))
ok("all entries imported", res.imported === res.total, `${res.imported}/${res.total}`)
// Dr. R Arichandran appears twice in the legend (RL and PE LAB) but is one
// person, so 7 codes yield 7 subjects and 6 faculty.
ok("created subjects + faculty", res.created.subjects === 7 && res.created.faculty === 6,
   `s=${res.created.subjects} f=${res.created.faculty}`)

r = await j("GET", `/sections/${sec4.id}/timetable`)
const tt = r.body
ok("timetable now populated", tt.entries.length === res.imported)
const lab = tt.entries.find(e => e.entryType === "LAB")
ok("lab stored as a 3-period block", lab?.periodSpan === 3, `span=${lab?.periodSpan}`)
ok("lab placed in a lab room", lab?.room?.name === "Lab 1", lab?.room?.name)
ok("lab spans lunch (starts period 4)", lab?.startPeriod === 4, `p${lab?.startPeriod}`)
ok("theory uses the section home room", tt.entries.find(e => e.entryType === "THEORY")?.room?.name === "Room 301")
ok("curriculum hours derived from the sheet", tt.validation.subjects.length === 7, `${tt.validation.subjects.length}`)
ok("legend built from import", tt.legend.find(l => l.code === "RL")?.facultyName === "Dr. R Arichandran")

// ---- the imported year now constrains 2nd year ----
const rl = tt.legend.find(l => l.code === "RL")
r = await j("GET", "/faculty")
const arichandran = r.body.find(f => f.name === "Dr. R Arichandran")
ok("faculty timetable reflects import", arichandran != null)
r = await j("GET", `/faculty/${arichandran.id}/timetable`)
ok("faculty has a full week from one import", r.body.summary.weeklyPeriods > 5, `${r.body.summary.weeklyPeriods} periods`)

// ---- conflict engine still enforced on import ----
r = await j("POST", `/sections/${sec2.id}/import/preview`, { rows: SHEET })
ok("can preview the same sheet into another section", r.status === 200)
r = await j("POST", `/sections/${sec2.id}/import/commit`, { rows: SHEET, replaceExisting: true, createMissing: true })
ok("import into a clashing section is rejected, not forced",
   r.body.rejected.length > 0 && r.body.imported === 0,
   `${r.body.rejected.length} rejected, ${r.body.imported} placed`)
ok("rejection explains the clash", /teaching|already/.test(r.body.rejected[0]?.reason ?? ""), r.body.rejected[0]?.reason)

// ---- bad sheet handling ----
const wrongTimes = SHEET.map(row => [...row])
wrongTimes[1] = ["Time", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]
wrongTimes[2] = ["Day", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]
r = await j("POST", `/sections/${sec4.id}/import/preview`, { rows: wrongTimes })
ok("mismatched timings rejected with guidance", r.status === 422 && /Term Setup/.test(r.body.error), r.body.error?.slice(0, 60))

r = await j("POST", `/sections/${sec4.id}/import/preview`, { rows: [["nothing", "here"]] })
ok("a nonsense sheet is rejected", r.status === 422)

console.log(`\n${pass} passed, ${fail} failed`)
