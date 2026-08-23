import { cn } from "@/lib/utils"
import { displayTime } from "@/components/timetable/gridLayout"
import type { AdjustmentDaySlot, AdjustmentFacultyRow, GridSlot } from "@/lib/types"

/**
 * One matrix: faculty rows x period columns, FREE or the real class in each
 * cell. Originally built for the Class Adjustment page (a faculty member's
 * own day, clickable, plus read-only candidate tiers) and reused as-is by
 * the public Faculty Timetable page's "Who's Free" board — same shape of
 * data (`AdjustmentFacultyRow[]` from `GET /public/adjustment`), same look,
 * so the two pages can't drift apart on how a free/busy day is drawn.
 *
 * `onSelectPeriod` is optional: pass it to make period columns clickable
 * (Class Adjustment does, to pick the hour needing a substitute); omit it
 * for a plain read-only board (Who's Free does).
 */
export function FacultyDayTable({
  slots,
  rows,
  targetPeriod,
  onSelectPeriod,
}: {
  slots: GridSlot[]
  rows: AdjustmentFacultyRow[]
  targetPeriod: number | null
  onSelectPeriod?: (period: number) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-center text-sm w-full min-w-[720px] table-fixed">
        <colgroup>
          <col className="w-44" />
          {slots.map((s, i) => (
            <col key={i} className={s.kind === "PERIOD" ? "" : "w-20"} />
          ))}
        </colgroup>

        <thead>
          <tr>
            <th className="border px-2 py-2 text-xs font-medium text-muted-foreground bg-muted/40">
              Faculty
            </th>
            {slots.map((s, i) => (
              <th
                key={i}
                className={cn(
                  "border px-1 py-2 text-xs font-medium",
                  s.kind !== "PERIOD" && "bg-muted text-muted-foreground",
                  s.kind === "PERIOD" && s.period === targetPeriod && "bg-warning/15"
                )}
              >
                {s.kind === "PERIOD" ? `${displayTime(s.startTime)}-${displayTime(s.endTime)}` : s.kind}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.faculty.id}>
              <th className="border px-2 py-2 text-xs font-semibold bg-muted/20 text-left align-top">
                {row.faculty.label}
              </th>
              {row.day.map((slot, i) => (
                <FacultyDayCell
                  key={i}
                  slot={slot}
                  isTarget={slot.kind === "PERIOD" && slot.period === targetPeriod}
                  onSelectPeriod={onSelectPeriod}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FacultyDayCell({
  slot,
  isTarget,
  onSelectPeriod,
}: {
  slot: AdjustmentDaySlot
  isTarget: boolean
  onSelectPeriod?: (period: number) => void
}) {
  if (slot.kind !== "PERIOD") {
    return (
      <td className="border bg-muted px-1 py-2 text-center text-[11px] font-semibold tracking-wide text-muted-foreground">
        {slot.kind}
      </td>
    )
  }

  const content = !slot.busy || !slot.detail ? (
    <span className="text-xs text-muted-foreground">FREE</span>
  ) : (
    <>
      <div className="text-xs font-semibold leading-tight">{slot.detail.sectionLabel}</div>
      <div className="text-[11px] leading-tight mt-0.5">
        {slot.detail.subjectCode ?? titleCase(slot.detail.entryType)}
        {slot.detail.entryType === "LAB" && <span className="font-normal ml-1">LAB</span>}
      </div>
      <div
        className={cn(
          "text-[11px] leading-tight",
          !slot.detail.room && "text-muted-foreground italic"
        )}
      >
        {slot.detail.room ?? "Not Assigned"}
      </div>
    </>
  )

  const cellClass = cn(
    "border px-1.5 py-1.5 text-center align-top",
    slot.busy && slot.detail?.entryType === "LAB" && "bg-warning/5",
    !slot.busy && "bg-success/5",
    isTarget && "bg-warning/15 ring-1 ring-inset ring-warning/40"
  )

  if (onSelectPeriod && slot.period !== null) {
    return (
      <td className={cellClass}>
        <button
          type="button"
          onClick={() => onSelectPeriod(slot.period!)}
          className="w-full min-h-11 flex flex-col items-center justify-center gap-0 hover:bg-muted/50 rounded-sm transition-colors px-0.5 py-0.5"
        >
          {content}
        </button>
      </td>
    )
  }

  return (
    <td className={cellClass}>
      <div className="min-h-11 flex flex-col items-center justify-center">{content}</div>
    </td>
  )
}

export function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase()
}
