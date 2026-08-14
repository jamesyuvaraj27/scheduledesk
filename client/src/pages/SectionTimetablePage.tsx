import { Link, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Pencil, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ErrorState, LoadingState } from "@/components/ui/feedback"
import { TimetableTable } from "@/components/timetable/TimetableTable"
import { buildDayCells } from "@/components/timetable/gridLayout"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { SectionTimetable, TimetableEntry } from "@/lib/types"

/**
 * The printable section timetable, laid out like the sheet the office
 * already uses: header block, grid, subject/faculty legend, room sub-grid.
 */
export function SectionTimetablePage() {
  const { sectionId = "" } = useParams()

  const { data, isLoading, error } = useQuery({
    queryKey: ["timetable", sectionId],
    queryFn: () => api.get<SectionTimetable>(`/sections/${sectionId}/timetable`),
  })

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (!data) return null

  const { section, grid, entries, legend, term } = data
  const homeRoom = section.homeRoom?.name ?? "—"

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/curriculum">
            <ArrowLeft /> All sections
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/sections/${sectionId}/builder`}>
              <Pencil /> Edit
            </Link>
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 print:border-0 print:p-0">
        <header className="text-center mb-4">
          {/* Branch, section and room lead the sheet — it's how the office
              identifies which timetable they're holding. */}
          <h1 className="font-semibold text-xl">
            {section.branch?.code ?? section.branch?.name} · Section{" "}
            {section.name} · Room {homeRoom}
          </h1>
          <p className="text-sm font-medium mt-1">
            {section.branch?.name}
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            Year &amp; Sem : {toRoman(section.year)} — {term.label}
            {section.branch?.department?.code
              ? ` · ${section.branch.department.code}`
              : ""}
          </p>
        </header>

        <TimetableTable<TimetableEntry>
          slots={grid.slots}
          workingDays={grid.workingDays}
          entries={entries}
          renderEntry={(entry, isFirstRun) => (
            <div
              className={cn(
                "w-full h-11 flex items-center justify-center px-1 text-xs font-semibold",
                entry.entryType === "LAB" && "bg-warning/15",
                !entry.subject && "text-muted-foreground"
              )}
            >
              {entry.subject
                ? entry.subject.code
                : entry.entryType === "COUNSELING"
                  ? "COUN"
                  : entry.entryType.slice(0, 3)}
              {entry.entryType === "LAB" && isFirstRun && (
                <span className="font-normal ml-1">LAB</span>
              )}
            </div>
          )}
        />

        {legend.length > 0 && (
          <div className="mt-4 grid gap-x-10 gap-y-1 sm:grid-cols-2 text-sm">
            {legend.map((l) => (
              <div key={l.subjectId} className="flex gap-2">
                <span className="font-semibold min-w-16">{l.code}:</span>
                <span>{l.facultyName ?? "—"}</span>
              </div>
            ))}
          </div>
        )}

        <RoomSubGrid data={data} />
      </div>
    </div>
  )
}

/**
 * The room row printed under the timetable. Rooms are fixed per section, so
 * this is the home classroom every period except during labs.
 */
function RoomSubGrid({ data }: { data: SectionTimetable }) {
  const { grid, entries, section } = data
  const home = section.homeRoom?.name ?? "—"
  const hasLabs = entries.some((e) => e.entryType === "LAB")
  if (!hasLabs) {
    return (
      <p className="mt-4 text-sm">
        <span className="font-semibold">Room:</span> {home} (labs excepted)
      </p>
    )
  }

  return (
    <div className="mt-5">
      <p className="text-sm font-semibold mb-1">Rooms</p>
      <div className="overflow-x-auto">
        <table className="border-collapse text-center text-xs w-full min-w-[720px] table-fixed">
          <colgroup>
            <col className="w-14" />
            {grid.slots.map((s, i) => (
              <col key={i} className={s.kind === "PERIOD" ? "" : "w-9"} />
            ))}
          </colgroup>
          <tbody>
            {grid.workingDays.map((day, rowIndex) => {
              const cells = buildDayCells(day, grid.slots, entries)
              return (
                <tr key={day}>
                  <th className="border px-1 py-1 font-semibold bg-muted/40">{day}</th>
                  {cells.map((cell, i) => {
                    if (cell.kind === "pause") {
                      return rowIndex === 0 ? (
                        <td
                          key={i}
                          rowSpan={grid.workingDays.length}
                          className="border bg-muted"
                        />
                      ) : null
                    }
                    const room =
                      cell.kind === "entry" && cell.entry.room
                        ? cell.entry.room.name
                        : home
                    return (
                      <td
                        key={i}
                        colSpan={cell.colSpan}
                        className={cn(
                          "border px-1 py-1",
                          cell.kind === "entry" &&
                            cell.entry.entryType === "LAB" &&
                            "bg-warning/15 font-medium"
                        )}
                      >
                        {room}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function toRoman(year: number): string {
  return ["I", "II", "III", "IV"][year - 1] ?? String(year)
}
