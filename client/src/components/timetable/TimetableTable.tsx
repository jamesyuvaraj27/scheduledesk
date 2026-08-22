import * as React from "react"
import { cn } from "@/lib/utils"
import type { Day, GridSlot } from "@/lib/types"
import { buildDayCells, buildDayLanes, displayTime, type DayCell } from "./gridLayout"

interface HasPlacement {
  dayOfWeek: Day
  startPeriod: number
  periodSpan: number
}

/**
 * The printed-timetable layout: days down the left, periods across the top
 * with their start and end times on two header rows, and break/lunch as
 * single columns merged down the whole table.
 */
export function TimetableTable<T extends HasPlacement>({
  slots,
  workingDays,
  entries,
  renderEntry,
  renderEmpty,
  className,
  lanes = false,
}: {
  slots: GridSlot[]
  workingDays: Day[]
  entries: T[]
  renderEntry: (entry: T, isFirstRun: boolean) => React.ReactNode
  renderEmpty?: (day: Day, period: number) => React.ReactNode
  className?: string
  /**
   * Draw extra rows for a day where two classes genuinely occupy one hour —
   * a combined section or a shared room. Only the faculty and room grids
   * need this; a section is never in two places at once, so its grid stays
   * one row per day and renders exactly as it always has.
   */
  lanes?: boolean
}) {
  const periodSlots = slots.filter((s) => s.kind === "PERIOD")

  const days = workingDays.map((day) => ({
    day,
    rows: lanes
      ? buildDayLanes(day, slots, entries)
      : [buildDayCells(day, slots, entries)],
  }))

  // Break and lunch are one cell merged down the WHOLE table, so their
  // rowSpan counts every rendered row, not every day — those differ as soon
  // as any day needs a second lane.
  const totalRows = days.reduce((n, d) => n + d.rows.length, 0)
  let renderedRows = 0

  return (
    // Scrolls inside its own box on a narrow screen so the page itself never
    // scrolls sideways. `overscroll-x-contain` stops a swipe that reaches the
    // end of the grid from dragging the whole page with it on iOS.
    <div className="overflow-x-auto overscroll-x-contain -mx-1 px-1">
      <table
        className={cn(
          // Wider than it used to be: cells now carry subject, faculty and
          // room rather than a bare subject code.
          "border-collapse text-center text-sm w-full min-w-[860px] table-fixed",
          className
        )}
      >
        <colgroup>
          <col className="w-14" />
          {slots.map((s, i) => (
            <col key={i} className={s.kind === "PERIOD" ? "" : "w-9"} />
          ))}
        </colgroup>

        <thead>
          <tr>
            <th
              rowSpan={2}
              className="border p-1 text-xs font-medium text-muted-foreground align-middle"
            >
              Day
            </th>
            {slots.map((s, i) => (
              <th
                key={i}
                className={cn(
                  "border px-1 py-1 text-xs font-medium",
                  s.kind !== "PERIOD" && "bg-muted text-muted-foreground"
                )}
              >
                {displayTime(s.startTime)}
              </th>
            ))}
          </tr>
          <tr>
            {slots.map((s, i) => (
              <th
                key={i}
                className={cn(
                  "border px-1 pb-1 text-xs font-normal text-muted-foreground",
                  s.kind !== "PERIOD" && "bg-muted"
                )}
              >
                {displayTime(s.endTime)}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {days.map(({ day, rows }) =>
            rows.map((cells, laneIndex) => {
              const isFirstRow = renderedRows === 0
              renderedRows++
              return (
                <tr key={`${day}-${laneIndex}`}>
                  {/* The day is named once and spans its lanes, so a day
                      with a shared hour still reads as one day. */}
                  {laneIndex === 0 && (
                    <th
                      rowSpan={rows.length}
                      className="border px-1 py-1 text-xs font-semibold bg-muted/40 align-middle"
                    >
                      {day}
                    </th>
                  )}
                  {cells.map((cell, i) => (
                    <Cell
                      key={i}
                      cell={cell}
                      day={day}
                      isFirstRow={isFirstRow}
                      rowCount={totalRows}
                      renderEntry={renderEntry}
                      // Only the first lane speaks for whether an hour is
                      // free — the extra lanes hold just the second
                      // occupant, so their gaps are "nothing further here",
                      // not "this hour is available". Drawing the room
                      // page's allocate button in them would offer a slot
                      // that is already taken.
                      renderEmpty={laneIndex === 0 ? renderEmpty : undefined}
                    />
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>

      {periodSlots.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          This term has no periods configured.
        </p>
      )}
    </div>
  )
}

function Cell<T extends HasPlacement>({
  cell,
  day,
  isFirstRow,
  rowCount,
  renderEntry,
  renderEmpty,
}: {
  cell: DayCell<T>
  day: Day
  isFirstRow: boolean
  rowCount: number
  renderEntry: (entry: T, isFirstRun: boolean) => React.ReactNode
  renderEmpty?: (day: Day, period: number) => React.ReactNode
}) {
  if (cell.kind === "pause") {
    // Break and lunch are one tall merged cell, like the printed sheet.
    if (!isFirstRow) return null
    return (
      <td
        rowSpan={rowCount}
        className={cn("border p-0 align-middle bg-muted/40")}
        aria-label={cell.label}
      >
        <div
          className="text-[10px] font-semibold tracking-widest mx-auto"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {cell.label}
        </div>
      </td>
    )
  }

  if (cell.kind === "empty") {
    return (
      <td className="border p-0 h-14">
        {renderEmpty?.(day, cell.period) ?? null}
      </td>
    )
  }

  return (
    <td colSpan={cell.colSpan} className="border p-0 h-14">
      {renderEntry(cell.entry, cell.isFirstRun)}
    </td>
  )
}
