import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { buildDayCells, displayTime, DAY_LABEL, type DayCell } from "@/components/timetable/gridLayout"
import type { Day, GridSlot, PrintAllResponse, TimetableEntry } from "@/lib/types"

/**
 * VIEW-ONLY report: pick a day, a year, and one or more sections, and see
 * just those sections' timetable for that day — one row per section.
 *
 * This reads the same data as the Print-all page (`/print/sections`, no
 * `year` filter so every section for every year comes back in one call) and
 * reuses the existing grid-layout helpers. It never writes anything: there
 * is no mutation, no drag-and-drop, no edit affordance anywhere on this
 * page. Nothing about section timetables, assignments, rooms, or master
 * data is touched by this file.
 */
export function DayWiseSectionReportPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["print-sections", "day-wise-all"],
    queryFn: () => api.get<PrintAllResponse>("/print/sections"),
  })

  const [day, setDay] = React.useState<Day | "">("")
  const [year, setYear] = React.useState<string>("")
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  // Land on the first working day and the first year that actually has
  // sections the moment data arrives, rather than showing an empty screen —
  // same pattern as the room timetable page.
  React.useEffect(() => {
    if (!data) return
    if (!day && data.grid.workingDays.length) setDay(data.grid.workingDays[0])
    if (year === "" && data.sections.length) {
      const years = [...new Set(data.sections.map((s) => s.section.year))].sort(
        (a, b) => a - b
      )
      if (years.length) setYear(String(years[0]))
    }
  }, [data, day, year])

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (!data) return null

  const years = [...new Set(data.sections.map((s) => s.section.year))].sort((a, b) => a - b)
  const sectionsForYear = year === "" ? [] : data.sections.filter((s) => String(s.section.year) === year)
  const selectedRows = sectionsForYear.filter((s) => selected.has(s.section.id))

  const toggleSection = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Sections belong to a year, so switching years starts the pick over —
  // matches "no automatic show" for a year no one has chosen sections in yet.
  const changeYear = (value: string) => {
    setYear(value)
    setSelected(new Set())
  }

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <h1 className="text-xl font-semibold">Day-wise Section Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Read-only report — pick a day, a year, and the sections you want to see. Nothing
          here can be edited; it only reads the timetables already built.
        </p>
      </div>

      <Card className="print:hidden">
        <CardContent className="pt-5 space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Day
              </label>
              <Select
                value={day}
                onChange={(e) => setDay(e.target.value as Day)}
                className="w-32"
              >
                {data.grid.workingDays.map((d) => (
                  <option key={d} value={d}>
                    {DAY_LABEL[d]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Year
              </label>
              <Select
                value={year}
                onChange={(e) => changeYear(e.target.value)}
                className="w-32"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {toRoman(y)} Year
                  </option>
                ))}
              </Select>
            </div>
            <Button size="sm" onClick={() => window.print()} disabled={selectedRows.length === 0}>
              <Printer /> Print
            </Button>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Sections
            </label>
            {sectionsForYear.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sections in this year yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sectionsForYear.map(({ section }) => (
                  <label
                    key={section.id}
                    className="flex items-center gap-1.5 text-sm rounded-md border px-2.5 py-1.5 cursor-pointer hover:bg-muted/60 select-none"
                  >
                    <input
                      type="checkbox"
                      className="accent-foreground"
                      checked={selected.has(section.id)}
                      onChange={() => toggleSection(section.id)}
                    />
                    {section.branch.code}-{section.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Print-only header block — the controls above are print:hidden. */}
      {day && year !== "" && selectedRows.length > 0 && (
        <div className="hidden print:block text-center mb-2">
          <p className="font-bold">SCHEDULEDESK</p>
          <p className="text-sm">{data.term.label}</p>
          <p className="font-semibold mt-1">DAY-WISE SECTION SCHEDULE</p>
          <p className="text-sm mt-1">
            Day: {DAY_LABEL[day]} &nbsp;·&nbsp; Year: {toRoman(Number(year))} Year &nbsp;·&nbsp;
            Sections: {selectedRows.map((r) => `${r.section.branch.code}-${r.section.name}`).join(", ")}
          </p>
        </div>
      )}

      {selectedRows.length === 0 ? (
        <Card className="print:hidden">
          <CardContent className="pt-5">
            <EmptyState
              title="No sections selected"
              hint="Check one or more sections above to see their timetable for the chosen day."
            />
          </CardContent>
        </Card>
      ) : (
        day && (
          <div className="rounded-xl border bg-card p-5 print:border-0 print:p-0">
            <ReportTable slots={data.grid.slots} day={day} rows={selectedRows} />
          </div>
        )
      )}
    </div>
  )
}

/** One row per selected section, one column per period/break/lunch slot. */
function ReportTable({
  slots,
  day,
  rows,
}: {
  slots: GridSlot[]
  day: Day
  rows: PrintAllResponse["sections"]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-center text-sm w-full min-w-[720px] table-fixed">
        <colgroup>
          <col className="w-28" />
          {slots.map((s, i) => (
            <col key={i} className={s.kind === "PERIOD" ? "" : "w-20"} />
          ))}
        </colgroup>

        <thead>
          <tr>
            <th className="border px-2 py-2 text-xs font-medium text-muted-foreground bg-muted/40">
              Section
            </th>
            {slots.map((s, i) => (
              <th
                key={i}
                className={cn(
                  "border px-1 py-2 text-xs font-medium",
                  s.kind !== "PERIOD" && "bg-muted text-muted-foreground"
                )}
              >
                {s.kind === "PERIOD" ? `${displayTime(s.startTime)}-${displayTime(s.endTime)}` : s.kind}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map(({ section, entries }) => {
            const cells = buildDayCells(day, slots, entries)
            return (
              <tr key={section.id}>
                <th className="border px-2 py-2 text-xs font-semibold bg-muted/20 text-left align-top">
                  {section.branch.code}-{section.name}
                </th>
                {cells.map((cell, i) => (
                  <ReportCell key={i} cell={cell} />
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ReportCell({ cell }: { cell: DayCell<TimetableEntry> }) {
  if (cell.kind === "pause") {
    return (
      <td className="border bg-muted px-1 py-2 text-center text-[11px] font-semibold tracking-wide text-muted-foreground">
        {cell.label}
      </td>
    )
  }

  if (cell.kind === "empty") {
    return (
      <td className="border px-1 py-2 text-center text-xs text-muted-foreground">
        FREE
      </td>
    )
  }

  const entry = cell.entry
  return (
    <td
      colSpan={cell.colSpan}
      className={cn(
        "border px-1.5 py-1.5 text-center align-top",
        entry.entryType === "LAB" && "bg-warning/15"
      )}
    >
      <div className="text-xs font-semibold leading-tight">{activityLabel(entry)}</div>
      <div
        className={cn(
          "text-[11px] leading-tight mt-0.5",
          !entry.faculty && "text-muted-foreground italic"
        )}
      >
        {entry.faculty?.name ?? "Faculty: Not Assigned"}
      </div>
      <div
        className={cn(
          "text-[11px] leading-tight",
          !entry.room && "text-muted-foreground italic"
        )}
      >
        {entry.room?.name ?? "Room: Not Assigned"}
      </div>
    </td>
  )
}

/** Subject/activity label shown on the top line of a cell. */
function activityLabel(entry: TimetableEntry): string {
  if (entry.subject) {
    return entry.entryType === "LAB" ? `${entry.subject.code} LAB` : entry.subject.code
  }
  // LIBRARY / SEMINAR / COUNSELING carry no subject — the entry type is the
  // activity itself.
  return entry.entryType
}

function toRoman(year: number): string {
  return ["I", "II", "III", "IV"][year - 1] ?? String(year)
}
