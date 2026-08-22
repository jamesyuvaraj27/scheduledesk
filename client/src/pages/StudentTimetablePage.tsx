import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { CalendarDays, Printer } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback"
import { TimetableTable } from "@/components/timetable/TimetableTable"
import { ClassCell } from "@/components/timetable/ClassCell"
import { activityLabel, SESSION_LABEL } from "@/components/timetable/entryStyles"
import { PrintFitPage } from "@/components/PrintFitPage"
import { api } from "@/lib/api"
import type {
  Day,
  PublicLegendRow,
  PublicMeta,
  PublicSectionTimetable,
  PublicTimetableEntry,
} from "@/lib/types"

/**
 * What students and faculty see. Read-only by construction: it calls only
 * /api/public, which has no write routes at all.
 *
 * The week is drawn with the same component as the office's printed section
 * sheet — days down the side, periods across, break and lunch merged, the
 * subject/faculty key underneath — so what a student reads and what is pinned
 * to the noticeboard are the same thing. Picking one day instead gives a
 * stacked list, which is what actually fits on a phone.
 *
 * The filters live in the URL, so a section's timetable can be bookmarked or
 * put behind a noticeboard QR code.
 *
 * Nothing here shows a faculty number or any other internal identifier — the
 * public API doesn't send them, so there is nothing to leak. Faculty appear
 * by name only.
 */

/** Stable reference, so the memo below doesn't invalidate every render. */
const NO_YEARS: PublicMeta["years"] = []

export function StudentTimetablePage() {
  const [params, setParams] = useSearchParams()

  const meta = useQuery({
    queryKey: ["public-meta"],
    queryFn: () => api.get<PublicMeta>("/public/meta"),
  })

  const yearParam = params.get("year")
  const sectionId = params.get("section") ?? ""
  const dayParam = (params.get("day") ?? "ALL") as Day | "ALL"

  const years = meta.data?.years ?? NO_YEARS
  const year = yearParam ? Number(yearParam) : (years[0]?.year ?? null)
  const sectionsInYear = React.useMemo(
    () => years.find((y) => y.year === year)?.sections ?? [],
    [years, year]
  )

  // Default to the first section of the first year once the lists arrive.
  React.useEffect(() => {
    if (!meta.data) return
    if (sectionId && sectionsInYear.some((s) => s.id === sectionId)) return
    const first = sectionsInYear[0]
    if (!first) return
    const next = new URLSearchParams(params)
    next.set("year", String(year))
    next.set("section", first.id)
    setParams(next, { replace: true })
  }, [meta.data, sectionId, sectionsInYear, year, params, setParams])

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    next.set(key, value)
    if (key === "year") next.delete("section")
    setParams(next)
  }

  const timetable = useQuery({
    queryKey: ["public-timetable", sectionId],
    queryFn: () =>
      api.get<PublicSectionTimetable>(`/public/sections/${sectionId}/timetable`),
    enabled: Boolean(sectionId),
  })

  if (meta.isLoading) return <LoadingState label="Loading the timetable…" />
  if (meta.error) return <ErrorState error={meta.error} />
  if (!meta.data) return null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <CalendarDays className="size-5" />
            Class Timetable
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {meta.data.term.label} · published timetable
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>

      <Card className="print:hidden">
        <CardContent className="pt-5 flex flex-wrap gap-3">
          <div className="w-32">
            <Label htmlFor="year">Year</Label>
            <Select
              id="year"
              value={year ?? ""}
              onChange={(e) => update("year", e.target.value)}
            >
              {years.map((y) => (
                <option key={y.year} value={y.year}>
                  {y.roman} Year
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-48 flex-1">
            <Label htmlFor="section">Section</Label>
            <Select
              id="section"
              value={sectionId}
              onChange={(e) => update("section", e.target.value)}
            >
              {sectionsInYear.length === 0 && <option value="">No sections</option>}
              {sectionsInYear.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} — {s.branchName}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-44">
            <Label htmlFor="day">Show</Label>
            <Select
              id="day"
              value={dayParam}
              onChange={(e) => update("day", e.target.value)}
            >
              <option value="ALL">Whole week (grid)</option>
              {meta.data.days.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label} only
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {!sectionId ? (
        <EmptyState title="Pick a section to see its timetable." />
      ) : timetable.isLoading ? (
        <LoadingState />
      ) : timetable.error ? (
        <ErrorState error={timetable.error} />
      ) : !timetable.data ? null : dayParam === "ALL" ? (
        <WeekGrid data={timetable.data} />
      ) : (
        <SingleDay
          data={timetable.data}
          day={dayParam}
          dayLabel={
            meta.data.days.find((d) => d.value === dayParam)?.label ?? dayParam
          }
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                          The week, as a printed sheet                      */
/* -------------------------------------------------------------------------- */

function WeekGrid({ data }: { data: PublicSectionTimetable }) {
  const { section, grid, entries, legend, term } = data

  return (
    <PrintFitPage className="rounded-xl border bg-card p-5 print:border-0 print:p-0">
      <header className="text-center mb-4">
        <h1 className="font-semibold text-xl">
          {section.branchCode} · Section {section.name}
          {section.homeRoom ? ` · Room ${section.homeRoom}` : ""}
        </h1>
        <p className="text-sm font-medium mt-1">{section.branchName}</p>
        <p className="text-sm text-muted-foreground mt-0.5">
          Year &amp; Sem : {toRoman(section.year)} — {term.label} ·{" "}
          {section.departmentCode}
        </p>
      </header>

      {entries.length === 0 ? (
        <EmptyState
          title="Nothing has been scheduled for this section yet."
          hint="It will appear here as soon as the office publishes it."
        />
      ) : (
        <>
          {/* One grid, and everything is in it. The room used to be a second
              grid underneath; it's now the third line of each cell, which is
              where someone reading a period actually wants it. */}
          <TimetableTable<PublicTimetableEntry>
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
                  entry.subject?.name ?? SESSION_LABEL[entry.entryType],
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
                <div key={l.code} className="flex gap-2">
                  <span className="font-semibold min-w-24">{l.code}:</span>
                  <span>{facultyLabel(l)}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-3 print:hidden">
            Cells show the subject, who takes it and the room. Scroll the grid
            sideways on a narrow screen, or pick a single day above for a list
            that fits.
          </p>
        </>
      )}
    </PrintFitPage>
  )
}

/* -------------------------------------------------------------------------- */
/*                    One day, stacked — this is the phone view               */
/* -------------------------------------------------------------------------- */

function SingleDay({
  data,
  day,
  dayLabel,
}: {
  data: PublicSectionTimetable
  day: Day
  dayLabel: string
}) {
  const { grid, entries, section } = data
  const mine = entries.filter((e) => e.dayOfWeek === day)
  const covering = (period: number) =>
    mine.find((e) => period >= e.startPeriod && period < e.startPeriod + e.periodSpan)

  return (
    <div className="rounded-xl border bg-card p-5 print:border-0 print:p-0">
      <header className="mb-3">
        <h2 className="font-semibold">
          {section.label} · {dayLabel}
        </h2>
        <p className="text-sm text-muted-foreground">
          {section.branchName}
          {section.homeRoom ? ` · Room ${section.homeRoom}` : ""}
        </p>
      </header>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium w-24">Time</th>
              <th className="px-3 py-2 font-medium">Class</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {grid.slots.map((slot, i) => {
              if (slot.kind !== "PERIOD" || slot.period === null) {
                return (
                  <tr key={i} className="bg-muted/40">
                    <td className="px-3 py-2 align-top text-xs tabular-nums">
                      {slot.startTime}
                      <span className="block">{slot.endTime}</span>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {slot.kind === "BREAK" ? "BREAK" : "LUNCH"}
                    </td>
                  </tr>
                )
              }

              const entry = covering(slot.period)
              const continued = entry && entry.startPeriod !== slot.period

              return (
                <tr key={i}>
                  <td className="px-3 py-2 align-top text-xs tabular-nums opacity-70">
                    {slot.startTime}
                    <span className="block">{slot.endTime}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {!entry ? (
                      <span className="text-muted-foreground">Free</span>
                    ) : (
                      <>
                        {/* Subject first, then who and where beneath it — one
                            column, so nothing is pushed off a narrow screen. */}
                        <div className="font-semibold">
                          {entry.subject?.code ?? activityLabel(entry.entryType)}
                          {entry.entryType === "LAB" && (
                            <span className="font-normal ml-1">LAB</span>
                          )}
                          {continued && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              (continued)
                            </span>
                          )}
                        </div>
                        {entry.subject && (
                          <div className="text-xs opacity-80">{entry.subject.name}</div>
                        )}
                        <div className="text-xs opacity-80 mt-0.5">
                          {entry.faculty?.name ?? "Faculty not assigned"}
                          {entry.room ? ` · ${entry.room.name}` : ""}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* --------------------------------- helpers -------------------------------- */

function toRoman(year: number): string {
  return ["I", "II", "III", "IV"][year - 1] ?? String(year)
}

/**
 * Faculty are named publicly, never numbered. The API doesn't send
 * `facultyNo` at all, so there is nothing here to accidentally print.
 */
function facultyLabel(l: PublicLegendRow): string {
  return l.facultyName ?? "—"
}
