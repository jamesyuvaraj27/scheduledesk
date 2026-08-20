import * as React from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Printer, Users } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback"
import { TimetableTable } from "@/components/timetable/TimetableTable"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Faculty, FacultyTimetable } from "@/lib/types"

type Entry = FacultyTimetable["entries"][number]

/**
 * A faculty member's week. Nothing here is stored — it's derived from the
 * section timetables, so it's always in step with them.
 */
export function FacultyTimetablePage() {
  const { facultyId } = useParams()
  const navigate = useNavigate()

  const faculty = useQuery({
    queryKey: ["faculty"],
    queryFn: () => api.get<Faculty[]>("/faculty"),
  })

  // Land on the first faculty member rather than an empty screen.
  React.useEffect(() => {
    if (!facultyId && faculty.data?.length) {
      navigate(`/admin/faculty/${faculty.data[0].id}`, { replace: true })
    }
  }, [facultyId, faculty.data, navigate])

  const timetable = useQuery({
    queryKey: ["faculty-timetable", facultyId],
    enabled: Boolean(facultyId),
    queryFn: () => api.get<FacultyTimetable>(`/faculty/${facultyId}/timetable`),
  })

  if (faculty.isLoading) return <LoadingState />
  if (faculty.error) return <ErrorState error={faculty.error} />

  if (!faculty.data?.length) {
    return (
      <Card>
        <CardContent className="pt-5">
          <EmptyState
            title="No faculty yet"
            hint="Add faculty in Master Data to see their timetables."
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap print:hidden">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Users className="size-5" /> Faculty timetable
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generated from the section timetables — it updates itself.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Select
            value={facultyId ?? ""}
            onChange={(e) => navigate(`/admin/faculty/${e.target.value}`)}
            className="w-56"
          >
            {faculty.data.map((f) => (
              <option key={f.id} value={f.id}>
                {f.facultyNo} — {f.name}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        </div>
      </div>

      {timetable.isLoading ? (
        <LoadingState />
      ) : timetable.error ? (
        <ErrorState error={timetable.error} />
      ) : timetable.data ? (
        <FacultyGrid data={timetable.data} />
      ) : null}
    </div>
  )
}

function FacultyGrid({ data }: { data: FacultyTimetable }) {
  const { faculty, grid, entries, summary, term } = data

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {faculty.facultyNo} — {faculty.name}
          </CardTitle>
          <CardDescription>
            {faculty.department?.code} · {term.label}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="secondary">{summary.weeklyPeriods} periods / week</Badge>
          <Badge variant="outline">{summary.freePeriods} free</Badge>
          {Object.entries(summary.byDay).map(([day, hours]) => (
            <Badge key={day} variant={hours > 6 ? "warning" : "outline"}>
              {day} {hours}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          {entries.length === 0 ? (
            <EmptyState
              title="Nothing scheduled yet"
              hint="This faculty member has no classes placed in the active term."
            />
          ) : (
            <TimetableTable<Entry>
              slots={grid.slots}
              workingDays={grid.workingDays}
              entries={entries}
              renderEntry={(entry, isFirstRun) => (
                <div
                  className={cn(
                    "w-full h-11 flex flex-col items-center justify-center leading-tight px-1",
                    entry.entryType === "LAB" ? "bg-warning/15" : "bg-primary/10"
                  )}
                  title={`${entry.subject?.name ?? entry.entryType} · ${entry.section.branchCode}-${entry.section.name}`}
                >
                  <span className="text-xs font-semibold">
                    {entry.subject?.code ?? entry.entryType.slice(0, 3)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {entry.section.branchCode}-{entry.section.name} ·{" "}
                    {toRoman(entry.section.year)}
                  </span>
                  {isFirstRun && entry.room && (
                    <span className="text-[9px] text-muted-foreground">
                      {entry.room.name}
                    </span>
                  )}
                </div>
              )}
              renderEmpty={() => (
                <div className="w-full h-11 flex items-center justify-center text-[10px] text-muted-foreground/50">
                  free
                </div>
              )}
            />
          )}

          <p className="text-xs text-muted-foreground mt-3">
            Cells show subject, then section and year, then room.{" "}
            <Link to="/admin/curriculum" className="underline print:hidden">
              Change assignments in Curriculum.
            </Link>
          </p>
        </CardContent>
      </Card>
    </>
  )
}

function toRoman(year: number): string {
  return ["I", "II", "III", "IV"][year - 1] ?? String(year)
}
