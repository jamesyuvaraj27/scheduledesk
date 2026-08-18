import * as React from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Printer, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog } from "@/components/ui/dialog"
import { ErrorState, LoadingState, EmptyState } from "@/components/ui/feedback"
import { TimetableTable } from "@/components/timetable/TimetableTable"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type {
  AllocatableResponse,
  Day,
  Room,
  RoomTimetable,
  RoomTimetableEntry,
} from "@/lib/types"
import { FLOOR_LABELS } from "@/lib/types"

/**
 * The room's own timetable, and where room allocation actually happens.
 *
 * Nothing extra is stored: a class already carries the room it runs in, so
 * allocating simply points an existing class at this room. That's why the
 * section's Room Allocation row updates the moment something is assigned here
 * — both views read the same field.
 */
export function RoomTimetablePage() {
  const { roomId = "" } = useParams()
  const navigate = useNavigate()

  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => api.get<Room[]>("/rooms"),
  })

  // Land on the first room rather than an empty screen.
  React.useEffect(() => {
    if (!roomId && rooms.data?.length) {
      navigate(`/rooms/${rooms.data[0].id}/timetable`, { replace: true })
    }
  }, [roomId, rooms.data, navigate])

  if (rooms.isLoading) return <LoadingState />
  if (rooms.error) return <ErrorState error={rooms.error} />
  if (!rooms.data?.length) {
    return (
      <EmptyState
        title="No rooms yet"
        hint="Add rooms in Master Data first — this page shows what each one is used for."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap print:hidden">
        <div>
          <h1 className="text-xl font-semibold">Room timetables</h1>
          <p className="text-sm text-muted-foreground">
            What each room is used for, hour by hour. Click a free period to put
            a class in this room.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={roomId}
            onChange={(e) => navigate(`/rooms/${e.target.value}/timetable`)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            {rooms.data.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.year ? ` — Year ${r.year}` : ""}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        </div>
      </div>

      {roomId ? <RoomGrid roomId={roomId} /> : null}
    </div>
  )
}

function RoomGrid({ roomId }: { roomId: string }) {
  const qc = useQueryClient()
  const [picking, setPicking] = React.useState<{ day: Day; period: number } | null>(null)
  const [inspecting, setInspecting] = React.useState<RoomTimetableEntry | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ["room-timetable", roomId],
    queryFn: () => api.get<RoomTimetable>(`/rooms/${roomId}/timetable`),
  })

  // Both the room grid and every section's allocation row read the same
  // field, so one invalidation keeps them in step.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["room-timetable"] })
    qc.invalidateQueries({ queryKey: ["timetable"] })
    qc.invalidateQueries({ queryKey: ["print-sections"] })
  }

  const clear = useMutation({
    mutationFn: (entryId: string) =>
      api.patch(`/entries/${entryId}/room`, { roomId: null }),
    onSuccess: () => {
      refresh()
      setInspecting(null)
    },
  })

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (!data) return null

  return (
    <div className="rounded-xl border bg-card p-5 print:border-0 print:p-0">
      <header className="text-center mb-4">
        <h2 className="font-semibold text-lg">Room: {data.room.name}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {[
            data.room.block ? `Block ${data.room.block}` : null,
            data.room.floor ? FLOOR_LABELS[data.room.floor] : null,
            data.room.year ? `Year ${data.room.year}` : "Any year",
            data.term.label,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <TimetableTable<RoomTimetableEntry>
        slots={data.grid.slots}
        workingDays={data.grid.workingDays}
        entries={data.entries}
        renderEntry={(entry, isFirstRun) => (
          <button
            type="button"
            onClick={() => setInspecting(entry)}
            className={cn(
              "w-full h-full min-h-11 px-1 py-1 text-[11px] leading-tight font-medium",
              "hover:bg-muted/70 transition-colors break-words",
              entry.entryType === "LAB" && "bg-warning/15"
            )}
          >
            {isFirstRun ? entry.label : ""}
          </button>
        )}
        renderEmpty={(day, period) => (
          <button
            type="button"
            onClick={() => setPicking({ day, period })}
            className="w-full h-full min-h-11 text-muted-foreground/40 hover:bg-muted/60 hover:text-foreground transition-colors text-lg leading-none print:hidden"
            aria-label={`Allocate a class to ${day} period ${period}`}
          >
            +
          </button>
        )}
      />

      <p className="text-xs text-muted-foreground mt-3 print:hidden">
        Each cell shows YEAR_BRANCH_SECTION_SUBJECT. Allocating a class here
        fills the same period in that section's Room Allocation table.
      </p>

      {picking && (
        <AllocateDialog
          roomId={roomId}
          day={picking.day}
          period={picking.period}
          onClose={() => setPicking(null)}
          onDone={refresh}
        />
      )}

      {inspecting && (
        <Dialog
          open
          onClose={() => setInspecting(null)}
          title={inspecting.label}
          description={`${inspecting.dayOfWeek} · period ${inspecting.startPeriod}${
            inspecting.periodSpan > 1
              ? `–${inspecting.startPeriod + inspecting.periodSpan - 1}`
              : ""
          } in ${data.room.name}`}
        >
          <div className="space-y-3">
            <dl className="text-sm space-y-1">
              <div className="flex gap-2">
                <dt className="text-muted-foreground w-20">Section</dt>
                <dd className="font-medium">
                  {inspecting.section.branchCode}-{inspecting.section.name} · Year{" "}
                  {inspecting.section.year}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground w-20">Subject</dt>
                <dd className="font-medium">
                  {inspecting.subject
                    ? `${inspecting.subject.code} — ${inspecting.subject.name}`
                    : inspecting.entryType}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground w-20">Faculty</dt>
                <dd>{inspecting.faculty?.name ?? "—"}</dd>
              </div>
            </dl>

            {clear.error ? <ErrorState error={clear.error} /> : null}

            <p className="text-xs text-muted-foreground">
              Removing the allocation frees this room. The class itself stays on{" "}
              {inspecting.section.branchCode}-{inspecting.section.name}'s
              timetable.
            </p>

            <div className="flex justify-between gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPicking({
                    day: inspecting.dayOfWeek,
                    period: inspecting.startPeriod,
                  })
                  setInspecting(null)
                }}
              >
                Change
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setInspecting(null)}>
                  Close
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={clear.isPending}
                  onClick={() => clear.mutate(inspecting.id)}
                >
                  <Trash2 /> {clear.isPending ? "Removing…" : "Remove"}
                </Button>
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

/**
 * Pick which class takes this room-period.
 *
 * The choices are exactly the classes already timetabled at this day and
 * period — nothing is invented. A free period or a break has no class, so it
 * simply doesn't appear.
 */
function AllocateDialog({
  roomId,
  day,
  period,
  onClose,
  onDone,
}: {
  roomId: string
  day: Day
  period: number
  onClose: () => void
  onDone: () => void
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["allocatable", roomId, day, period],
    queryFn: () =>
      api.get<AllocatableResponse>(
        `/rooms/${roomId}/allocatable?dayOfWeek=${day}&startPeriod=${period}`
      ),
  })

  const allocate = useMutation({
    mutationFn: (entryId: string) =>
      api.patch(`/entries/${entryId}/room`, { roomId }),
    onSuccess: () => {
      onDone()
      onClose()
    },
  })

  return (
    <Dialog
      open
      onClose={onClose}
      title="Select class"
      description={`${day} · period ${period} in ${data?.room.name ?? "this room"}`}
    >
      <div className="space-y-3">
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} />
        ) : !data?.options.length ? (
          <p className="text-sm text-muted-foreground">
            No class is timetabled in this period, so there's nothing to put in
            this room. Place the class on its section timetable first.
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
            {data.options.map((o) => {
              const blocked = !o.available && !o.alreadyHere
              return (
                <button
                  key={o.entryId}
                  type="button"
                  disabled={blocked || o.alreadyHere || allocate.isPending}
                  onClick={() => allocate.mutate(o.entryId)}
                  className={cn(
                    "w-full text-left rounded-md border px-3 py-2 text-sm transition-colors",
                    blocked || o.alreadyHere
                      ? "opacity-60 cursor-not-allowed"
                      : "hover:bg-muted"
                  )}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{o.label}</span>
                    {o.alreadyHere && <Badge variant="success">already here</Badge>}
                    {o.entryType === "LAB" && <Badge variant="warning">lab</Badge>}
                    {o.currentRoom && !o.alreadyHere && (
                      <span className="text-xs text-muted-foreground">
                        currently in {o.currentRoom.name}
                      </span>
                    )}
                  </div>
                  {blocked && (
                    <p className="text-xs text-destructive mt-1">
                      {o.reasons.map((r) => r.message).join(" ")}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {allocate.error ? <ErrorState error={allocate.error} /> : null}

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
