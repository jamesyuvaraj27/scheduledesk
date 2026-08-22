import { Link, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Pencil, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ErrorState, LoadingState } from "@/components/ui/feedback"
import { TimetableTable } from "@/components/timetable/TimetableTable"
import { ClassCell } from "@/components/timetable/ClassCell"
import { PrintFitPage } from "@/components/PrintFitPage"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { SectionTimetable, TimetableEntry } from "@/lib/types"

/**
 * The printable section timetable, laid out like the sheet the office
 * already uses: header block, grid, colour key, subject/faculty legend.
 *
 * Each cell now carries the subject, who takes it and the room, so the grid
 * answers a period completely on its own. The Room Allocation grid below is
 * kept deliberately — it's an admin working aid ("which of MY periods sit in
 * which room"), a different question from the room's own week on the Rooms
 * page, and it is not shown to students.
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
          <Link to="/admin/curriculum">
            <ArrowLeft /> All sections
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/admin/sections/${sectionId}/builder`}>
              <Pencil /> Edit
            </Link>
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        </div>
      </div>

      <PrintFitPage className="rounded-xl border bg-card p-5 print:border-0 print:p-0">
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
            <ClassCell
              entryType={entry.entryType}
              isFirstRun={isFirstRun}
              primary={entry.subject?.code}
              faculty={entry.faculty?.name}
              room={entry.room?.name}
              title={[
                entry.subject?.name,
                entry.faculty?.name,
                entry.room?.name,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          )}
          renderEmpty={() => (
            <div className="w-full h-full min-h-[3.5rem] flex items-center justify-center text-[10px] text-muted-foreground/50">
              free
            </div>
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

        <RoomAllocationGrid data={data} />
      </PrintFitPage>
    </div>
  )
}

/**
 * Room Allocation — the same grid as above, but each cell shows the room the
 * class runs in rather than the subject.
 *
 * This is a VIEW, not an editor. A class already carries its room, so this
 * reads that directly; the allocation itself is done from the room's own
 * timetable, which is where you can see what else is competing for the space.
 * Periods with no class stay blank — there is nothing to give a room to.
 */
function RoomAllocationGrid({ data }: { data: SectionTimetable }) {
  const { grid, entries, section } = data

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
        <p className="text-sm font-semibold">Room Allocation</p>
        <Link
          to="/admin/rooms"
          className="text-xs text-muted-foreground hover:text-foreground underline print:hidden"
        >
          Allocate from room timetables
        </Link>
      </div>
      <p className="text-xs text-muted-foreground mb-1.5 print:hidden">
        An admin working view — which room each of this section&rsquo;s own
        periods sits in. Students never see it.
      </p>

      <TimetableTable<TimetableEntry>
        slots={grid.slots}
        workingDays={grid.workingDays}
        entries={entries}
        renderEntry={(entry, isFirstRun) => (
          <div
            className={cn(
              "w-full h-full min-h-[3.5rem] flex items-center justify-center px-1 text-xs",
              entry.entryType === "LAB" && "font-medium",
              !entry.room && "text-muted-foreground italic"
            )}
          >
            {isFirstRun ? (entry.room?.name ?? "not set") : ""}
          </div>
        )}
      />

      <p className="text-xs text-muted-foreground mt-2 print:hidden">
        Home classroom is{" "}
        <span className="font-medium text-foreground">
          {section.homeRoom?.name ?? "not set"}
        </span>
        . Classes use it unless they've been allocated elsewhere.
      </p>
    </div>
  )
}

function toRoman(year: number): string {
  return ["I", "II", "III", "IV"][year - 1] ?? String(year)
}

/** "FAC003 — Ms. Y. Sireesha", or just the name on older data. */
function facultyLabel(l: { facultyName: string | null; facultyNo?: string | null }): string {
  if (!l.facultyName) return "\u2014"
  return l.facultyNo ? `${l.facultyNo} \u2014 ${l.facultyName}` : l.facultyName
}
