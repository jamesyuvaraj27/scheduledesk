# ScheduleDesk — College Timetable Scheduling System
### Master Specification & Implementation Plan (Draft v2 — confirmed, ready to build)

---

## 1. What I understood

Single-admin, no-login web app. It builds **section timetables** (currently focused on 2nd year, 8 sections) around **already-fixed 3rd/4th year timetables and faculty commitments**, then auto-derives each **faculty's individual timetable** from whatever is scheduled across all years. Assignment is **manual, not auto-generated** — you pick subject → faculty → slot, and the system's only job is to block/warn on clashes (faculty, room, section) and enforce lab-continuity and weekly-hour rules. Everything about timings (start/end, break, lunch, period count/length) is admin-editable, not hardcoded. A "reset" clears a year's timetable/assignments but keeps faculty, departments, branches, rooms.

Locked-in rules from your answers:
- Labs: exactly 3 continuous periods, placed only by you clicking the slot manually (no auto-lab-placement).
- Lunch does **not** break lab continuity; break **does**. So a lab can span "period before lunch + 2 periods after lunch" but not "period before break + periods after break."
- Room clash detection: yes.
- Faculty subject eligibility is many-to-many (multiple faculty can teach AI), but once a faculty is assigned to a specific section/subject for the term, that's fixed — no auto-substitution if they're busy.
- Faculty workload and subject-hour progress shown live; periods run in a fixed daily sequence (not rotating).
- Everything editable, nothing seeded — DB starts empty, no demo data ever.

If any of the above is wrong, tell me and I'll fix this doc before we write code.

---

## 2. Should you clone an existing project instead of building this?

I looked. Short answer: **no, build custom.** Here's why, and what's out there:

| Project | What it is | Why it doesn't fit |
|---|---|---|
| [FET](https://lalescu.ro/liviu/fet/) / [FET Web](https://fet-web.vercel.app/) | Mature, well-known constraint-solver that **auto-generates** a full timetable from constraints in 5–20 min | Wrong paradigm entirely — you want manual, cell-by-cell assignment with live clash-blocking, not a solver you feed constraints into. Retrofitting a manual-first UX onto FET's engine is more work than building one. |
| [UniTime](https://github.com/UniTime/unitime) | Full university-scale scheduling suite (Java/enterprise) | Massive, multi-role, built for room/exam/student-registration scheduling at university scale. Huge overkill for a single-admin department tool, and not in your stack. |
| [Open Timetable Cloud](https://github.com/bonafide-ngo/opentimetable-cloud), [openTimetables](https://github.com/rocristoi/openTimetables) | School-timetable generators (constraint programming backend) | Same auto-generation paradigm; not built around your dept → branch → section hierarchy or the "derive faculty timetable from existing years" workflow. |
| MERN "Automated Timetable Generator" repos (e.g. [amitgatkal2530](https://github.com/amitgatkal2530/Automated-Timetable-Generator-)) | Student-project scale generators | Generic auto-generators, MongoDB-based, no lab-continuity/lunch-vs-break rule, no faculty-derived-view concept. Fine for UI inspiration only. |

Nothing matches your actual workflow: existing upstream timetable → derive faculty free time → manually place 2nd year around it → auto-view faculty schedule. That's a fairly specific piece of domain logic no OSS project has. Building it is also directly a **ScheduleDesk** portfolio project in your own stack, which is worth more to you than adapting a Java constraint solver you'd fight the whole time.

---

## 3. Tech stack (matches your existing skills)

- **Frontend:** React + Vite + TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Node.js + Express + TypeScript
- **DB:** PostgreSQL (Neon), Prisma ORM
- **Auth:** none — spec explicitly excludes it
- **Hosting:** Vercel (frontend), Render (backend) — or both on Render; your call later
- **Print/export:** browser print CSS for on-screen print; server-side PDF render (Puppeteer) for a clean downloadable file

Monorepo layout:
```
/client   → React app
/server   → Express API
/prisma   → schema.prisma, migrations
```

---

## 4. Key architecture decisions (better approaches than the raw plan we sketched)

**a. Faculty timetable is a live query, not a "regenerated" table.**
Rather than storing a separate faculty-timetable table that gets "recalculated" after every save (sync bugs waiting to happen), a faculty's timetable is just `SELECT * FROM TimetableEntry WHERE facultyId = X` across every section/year for the active term. It's always correct, instantly, with zero regeneration step. "Auto-updates when section timetable changes" falls out for free.

**b. Reset = new term, not delete.**
Instead of wiping rows, every timetable entry, curriculum mapping, and subject-faculty assignment belongs to an `AcademicTerm`. "Reset Academic Year" creates a new term and makes it active; the old term's data stays in the DB, queryable, but hidden from the active view. This gives you free year-over-year history (exactly your own example: 2026 Sai Sir teaches AI/ML, 2027 he teaches NLP/DL — both records exist, nothing was destroyed) at basically no extra cost over a hard delete.

**c. Period grid is computed from a small config, not hardcoded.**
Admin sets: start time, number of periods, period duration (minutes), where break falls (after period N, duration), where lunch falls (after period M, duration). The system walks these forward to produce actual clock times for display. This is what makes 8–3/50-min and 9–5/60-min (or any other combination) just config changes, no code changes. Lab-eligible 3-period windows are *derived* from this config too (see §6), not a fixed list — so if you move lunch, valid lab slots recompute automatically.

**d. Branches without sections still get one Section row.**
Rather than special-casing "no sections," a branch with no divisions just gets a single implicit Section (e.g. "CSE"). Keeps every query and every UI component uniform — no `if (branch.hasSections)` branching scattered through the app.

**e. Library/Seminar/Counseling are entry types, not fake subjects.**
`TimetableEntry.entryType` is an enum (`THEORY`, `LAB`, `LIBRARY`, `SEMINAR`, `COUNSELING`, `BREAK`, `LUNCH`). Library/Seminar/Counseling need a room but not necessarily a specific faculty, so modeling them as real subjects with fake "faculty" would pollute faculty workload numbers. This keeps the 1-hour weekly requirement for each simple to validate.

---

## 5. Data model

| Entity | Key fields | Notes |
|---|---|---|
| `AcademicTerm` | id, year, semester, label, isActive | One active term at a time; reset creates a new one |
| `TimeConfig` | termId, startTime, numPeriods, periodDurationMin, breakAfterPeriod, breakDurationMin, lunchAfterPeriod, lunchDurationMin, workingDays[] | One per term; fully editable |
| `Department` | id, name, code | ASCE, CSE, ECE, EEE, Mech, Civil |
| `Branch` | id, departmentId, name, code | AIML, CAI, CSM, CSD, CSE, ECE, ... |
| `Section` | id, branchId, year, name | Every branch has ≥1 section (see §4d) |
| `Room` | id, name, type (classroom/lab/library/seminar-hall), capacity | |
| `Faculty` | id, name, departmentId, isActive | |
| `FacultySubject` | facultyId, subjectId | Eligibility (many-to-many) |
| `Subject` | id, branchId or shared, name, **code**, type (theory/lab) | 5 subjects per section; short `code` (e.g. `BDA`, `ESIA`) is what's shown in grid cells, matching your sample sheet |
| `SectionSubject` | termId, sectionId, subjectId, weeklyTheoryHrs, weeklyLabHrs | Curriculum config, per term |
| `SectionAssignment` | termId, sectionId, subjectId, facultyId | Locked-in Section→Subject→Faculty mapping |
| `TimetableEntry` | termId, sectionId, dayOfWeek, startPeriod, periodSpan (1 or 3), entryType, subjectId?, facultyId?, roomId? | The actual placed cell(s) |

`Section` also gets a **`homeRoomId`** (its fixed classroom). Per your answer #5, rooms are fixed — only `LAB` entries get a different `roomId` (the lab room); every other entry type (theory, library, seminar, counseling) uses the section's `homeRoomId`.

Faculty individual timetable = derived view over `TimetableEntry` (§4a). No separate table.

---

## 6. Conflict & rule engine

Every attempted placement (`section, day, startPeriod, span`) is checked before it's allowed to sit in the grid, and re-checked at Save:

1. **Faculty clash** — no other `TimetableEntry` for that faculty at an overlapping day/period across *any* section/year in the active term.
2. **Room clash** — same check on `roomId`.
3. **Section clash** — a section can't have two entries in the same slot (trivially enforced since the grid is per-section, but reused when computing "free" slots).
4. **Lab window validity** — a lab may only start at a period that is part of a precomputed valid 3-period window. Windows are generated from `TimeConfig` by walking the day's periods and only breaking a window at `breakAfterPeriod` (never at `lunchAfterPeriod`). E.g. with periods 1–7, break after 2, lunch after 5: valid lab starts might be {3,4}(→3,4,5) or {4,5,6} spanning the lunch slot, but never a window that crosses the break.
5. **Weekly hour tracking** — running total per section/subject vs. `SectionSubject.weeklyTheoryHrs/weeklyLabHrs`, shown live in the builder UI; **Save is hard-blocked** if any subject is under or over its required weekly hours.
6. **Faculty daily load** — shown live (not hard-capped at 6, since your own example — 4 theory + 3-hr lab = 7 — is valid); a soft warning threshold is configurable per faculty or globally.

The manual-assignment picker (for 2nd year, but reusable for any year) works exactly as you described: pick Section → pick Subject → pick Faculty (dropdown auto-filtered to eligible faculty who have *some* free slot this week) → grid highlights every slot that's valid for that faculty/subject/room combo and disables/greys out everything that clashes. For labs, hovering a valid start period previews the full 3-period block before you click to confirm.

---

## 7. Workflow

1. Set up master data once: Departments → Branches → Sections → Rooms → Faculty (+ eligible subjects).
2. Per term: configure `TimeConfig`, then `SectionSubject` (curriculum + weekly hours) and `SectionAssignment` (subject→faculty) for each section.
3. Build timetables top-down (4th → 3rd → 2nd → 1st) as you described — this is a **suggested order in the UI** (a dashboard shows per-section completion status), not a hard gate, since faculty availability is always computed live from whatever's already placed, regardless of order.
4. Build/edit a section's grid using the clash-blocked picker; nothing is permanent until Save, which re-runs full validation.
5. View any faculty's derived timetable at any time — it's always current.
6. Print/export section or faculty timetables.
7. End of year: **Reset Academic Year** → new `AcademicTerm`, master data untouched, previous term's data preserved for history.

---

## 8. UI structure

Grid orientation is now confirmed from your sample sheet (4th year CSM timetable) — **Days as rows, Periods as columns**, exactly matching my default. Layout, top to bottom, per section:

- **Header band** — Year & Sem, Branch (Section), Date/Academic term.
- **Two-row period header** — one row of period *start* times, one row of period *end* times, per column (e.g. `08:00`/`08:50` for period 1). `BREAK` and `LUNCH` are their own merged columns spanning all day-rows, with vertical label text, positioned wherever `TimeConfig` puts them (your sample: break after period 2, lunch after period 5, 50-min periods, 20-min break, 50-min lunch, 8:00–3:00 — this is effectively your default `TimeConfig`).
- **Day rows (Mon–Sat)** — each cell shows the subject **code** (e.g. `BDA`, `ESIA`, `RL`), matching your sheet exactly rather than the full subject name.
- **Legend block below the grid** — two columns of `CODE: Faculty Name` pairs, one line per subject — exactly your sample's format.
- **Room sub-grid below the legend** — a second, smaller grid with the same day×period structure, showing the room in use each period. Since rooms are fixed (§10 answer 5), this row is just the section's `homeRoomId` repeated, except during `LAB` entries where it shows the lab room instead.

Pages:
- **Dashboard** — per-year/section build status, quick links.
- **Master data admin** — Departments, Branches, Sections (+ home room), Rooms, Faculty (+ eligible subjects), Subjects (name + code).
- **Term setup** — time config, curriculum per section, subject→faculty assignment.
- **Section timetable builder** — the manual clash-blocked grid editor.
- **Section timetable view/print** — the layout described above.
- **Faculty timetable view/print** — same grid shape, one row of cells per day, each cell showing Section/Branch/Room or "Free."
- **Reset Academic Year** — confirmation flow, creates new term.

---

## 9. Build roadmap

| Phase | Scope |
|---|---|
| 0 ✅ | Repo scaffold: Vite+React+Tailwind+shadcn client, Express+TS server, Prisma+Neon connected, empty DB, no seed data |
| 1 ✅ | Master data CRUD: Departments, Branches, Sections, Rooms, Faculty, Subjects, eligibility — plus academic terms and the TimeConfig editor with live period-grid preview |
| 2 ✅ | Curriculum per section (SectionSubject weekly hours) + Section→Subject→Faculty assignment (SectionAssignment), section readiness + faculty workload views |
| 3 ✅ | Conflict engine (server-side): clash checks, lab-window computation, hour tracking, slot-availability API — 53 unit tests + 26 integration checks |
| 4 ✅ | Section timetable builder UI: clash-blocked picker, lab 3-period selection, live validation |
| 5 ✅ | Section timetable view (matching the sample sheet) + faculty derived-timetable view |
| 6 ✅ | Print CSS (landscape, chrome stripped, colours kept) + a print-all-sections page; browser "Save as PDF" gives one file, so no server-side PDF dependency was added |
| 7 ✅ | Reset Academic Year flow + term history browsing, with guarded term delete |
| 8 ✅ | Dashboard driven by per-section build status, print-all page, missing-home-room warning |
| 9 ✅ | Excel/CSV import for existing 3rd/4th year sheets — two-step preview then commit, creates the subjects/faculty/curriculum the sheet implies, every placement still checked by the conflict engine |

Each phase is independently demoable, which matches building this as a real portfolio piece rather than one big bang.

---

## 10. Decisions locked

1. Grid orientation: **days as rows, periods as columns** — confirmed against your sample sheet (§8).
2. Weekly-hour rule: **hard block** at Save if a subject is under/over its required hours.
3. Faculty daily load: **soft warning only**, default threshold 6 teaching hrs/day, editable.
4. No activity types beyond Theory/Lab/Library/Seminar/Counseling — `PROJECT`/`NPTEL`-style entries from your existing sheets just become ordinary theory-type subjects with that code, no schema change needed.
5. Rooms: **fixed home classroom per section**; only `LAB` entries move to a different (lab) room.

Starting Phase 0.
