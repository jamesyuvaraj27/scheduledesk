import * as React from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { DoorOpen, Printer } from "lucide-react"
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
import { FLOOR_LABELS, type PrintAllRoomsResponse, type RoomTimetableEntry } from "@/lib/types"

type RoomRow = PrintAllRoomsResponse["rooms"][number]

/**
 * Every room's timetable, one per printed page — classrooms, labs, the
 * library and seminar halls alike.
 *
 * Cells carry the YEAR_BRANCH_SECTION_SUBJECT shorthand the admin Room
 * Timetable page uses, so a sheet taped to a door reads the same as the
 * screen it came from. Faculty is printed underneath, because the person
 * standing outside the room wants to know who's inside it.
 */
export function PrintAllRoomsPage() {
  const [includeEmpty, setIncludeEmpty] = React.useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ["print-rooms", includeEmpty],
    queryFn: () =>
      api.get<PrintAllRoomsResponse>(
        `/print/rooms${includeEmpty ? "?includeEmpty=1" : ""}`
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
            <DoorOpen className="size-4" /> Print all room timetables
          </CardTitle>
          <CardDescription>
            {data.term.label} · {data.rooms.length} room
            {data.rooms.length === 1 ? "" : "s"}. Each starts on its own page.
            Choose &ldquo;Save as PDF&rdquo; in the print dialog for a single file.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button onClick={() => window.print()} disabled={data.rooms.length === 0}>
            <Printer /> Print
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={includeEmpty}
              onChange={(e) => setIncludeEmpty(e.target.checked)}
            />
            Include unused rooms
          </label>
          <div className="ml-auto flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/print">All sections</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/print/faculty">All faculty</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.rooms.length === 0 ? (
        <Card className="print:hidden">
          <CardContent className="pt-5">
            <EmptyState
              title="Nothing to print yet"
              hint="No room has a class timetabled in it for the active term."
            />
          </CardContent>
        </Card>
      ) : (
        data.rooms.map((row, index) => (
          <section
            key={row.room.id}
            className={cn(index > 0 && "print:break-before-page")}
          >
            <PrintFitPage className="rounded-xl border bg-card p-5 print:border-0 print:p-0 print:rounded-none">
              <RoomSheet row={row} grid={data.grid} termLabel={data.term.label} />
            </PrintFitPage>
          </section>
        ))
      )}
    </div>
  )
}

function RoomSheet({
  row,
  grid,
  termLabel,
}: {
  row: RoomRow
  grid: PrintAllRoomsResponse["grid"]
  termLabel: string
}) {
  const { room, entries } = row

  return (
    <>
      <header className="text-center mb-4">
        <h2 className="font-semibold text-lg">Room: {room.name}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {[
            room.block ? `Block ${room.block}` : null,
            room.floor ? FLOOR_LABELS[room.floor] : null,
            room.year ? `Year ${room.year}` : "Any year",
            termLabel,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          Nothing is timetabled in {room.name} this term.
        </p>
      ) : (
        <>
          <TimetableTable<RoomTimetableEntry>
            slots={grid.slots}
            workingDays={grid.workingDays}
            entries={entries}
            lanes
            renderEntry={(entry, isFirstRun) => (
              <ClassCell
                entryType={entry.entryType}
                isFirstRun={isFirstRun}
                primary={entry.label}
                faculty={entry.faculty?.name}
              />
            )}
            renderEmpty={() => (
              <div className="w-full h-full min-h-[3.5rem] flex items-center justify-center text-[10px] text-muted-foreground/50">
                free
              </div>
            )}
          />

          <p className="text-xs text-muted-foreground mt-2">
            Cells read YEAR_BRANCH_SECTION_SUBJECT, then who takes the class.
          </p>
        </>
      )}
    </>
  )
}
