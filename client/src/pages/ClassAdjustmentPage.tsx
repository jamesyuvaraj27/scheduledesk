import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Eye, Info, Search, UserCheck } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { AdjustmentResponse, Day, PublicMeta } from "@/lib/types"

/**
 * "I'm on leave on Tuesday, 3rd hour, for IV CSM-A — who's free?"
 *
 * A decision-support page and nothing else: it shows the class that needs
 * covering and every faculty member who has no class that hour, each with
 * their whole day so the HoD can see whether asking them is reasonable.
 *
 * It writes nothing. There is no save button because there is nothing to
 * save — the substitution is arranged between people, and if the timetable
 * really changes it is changed by an administrator on the working copy.
 */
/** Stable reference, so the memos below don't invalidate every render. */
const NO_YEARS: PublicMeta["years"] = []

export function ClassAdjustmentPage() {
  const [params, setParams] = useSearchParams()

  const meta = useQuery({
    queryKey: ["public-meta"],
    queryFn: () => api.get<PublicMeta>("/public/meta"),
  })

  const years = meta.data?.years ?? NO_YEARS
  const yearParam = params.get("year")
  const year = yearParam ? Number(yearParam) : (years[0]?.year ?? null)
  // Memoised: the default-selection effect below depends on it, and a fresh
  // array every render would re-run the effect on every render.
  const sectionsInYear = React.useMemo(
    () => years.find((y) => y.year === year)?.sections ?? [],
    [years, year]
  )
  const sectionId = params.get("section") ?? ""
  const day = (params.get("day") ?? meta.data?.days[0]?.value ?? "MON") as Day
  const period = Number(params.get("period") ?? 1)

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

  const result = useQuery({
    queryKey: ["adjustment", sectionId, day, period],
    queryFn: () =>
      api.get<AdjustmentResponse>(
        `/public/adjustment?sectionId=${sectionId}&dayOfWeek=${day}&startPeriod=${period}`
      ),
    enabled: Boolean(sectionId),
  })

  if (meta.isLoading) return <LoadingState />
  if (meta.error) return <ErrorState error={meta.error} />
  if (!meta.data) return null

  const periods = Array.from({ length: meta.data.grid.numPeriods }, (_, i) => i + 1)
  const slotFor = (p: number) =>
    meta.data.grid.slots.find((s) => s.kind === "PERIOD" && s.period === p)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <UserCheck className="size-5" />
          Class Adjustment
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Going on leave? Find out who is free that hour. Nothing here changes
          the timetable.
        </p>
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="size-4" /> Which class needs covering?
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <div className="w-40">
            <Label htmlFor="day">Day</Label>
            <Select id="day" value={day} onChange={(e) => update("day", e.target.value)}>
              {meta.data.days.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-28">
            <Label htmlFor="year">Year</Label>
            <Select
              id="year"
              value={year ?? ""}
              onChange={(e) => update("year", e.target.value)}
            >
              {years.map((y) => (
                <option key={y.year} value={y.year}>
                  {y.roman}
                </option>
              ))}
            </Select>
          </div>

          <div className="min-w-44 flex-1">
            <Label htmlFor="section">Section</Label>
            <Select
              id="section"
              value={sectionId}
              onChange={(e) => update("section", e.target.value)}
            >
              {sectionsInYear.length === 0 && <option value="">No sections</option>}
              {sectionsInYear.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-44">
            <Label htmlFor="period">Period</Label>
            <Select
              id="period"
              value={period}
              onChange={(e) => update("period", e.target.value)}
            >
              {periods.map((p) => {
                const slot = slotFor(p)
                return (
                  <option key={p} value={p}>
                    {ordinal(p)} hour
                    {slot ? ` · ${slot.startTime}–${slot.endTime}` : ""}
                  </option>
                )
              })}
            </Select>
          </div>
        </CardContent>
      </Card>

      {!sectionId ? (
        <EmptyState title="Choose a section to begin." />
      ) : result.isLoading ? (
        <LoadingState label="Checking who's free…" />
      ) : result.error ? (
        <ErrorState error={result.error} />
      ) : !result.data ? null : (
        <Results data={result.data} />
      )}
    </div>
  )
}

function Results({ data }: { data: AdjustmentResponse }) {
  const cls = data.selectedClass

  return (
    <div className="space-y-5">
      {/* ---- the class that needs covering ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">The class</CardTitle>
          <CardDescription>
            {data.query.dayLabel} · {ordinal(data.query.startPeriod)} hour
            {data.query.startTime
              ? ` (${data.query.startTime}–${data.query.endTime})`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!cls ? (
            <p className="text-sm text-muted-foreground">
              {data.section.label} has no class scheduled in that period — there
              is nothing to cover.
            </p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Section</dt>
              <dd className="font-medium">{data.section.label}</dd>

              <dt className="text-muted-foreground">Subject</dt>
              <dd className="font-medium flex items-center gap-2">
                {cls.subject ? `${cls.subject.code} — ${cls.subject.name}` : titleCase(cls.entryType)}
                {cls.entryType === "LAB" && <Badge variant="secondary">LAB</Badge>}
              </dd>

              <dt className="text-muted-foreground">Regular faculty</dt>
              <dd className="font-medium">{cls.regularFaculty?.label ?? "Not assigned"}</dd>

              <dt className="text-muted-foreground">Room</dt>
              <dd>{cls.room ?? "—"}</dd>

              <dt className="text-muted-foreground">Period</dt>
              <dd>
                {ordinal(data.query.startPeriod)} hour
                {cls.periodSpan > 1 && ` (part of a ${cls.periodSpan}-period block)`}
              </dd>
            </dl>
          )}
        </CardContent>
      </Card>

      {/* ---- who's free ---- */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-base font-semibold">
            Free during the {ordinal(data.query.startPeriod)} hour
          </h2>
          <p className="text-sm text-muted-foreground">
            {data.availableFaculty.length} of {data.totalActiveFaculty} faculty ·{" "}
            {data.busyCount} teaching
          </p>
        </div>

        {data.availableFaculty.length === 0 ? (
          <EmptyState
            title="Nobody is free that hour."
            hint="Every active faculty member has a class covering that period."
          />
        ) : (
          <div className="space-y-4">
            {data.availableFaculty.map((c) => (
              <Card key={c.faculty.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-sm">
                      {c.faculty.label} — {data.query.dayLabel}
                    </CardTitle>
                    {c.teachesThisSubject && (
                      <Badge variant="success">Teaches this subject</Badge>
                    )}
                    {c.sameDepartment && !c.teachesThisSubject && (
                      <Badge variant="secondary">Same department</Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {c.periodsTaughtToday} class
                      {c.periodsTaughtToday === 1 ? "" : "es"} today
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="px-3 py-1.5 font-medium w-36">Time</th>
                          <th className="px-3 py-1.5 font-medium">Schedule</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {c.day.map((slot, i) => (
                          <tr
                            key={i}
                            className={cn(
                              slot.kind !== "PERIOD" && "bg-muted/30 text-muted-foreground",
                              // The hour being covered, called out so the eye
                              // lands on it first.
                              // The hour being covered, in a colour nothing
                              // else on the page uses.
                              slot.isTarget && "bg-warning/15 ring-1 ring-inset ring-warning/40"
                            )}
                          >
                            <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                              {slot.startTime}–{slot.endTime}
                            </td>
                            <td
                              className={cn(
                                "px-3 py-1.5",
                                slot.kind === "PERIOD" && !slot.busy && "text-success font-medium",
                                slot.isTarget && "font-semibold text-foreground"
                              )}
                            >
                              {slot.label}
                              {slot.isTarget && (
                                <span className="ml-2 text-xs font-medium text-warning">
                                  ← the hour you need
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground border-t pt-3">
        <Info className="size-3.5 mt-0.5 shrink-0" />
        <span>
          Availability is read live from the published timetable — there is no
          separate list to keep up to date.{" "}
          <span className="inline-flex items-center gap-1 font-medium">
            <Eye className="size-3" /> View only
          </span>{" "}
          — nothing on this page has been changed or saved.
        </span>
      </p>
    </div>
  )
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase()
}
