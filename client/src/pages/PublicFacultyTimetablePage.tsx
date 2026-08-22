import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Users, Printer } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback"
import { TimetableTable } from "@/components/timetable/TimetableTable"
import { ClassCell } from "@/components/timetable/ClassCell"
import { PrintFitPage } from "@/components/PrintFitPage"
import { api } from "@/lib/api"
import type { PublicFacultyTimetable, PublicMeta } from "@/lib/types"

type Entry = PublicFacultyTimetable["entries"][number]

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

  if (meta.isLoading) return <LoadingState label="Loading faculty…" />
  if (meta.error) return <ErrorState error={meta.error} />
  if (!meta.data) return null

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
