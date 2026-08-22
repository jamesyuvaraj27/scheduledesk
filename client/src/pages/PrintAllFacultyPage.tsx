import * as React from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Printer, Users } from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback"
import { TimetableTable } from "@/components/timetable/TimetableTable"
import { ClassCell } from "@/components/timetable/ClassCell"
import { PrintFitPage } from "@/components/PrintFitPage"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { PrintAllFacultyResponse } from "@/lib/types"

type FacultyRow = PrintAllFacultyResponse["faculty"][number]
type Entry = FacultyRow["entries"][number]

/**
 * Every faculty member's timetable, one per printed page.
 *
 * The office used to get these by opening the Faculty Timetable page fourteen
 * times and hitting Print each time. One click here, or "Save as PDF" for the
 * whole set in a single file.
 *
 * It's one request, not one per person — see GET /print/faculty in
 * overview.ts, which loads the term once and slices it in memory.
 */
export function PrintAllFacultyPage() {
  const [includeEmpty, setIncludeEmpty] = React.useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ["print-faculty", includeEmpty],
    queryFn: () =>
      api.get<PrintAllFacultyResponse>(
        `/print/faculty${includeEmpty ? "?includeEmpty=1" : ""}`
      ),
  })

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (!data) return null

  return (
    <div className="space-y-4">
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="size-4" /> Print all faculty timetables
          </CardTitle>
          <CardDescription>
            {data.term.label} · {data.faculty.length} faculty timetable
            {data.faculty.length === 1 ? "" : "s"}. Each starts on its own page.
            Choose &ldquo;Save as PDF&rdquo; in the print dialog for a single file.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button onClick={() => window.print()} disabled={data.faculty.length === 0}>
            <Printer /> Print
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={includeEmpty}
              onChange={(e) => setIncludeEmpty(e.target.checked)}
            />
            Include faculty with no classes
          </label>
          <div className="ml-auto flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/print">All sections</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/print/rooms">All rooms</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.faculty.length === 0 ? (
        <Card className="print:hidden">
          <CardContent className="pt-5">
            <EmptyState
              title="Nothing to print yet"
              hint="No faculty member has any class placed in the active term."
            />
          </CardContent>
        </Card>
      ) : (
        data.faculty.map((row, index) => (
          <section
            key={row.faculty.id}
            // Each sheet starts a new page, but don't waste one before the first.
            className={cn(index > 0 && "print:break-before-page")}
          >
            <PrintFitPage className="rounded-xl border bg-card p-5 print:border-0 print:p-0 print:rounded-none">
              <FacultySheet row={row} grid={data.grid} termLabel={data.term.label} />
            </PrintFitPage>
          </section>
        ))
      )}
    </div>
  )
}

function FacultySheet({
  row,
  grid,
  termLabel,
}: {
  row: FacultyRow
  grid: PrintAllFacultyResponse["grid"]
  termLabel: string
}) {
  const { faculty, entries, summary } = row

  return (
    <>
      <header className="text-center mb-4">
        <h2 className="font-semibold text-lg">
          {faculty.facultyNo} — {faculty.name}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {faculty.departmentCode} · {termLabel} · {summary.weeklyPeriods} periods /
          week · {summary.freePeriods} free
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No classes placed for this faculty member in {termLabel}.
        </p>
      ) : (
        <>
          <TimetableTable<Entry>
            slots={grid.slots}
            workingDays={grid.workingDays}
            entries={entries}
            renderEntry={(entry, isFirstRun) => (
              <ClassCell
                entryType={entry.entryType}
                isFirstRun={isFirstRun}
                primary={entry.subject?.code}
                // On a faculty sheet the useful second line is which class
                // they're standing in front of, not their own name.
                secondary={`${entry.section.branchCode}-${entry.section.name} · ${toRoman(
                  entry.section.year
                )}`}
                room={entry.room?.name}
              />
            )}
            renderEmpty={() => (
              <div className="w-full h-full min-h-[3.5rem] flex items-center justify-center text-[10px] text-muted-foreground/50">
                free
              </div>
            )}
          />
        </>
      )}
    </>
  )
}

function toRoman(year: number): string {
  return ["I", "II", "III", "IV"][year - 1] ?? String(year)
}
