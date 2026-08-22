import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Printer } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback"
import { Link } from "react-router-dom"
import { TimetableTable } from "@/components/timetable/TimetableTable"
import { ClassCell } from "@/components/timetable/ClassCell"
import { PrintFitPage } from "@/components/PrintFitPage"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { PrintAllResponse, TimetableEntry } from "@/lib/types"

/**
 * Every section's timetable on one page, each starting a new sheet when
 * printed. Saves the office printing eight pages one at a time — and
 * "Save as PDF" from here gives them the whole set as a single file.
 *
 * The faculty and room equivalents live at /admin/print/faculty and
 * /admin/print/rooms; the links across the top go there.
 */
export function PrintAllPage() {
  const [year, setYear] = React.useState<string>("")

  const { data, isLoading, error } = useQuery({
    queryKey: ["print-sections", year],
    queryFn: () =>
      api.get<PrintAllResponse>(`/print/sections${year ? `?year=${year}` : ""}`),
  })

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (!data) return null

  const withTimetables = data.sections.filter((s) => s.entries.length > 0)

  return (
    <div className="space-y-4">
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base">Print all timetables</CardTitle>
          <CardDescription>
            {data.term.label} · {withTimetables.length} section
            {withTimetables.length === 1 ? "" : "s"} with a timetable. Each starts on its
            own page. Choose &ldquo;Save as PDF&rdquo; in the print dialog for a single file.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div>
            <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-40">
              <option value="">All years</option>
              {[1, 2, 3, 4].map((y) => (
                <option key={y} value={y}>
                  Year {y} only
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={() => window.print()} disabled={withTimetables.length === 0}>
            <Printer /> Print all sections
          </Button>
          <Button asChild variant="outline">
            <Link to="/admin/print/faculty">
              <Printer /> All faculty
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/admin/print/rooms">
              <Printer /> All rooms
            </Link>
          </Button>
        </CardContent>
      </Card>

      {withTimetables.length === 0 ? (
        <Card className="print:hidden">
          <CardContent className="pt-5">
            <EmptyState
              title="Nothing to print yet"
              hint="No section in this selection has a timetable built."
            />
          </CardContent>
        </Card>
      ) : (
        withTimetables.map(({ section, entries, legend }, index) => (
          <section
            key={section.id}
            className={cn(
              // Each sheet starts a new page, but don't waste one before the first.
              index > 0 && "print:break-before-page"
            )}
          >
            <PrintFitPage className="rounded-xl border bg-card p-5 print:border-0 print:p-0 print:rounded-none">
              <header className="text-center mb-4">
                <h2 className="font-semibold text-lg">
                  {section.branch.code ?? section.branch.name} · Section{" "}
                  {section.name} · Room {section.homeRoom?.name ?? "—"}
                </h2>
                <p className="text-sm font-medium mt-1">{section.branch.name}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Year &amp; Sem : {toRoman(section.year)} — {data.term.label} ·{" "}
                  {section.department.code}
                </p>
              </header>

              {/* Subject, faculty and room all inside the cell — this sheet
                  used to be followed by a whole second grid just to say which
                  room each period was in. */}
              <TimetableTable<TimetableEntry>
                slots={data.grid.slots}
                workingDays={data.grid.workingDays}
                entries={entries}
                renderEntry={(entry, isFirstRun) => (
                  <ClassCell
                    entryType={entry.entryType}
                    isFirstRun={isFirstRun}
                    primary={entry.subject?.code}
                    faculty={entry.faculty?.name}
                    room={entry.room?.name}
                  />
                )}
              />

              {legend.length > 0 && (
                <div className="mt-3 pt-3 border-t grid gap-x-10 gap-y-1 sm:grid-cols-2 text-sm">
                  {legend.map((l) => (
                    <div key={l.subjectId} className="flex gap-2">
                      <span className="font-semibold min-w-16">{l.code}:</span>
                      <span>{facultyLabel(l)}</span>
                    </div>
                  ))}
                </div>
              )}
            </PrintFitPage>
          </section>
        ))
      )}
    </div>
  )
}

function toRoman(year: number): string {
  return ["I", "II", "III", "IV"][year - 1] ?? String(year)
}

/** "FAC003 — Ms. Y. Sireesha", or just the name on older data. Admin only. */
function facultyLabel(l: { facultyName: string | null; facultyNo?: string | null }): string {
  if (!l.facultyName) return "\u2014"
  return l.facultyNo ? `${l.facultyNo} \u2014 ${l.facultyName}` : l.facultyName
}
