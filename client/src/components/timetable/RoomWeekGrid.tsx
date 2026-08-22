import { cn } from "@/lib/utils"
import { TimetableTable } from "./TimetableTable"
import type { Day, GridSlot, RoomTimetableEntry, SectionHomeRoomTimetable } from "@/lib/types"

/**
 * A room's own week, printed the same way the section grid above it is —
 * days down the side, periods across. Each cell shows YEAR_BRANCH_SECTION_
 * SUBJECT rather than a subject code, because this table is answering "who
 * else is using this room", not "what does this section study".
 *
 * Read-only by construction (no click handlers) — this is the view students,
 * faculty and print output share; allocating a room happens on the admin
 * Room Timetable page.
 */
export function RoomWeekGrid({
  roomTimetable,
  slots,
  workingDays,
}: {
  roomTimetable: SectionHomeRoomTimetable
  slots: GridSlot[]
  workingDays: Day[]
}) {
  const { room, entries } = roomTimetable

  return (
    <div className="mt-6">
      <p className="text-sm font-semibold mb-1">Room Timetable — {room.name}</p>

      <TimetableTable<RoomTimetableEntry>
        slots={slots}
        workingDays={workingDays}
        entries={entries}
        renderEntry={(entry, isFirstRun) => (
          <div
            className={cn(
              "w-full h-11 flex items-center justify-center px-1 text-[11px] leading-tight font-medium break-words",
              entry.entryType === "LAB" && "bg-warning/15"
            )}
          >
            {isFirstRun ? entry.label : ""}
          </div>
        )}
      />

      <p className="text-xs text-muted-foreground mt-2 print:hidden">
        Every class using {room.name} across all sections this week.
      </p>
    </div>
  )
}
