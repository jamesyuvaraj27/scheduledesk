import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Users, Printer, Filter } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback"
import { TimetableTable } from "@/components/timetable/TimetableTable"
import { ClassCell } from "@/components/timetable/ClassCell"
import { FacultyDayTable } from "@/components/timetable/FacultyDayTable"
import { PrintFitPage } from "@/components/PrintFitPage"
import { api } from "@/lib/api"
import type {
  AdjustmentFacultyRow,
  AdjustmentResponse,
  Day,
  PublicFacultyTimetable,
  PublicMeta,
} from "@/lib/types"

type Entry = PublicFacultyTimetable["entries"][number]
type FreeScope = "" | "department" | "college"

/**
 * A faculty member's week, public and view-only — no sign-in, same as the
 * rest of /api/public. The grid, day/hour layout and faculty-selector
 * pattern are the same ones the admin Faculty Timetable already uses; this
 * page just points them at the public API instead.
 *
 * Faculty stays a single record throughout: picking "Ravi" here queries
 * `/public/faculty/:id/timetable`, one teacher's own entries. When a
 * Combined Section puts him in front of two sections in the same hour, that
 * query naturally returns both TimetableEntry rows (same facultyId, same
 * day/period, different sectionId) and the `lanes` prop below draws the
 * second as an extra row on just that hour — nothing else on his week
 * duplicates. A Shared Room never does this to a faculty view: the room's
 * other occupant belongs to a different faculty member, so it simply never
 * appears in this facultyId-filtered list.
 *
 * "Who's Free" (added 2026-08-23) is a second, independent panel below the
 * one-teacher grid above — pick a day, then a scope (their own department,
 * or the entire college), and see every faculty member's whole day for that
 * scope, FREE periods included, so someone can tell at a glance who's
 * available. It reuses `GET /public/adjustment?dayOfWeek=`, the same
 * endpoint and `FacultyDayTable` grid the Class Adjustment page already
 * uses — no new backend route needed, since that endpoint already returns
 * every active faculty member's day plus their `departmentId`.
 */
export function PublicFacultyTimetablePage() {
  const [params, setParams] = useSearchParams()

  const meta = useQuery({
    queryKey: ["public-meta"],
    queryFn: () => api.get<PublicMeta>("/public/meta"),
  })

  const facultyId = params.get("faculty") ?? ""

  // Land on the first faculty member rather than an empty screen.
  React.useEffect(() => {
    if (!meta.data?.faculty.length) return
    if (facultyId && meta.data.faculty.some((f) => f.id === facultyId)) return
    const next = new URLSearchParams(params)
    next.set("faculty", meta.data.faculty[0].id)
    setParams(next, { replace: true })
  }, [meta.data, facultyId, params, setParams])

  const timetable = useQuery({
    queryKey: ["public-faculty-timetable", facultyId],
    queryFn: () => api.get<PublicFacultyTimetable>(`/public/faculty/${facultyId}/timetable`),
    enabled: Boolean(facultyId),
  })

  // "Who's Free" state — its own day (defaults to the term's first working
  // day) and scope. Kept in the URL like `faculty` above so a link to "who's
  // free Wednesday, whole college" can be shared as-is.
  const freeDay = (params.get("freeDay") || meta.data?.days[0]?.value || "") as Day | ""
  const freeScope = (params.get("freeScope") ?? "") as FreeScope

  const setFreeDay = (value: string) => {
    const next = new URLSearchParams(params)
    next.set("freeDay", value)
    setParams(next)
  }

  // Ticking one scope always replaces the other — "Entire College" turns
  // "Department" off and vice versa, since a query only ever means one or
  // the other. Ticking an already-active box turns filtering off entirely.
  const setFreeScope = (next: "department" | "college") => {
    const nextParams = new URLSearchParams(params)
    if (freeScope === next) nextParams.delete("freeScope")
    else nextParams.set("freeScope", next)
    setParams(nextParams)
  }

  const whoFree = useQuery({
    queryKey: ["public-adjustment-wf", freeDay],
    queryFn: () => api.get<AdjustmentResponse>(`/public/adjustment?dayOfWeek=${freeDay}`),
    enabled: Boolean(freeDay) && freeScope !== "",
  })

  // Freest first (fewest periods taught that day), name as the tie-break —
  // same ordering the Class Adjustment page uses for its candidate tiers.
  const freeRows = React.useMemo(() => {
    if (!whoFree.data || freeScope === "") return []
    const byFreeness = (a: AdjustmentFacultyRow, b: AdjustmentFacultyRow) =>
      a.periodsTaughtToday - b.periodsTaughtToday || a.faculty.name.localeCompare(b.faculty.name)

    if (freeScope === "college") {
      return [...whoFree.data.faculty].sort(byFreeness)
    }
    // Department scope reuses the department of whichever faculty member is
    // currently selected above — there's no separate department dropdown.
    const myRow = whoFree.data.faculty.find((f) => f.faculty.id === facultyId)
    if (!myRow) return []
    return whoFree.data.faculty
      .filter((f) => f.faculty.departmentId === myRow.faculty.departmentId)
      .sort(byFreeness)
  }, [whoFree.data, freeScope, facultyId])

  if (meta.isLoading) return <LoadingState label="Loading faculty…" />
  if (meta.error) return <ErrorState error={meta.error} />
  if (!meta.data) return null

  const deptName = timetable.data?.faculty.departmentName
  const dayLabel = meta.data.days.find((d) => d.value === freeDay)?.label ?? freeDay

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Users className="size-5" />
            Faculty Timetable
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {meta.data.term.label} · published timetable
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>

      <Card className="print:hidden">
        <CardContent className="pt-5 flex flex-wrap gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor="faculty">Faculty</Label>
            <Select
              id="faculty"
              value={facultyId}
              onChange={(e) => {
                const next = new URLSearchParams(params)
                next.set("faculty", e.target.value)
                setParams(next)
              }}
            >
              {meta.data.faculty.length === 0 && <option value="">No faculty</option>}
              {meta.data.faculty.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {!facultyId ? (
        <EmptyState title="Pick a faculty member to see their week." />
      ) : timetable.isLoading ? (
        <LoadingState />
      ) : timetable.error ? (
        <ErrorState error={timetable.error} />
      ) : timetable.data ? (
        <FacultyGrid data={timetable.data} />
      ) : null}

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="size-4" /> Who&apos;s Free
          </CardTitle>
          <CardDescription>
            Pick a day and a scope to see every faculty member&apos;s day in
            that scope — free periods and all.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="w-40">
            <Label htmlFor="free-day">Day</Label>
            <Select id="free-day" value={freeDay} onChange={(e) => setFreeDay(e.target.value)}>
              {meta.data.days.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="accent-foreground"
                checked={freeScope === "department"}
                disabled={!facultyId}
                onChange={() => setFreeScope("department")}
              />
              {deptName ? `${deptName} department` : "Department"}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="accent-foreground"
                checked={freeScope === "college"}
                onChange={() => setFreeScope("college")}
              />
              Entire College
            </label>
          </div>
        </CardContent>
      </Card>

      {freeScope === "" ? null : (
        <div className="print:hidden">
          <h2 className="text-base font-semibold mb-1">
            {dayLabel} · {freeScope === "college" ? "Entire college" : deptName ? `${deptName} department` : "Department"}
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            FREE periods are shown as FREE; busy periods show what they&apos;re teaching.
          </p>
          {whoFree.isLoading ? (
            <LoadingState label="Loading the day's timetable…" />
          ) : whoFree.error ? (
            <ErrorState error={whoFree.error} />
          ) : !whoFree.data ? null : freeRows.length === 0 ? (
            <EmptyState title="No faculty found for this scope." />
          ) : (
            <div className="rounded-xl border bg-card p-4">
              <FacultyDayTable slots={whoFree.data.grid.slots} rows={freeRows} targetPeriod={null} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FacultyGrid({ data }: { data: PublicFacultyTimetable }) {
  const { faculty, grid, entries, summary, term } = data

  return (
    <PrintFitPage className="rounded-xl border bg-card p-5 print:border-0 print:p-0">
      <header className="text-center mb-4">
        <h2 className="font-semibold text-lg">{faculty.name}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {faculty.departmentCode} · {term.label}
        </p>
      </header>

      <div className="flex flex-wrap justify-center gap-2 mb-4 print:hidden">
        <Badge variant="secondary">{summary.weeklyPeriods} periods / week</Badge>
        <Badge variant="outline">{summary.freePeriods} free</Badge>
        {Object.entries(summary.byDay).map(([day, hours]) => (
          <Badge key={day} variant={hours > 6 ? "warning" : "outline"}>
            {day} {hours}
          </Badge>
        ))}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="Nothing scheduled yet"
          hint="This faculty member has no classes placed in the active term."
        />
      ) : (
        <>
          <TimetableTable<Entry>
            slots={grid.slots}
            workingDays={grid.workingDays}
            entries={entries}
            // A combined class reaches two sections at once, so this
            // teacher's hour carries an entry for each. Both are shown.
            lanes
            renderEntry={(entry, isFirstRun) => (
              <ClassCell
                entryType={entry.entryType}
                isFirstRun={isFirstRun}
                primary={entry.subject?.code}
                // The second line is the class they're teaching, not their
                // own name — this whole sheet is about one person already.
                secondary={`${entry.section.branchCode}-${entry.section.name} · ${toRoman(
                  entry.section.year
                )}`}
                room={entry.room?.name}
                title={`${entry.subject?.name ?? entry.entryType} · ${entry.section.branchCode}-${entry.section.name}`}
              />
            )}
            renderEmpty={() => (
              <div className="w-full h-full min-h-[3.5rem] flex items-center justify-center text-[10px] text-muted-foreground/50">
                free
              </div>
            )}
          />

          <p className="text-xs text-muted-foreground mt-3 print:hidden">
            Cells show subject, then section and year, then room. Generated
            from the section timetables — it updates itself.
          </p>
        </>
      )}
    </PrintFitPage>
  )
}

function toRoman(year: number): string {
  return ["I", "II", "III", "IV"][year - 1] ?? String(year)
}
