import * as React from "react"
import { cn } from "@/lib/utils"
import type { Day, GridSlot } from "@/lib/types"
import { buildDayCells, displayTime, type DayCell } from "./gridLayout"

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
}: {
  slots: GridSlot[]
  workingDays: Day[]
  entries: T[]
  renderEntry: (entry: T, isFirstRun: boolean) => React.ReactNode
  renderEmpty?: (day: Day, period: number) => React.ReactNode
  className?: string
}) {
  const periodSlots = slots.filter((s) => s.kind === "PERIOD")

  return (
    <div className="overflow-x-auto">
      <table
        className={cn(
          "border-collapse text-center text-sm w-full min-w-[720px] table-fixed",
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
          {workingDays.map((day, rowIndex) => {
            const cells = buildDayCells(day, slots, entries)
            return (
              <tr key={day}>
                <th className="border px-1 py-1 text-xs font-semibold bg-muted/40">
                  {day}
                </th>
                {cells.map((cell, i) => (
                  <Cell
                    key={i}
                    cell={cell}
                    day={day}
                    isFirstRow={rowIndex === 0}
                    rowCount={workingDays.length}
                    renderEntry={renderEntry}
                    renderEmpty={renderEmpty}
                  />
                ))}
              </tr>
            )
          })}
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
        className="border bg-muted p-0 align-middle"
        aria-label={cell.label}
      >
        <div
          className="text-[10px] font-semibold tracking-widest text-muted-foreground mx-auto"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {cell.label}
        </div>
      </td>
    )
  }

  if (cell.kind === "empty") {
    return (
      <td className="border p-0 h-11">
        {renderEmpty?.(day, cell.period) ?? null}
      </td>
    )
  }

  return (
    <td colSpan={cell.colSpan} className="border p-0 h-11">
      {renderEntry(cell.entry, cell.isFirstRun)}
    </td>
  )
}
