import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Info, UserCheck } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { displayTime } from "@/components/timetable/gridLayout"
import { FacultyDayTable, titleCase } from "@/components/timetable/FacultyDayTable"
import type {
  AdjustmentDaySlot,
  AdjustmentFacultyRow,
  AdjustmentResponse,
  Day,
  GridSlot,
  PublicMeta,
} from "@/lib/types"

/**
 * "I'm on leave Tuesday — who can I ask to take my classes?"
 *
 * Day → Faculty → their complete day → click the hour that needs covering →
 * candidates, escalating Same Section → Department → College. A
 * decision-support page and nothing else: every candidate's whole day is
 * shown exactly as it is (never just "free"/"busy"), so the office can
 * compare workload before deciding who to approach. There is no save button
 * because there is nothing to save — the substitution is arranged between
 * people, and if the timetable really changes it is changed by an
 * administrator on the working copy.
 */
export function ClassAdjustmentPage() {
  const [params, setParams] = useSearchParams()

  const meta = useQuery({
    queryKey: ["public-meta"],
    queryFn: () => api.get<PublicMeta>("/public/meta"),
  })

  const day = (params.get("day") ?? meta.data?.days[0]?.value ?? "MON") as Day
  const facultyId = params.get("faculty") ?? ""
  const periodParam = params.get("period")
  const period = periodParam ? Number(periodParam) : null

  const adjustment = useQuery({
    queryKey: ["adjustment", day],
    queryFn: () => api.get<AdjustmentResponse>(`/public/adjustment?dayOfWeek=${day}`),
    enabled: Boolean(day),
  })

  const update = (key: "day" | "faculty" | "period", value: string) => {
    const next = new URLSearchParams(params)
    next.set(key, value)
    // Changing the day or the faculty invalidates whatever hour was picked
    // against the previous selection.
    if (key === "day") {
      next.delete("faculty")
      next.delete("period")
    }
    if (key === "faculty") next.delete("period")
    setParams(next)
  }

  const myRow = React.useMemo(
    () => adjustment.data?.faculty.find((f) => f.faculty.id === facultyId) ?? null,
    [adjustment.data, facultyId]
  )

  const selectedSlot = React.useMemo(() => {
    if (!myRow || period === null) return null
    return myRow.day.find((s) => s.kind === "PERIOD" && s.period === period) ?? null
  }, [myRow, period])

  // Everything below is derived client-side from the one day-level payload —
  // picking a different faculty member or hour never triggers another
  // request.
  const tiers = React.useMemo(() => {
    if (!adjustment.data || !myRow || !selectedSlot?.busy || !selectedSlot.detail) {
      return null
    }
    const detail = selectedSlot.detail
    const others = adjustment.data.faculty.filter((f) => f.faculty.id !== facultyId)

    const sameSection = others.filter((f) => f.sectionIds.includes(detail.sectionId))
    const sameSectionIds = new Set(sameSection.map((f) => f.faculty.id))

    const department = others.filter(
      (f) => !sameSectionIds.has(f.faculty.id) && f.faculty.departmentId === detail.sectionDepartmentId
    )
    const departmentIds = new Set(department.map((f) => f.faculty.id))

    // Everyone else in the college, mutually exclusive of the two tiers
    // above — escalating always reveals new names.
    const college = others.filter(
      (f) => !sameSectionIds.has(f.faculty.id) && !departmentIds.has(f.faculty.id)
    )

    // Tie-break by NAME, not faculty number: the number is admin-only and the
    // public API no longer sends it, so ordering by it would be invisible to
    // whoever is reading this list.
    const byWorkload = (a: AdjustmentFacultyRow, b: AdjustmentFacultyRow) =>
      a.periodsTaughtToday - b.periodsTaughtToday ||
      a.faculty.name.localeCompare(b.faculty.name)

    return {
      detail,
      sameSection: [...sameSection].sort(byWorkload),
      department: [...department].sort(byWorkload),
      college: [...college].sort(byWorkload),
    }
  }, [adjustment.data, myRow, selectedSlot, facultyId])

  const [showDepartment, setShowDepartment] = React.useState(false)
  const [showCollege, setShowCollege] = React.useState(false)

  // A fresh class to adjust shouldn't inherit an escalation left ticked from
  // a previous one.
  React.useEffect(() => {
    setShowDepartment(false)
    setShowCollege(false)
  }, [facultyId, period])

  if (meta.isLoading) return <LoadingState />
  if (meta.error) return <ErrorState error={meta.error} />
  if (!meta.data) return null

  const facultyOptions = adjustment.data?.faculty.map((f) => f.faculty) ?? []

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <UserCheck className="size-5" />
          Class Adjustment
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Going on leave? Find out who else could take your class. Nothing
          here changes the timetable.
        </p>
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base">Who&apos;s going on leave?</CardTitle>
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

          <div className="min-w-64 flex-1">
            <Label htmlFor="faculty">Faculty</Label>
            <Select
              id="faculty"
              value={facultyId}
              onChange={(e) => update("faculty", e.target.value)}
              disabled={adjustment.isLoading}
            >
              <option value="">
                {adjustment.isLoading ? "Loading…" : "Choose a faculty member"}
              </option>
              {facultyOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {adjustment.isLoading ? (
        <LoadingState label="Loading the day's timetable…" />
      ) : adjustment.error ? (
        <ErrorState error={adjustment.error} />
      ) : !adjustment.data ? null : !facultyId ? (
        <EmptyState title="Choose a faculty member to see their day." />
      ) : !myRow ? (
        <EmptyState title="That faculty member isn't active this term." />
      ) : (
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold mb-1">
              {myRow.faculty.label} — {adjustment.data.query.dayLabel}
            </h2>
            <p className="text-sm text-muted-foreground mb-3">
              Their complete day. Click the hour you need covered.
            </p>
            <div className="rounded-xl border bg-card p-4">
              <FacultyDayTable
                slots={adjustment.data.grid.slots}
                rows={[myRow]}
                targetPeriod={period}
                onSelectPeriod={(p) => update("period", String(p))}
              />
            </div>
          </div>

          {period !== null && (
            <ClassToAdjust
              slot={selectedSlot}
              dayLabel={adjustment.data.query.dayLabel}
              period={period}
              slots={adjustment.data.grid.slots}
            />
          )}

          {tiers && (
            <>
              <CandidateGroup
                title="Same Section Faculty"
                description={`Already teach ${tiers.detail.sectionLabel} — the preferred group to ask first.`}
                slots={adjustment.data.grid.slots}
                rows={tiers.sameSection}
                targetPeriod={period}
                emptyHint="No other faculty currently teach this section."
              />

              <Card className="print:hidden">
                <CardContent className="pt-5 space-y-3">
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-foreground"
                      checked={showDepartment}
                      onChange={(e) => setShowDepartment(e.target.checked)}
                    />
                    Show Department Faculty
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="accent-foreground"
                      checked={showCollege}
                      onChange={(e) => setShowCollege(e.target.checked)}
                    />
                    Show College Faculty
                  </label>
                </CardContent>
              </Card>

              {showDepartment && (
                <CandidateGroup
                  title="Department Faculty"
                  description="Every other active faculty member in this department."
                  slots={adjustment.data.grid.slots}
                  rows={tiers.department}
                  targetPeriod={period}
                  emptyHint="No further department faculty to show."
                />
              )}

              {showCollege && (
                <CandidateGroup
                  title="College Faculty"
                  description="Every remaining active faculty member in the college."
                  slots={adjustment.data.grid.slots}
                  rows={tiers.college}
                  targetPeriod={period}
                  emptyHint="No further faculty to show."
                />
              )}
            </>
          )}

          <p className="flex items-start gap-2 text-xs text-muted-foreground border-t pt-3">
            <Info className="size-3.5 mt-0.5 shrink-0" />
            <span>
              Read live from the published timetable — there is no separate
              list to keep up to date. View only — nothing on this page has
              been changed or saved.
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                              Class to Adjust                               */
/* -------------------------------------------------------------------------- */

function ClassToAdjust({
  slot,
  dayLabel,
  period,
  slots,
}: {
  slot: AdjustmentDaySlot | null
  dayLabel: string
  period: number
  slots: GridSlot[]
}) {
  const gridSlot = slots.find((s) => s.kind === "PERIOD" && s.period === period)
  const timeLabel = gridSlot ? `${displayTime(gridSlot.startTime)}–${displayTime(gridSlot.endTime)}` : ""

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Class to Adjust</CardTitle>
        <CardDescription>
          {dayLabel} · {ordinal(period)} hour{timeLabel ? ` (${timeLabel})` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!slot || !slot.busy || !slot.detail ? (
          <p className="text-sm text-muted-foreground">
            Nothing is scheduled in this period — there is nothing to adjust.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Section</dt>
            <dd className="font-medium">{slot.detail.sectionLabel}</dd>

            <dt className="text-muted-foreground">Subject</dt>
            <dd className="font-medium flex items-center gap-2">
              {slot.detail.subjectCode
                ? `${slot.detail.subjectCode} — ${slot.detail.subjectName ?? ""}`
                : titleCase(slot.detail.entryType)}
              {slot.detail.entryType === "LAB" && <Badge variant="secondary">LAB</Badge>}
            </dd>

            <dt className="text-muted-foreground">Period</dt>
            <dd>
              {ordinal(period)} hour{timeLabel ? ` (${timeLabel})` : ""}
            </dd>

            <dt className="text-muted-foreground">Room</dt>
            <dd className={cn(!slot.detail.room && "text-muted-foreground italic")}>
              {slot.detail.room ?? "Room: Not Assigned"}
            </dd>
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/*                              Candidate groups                              */
/* -------------------------------------------------------------------------- */

function CandidateGroup({
  title,
  description,
  slots,
  rows,
  targetPeriod,
  emptyHint,
}: {
  title: string
  description: string
  slots: GridSlot[]
  rows: AdjustmentFacultyRow[]
  targetPeriod: number | null
  emptyHint: string
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={emptyHint} />
      ) : (
        <div className="rounded-xl border bg-card p-4">
          <FacultyDayTable slots={slots} rows={rows} targetPeriod={targetPeriod} />
        </div>
      )}
    </div>
  )
}

/* --------------------------------- helpers -------------------------------- */

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
