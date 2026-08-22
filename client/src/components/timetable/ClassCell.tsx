import { cn } from "@/lib/utils"
import type { EntryType } from "@/lib/types"
import { activityLabel, shortFacultyName } from "./entryStyles"

/**
 * One filled cell of a timetable — the same one everywhere.
 *
 * Before this existed, each page rendered its own `<div>` with its own
 * classes, which is why the public sheet, the admin sheet and the printed
 * sheet all showed slightly different things. Now every grid passes what it
 * knows and the cell decides how it looks.
 *
 * The cell carries the whole answer: what the class is, who takes it, and
 * where. That's what replaced the second "room timetable" grid that used to
 * sit under every section sheet — the room was already knowable per period,
 * it just wasn't being printed in the same place.
 *
 * Callers pass the pieces they have rather than an entry object, because the
 * four grids that use this (section, public, faculty, print) all have
 * differently-shaped entries pointing at the same three facts.
 */
export function ClassCell({
  entryType,
  isFirstRun,
  primary,
  faculty,
  room,
  secondary,
  abbreviateFaculty = true,
  title,
  className,
}: {
  entryType: EntryType
  /** False for the tail of a block split across a break or lunch column. */
  isFirstRun: boolean
  /** Subject code, or the activity name when there's no subject. */
  primary?: string | null
  /** Full name — abbreviated here unless `abbreviateFaculty` is false. */
  faculty?: string | null
  room?: string | null
  /** An extra line above faculty — the section, on a faculty timetable. */
  secondary?: string | null
  abbreviateFaculty?: boolean
  title?: string
  className?: string
}) {
  const label = primary ?? activityLabel(entryType)
  const who = abbreviateFaculty ? shortFacultyName(faculty) : (faculty ?? null)

  return (
    <div
      className={cn(
        "w-full h-full min-h-[3.5rem] flex flex-col items-center justify-center",
        "px-1 py-0.5 leading-tight text-center overflow-hidden",
        className
      )}
      title={title}
    >
      {/* The continuation half of a split block repeats the fill and the
          edge colour, but not the text — otherwise a three-period lab reads
          as two separate classes. */}
      {isFirstRun && (
        <>
          <span className="text-[11px] font-bold tracking-tight break-words w-full">
            {label}
            {entryType === "LAB" && (
              <span className="font-medium opacity-70"> LAB</span>
            )}
          </span>

          {secondary && (
            <span className="text-[9px] font-medium opacity-80 break-words w-full">
              {secondary}
            </span>
          )}

          {who && (
            <span className="text-[9px] opacity-90 break-words w-full">{who}</span>
          )}

          {room && (
            <span className="text-[9px] font-medium opacity-70 break-words w-full">
              {room}
            </span>
          )}
        </>
      )}
    </div>
  )
}
