import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Check, Eraser, Printer, TriangleAlert, Upload, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ErrorState, LoadingState } from "@/components/ui/feedback"
import { TimetableTable } from "@/components/timetable/TimetableTable"
import { api, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import type {
  AvailabilityResponse,
  Day,
  EntryType,
  Room,
  SectionTimetable,
  TimetableEntry,
} from "@/lib/types"

/** What the user is currently placing. */
interface Tool {
  entryType: EntryType
  subjectId?: string
  label: string
  code: string
}

const ACTIVITY_TOOLS: Tool[] = [
  { entryType: "SPORTS", label: "Sports", code: "SPO" },
  { entryType: "LIBRARY", label: "Library", code: "LIB" },
  { entryType: "SEMINAR", label: "Seminar", code: "SEM" },
  { entryType: "COUNSELING", label: "Counseling", code: "COUN" },
]

export function SectionBuilderPage() {
  const { sectionId = "" } = useParams()
  const qc = useQueryClient()
  const [tool, setTool] = React.useState<Tool | null>(null)
  const [labRoomId, setLabRoomId] = React.useState<string>("")
  const [placeError, setPlaceError] = React.useState<unknown>(null)
  // How many consecutive periods the next lab should cover. Labs are no
  // longer a fixed 3 — the admin decides per placement.
  const [labSpan, setLabSpan] = React.useState(3)

  const timetable = useQuery({
    queryKey: ["timetable", sectionId],
    queryFn: () => api.get<SectionTimetable>(`/sections/${sectionId}/timetable`),
  })

  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: () => api.get<Room[]>("/rooms"),
  })

  const labRooms = React.useMemo(
    () => (rooms.data ?? []).filter((r) => r.type === "LAB"),
    [rooms.data]
  )

  React.useEffect(() => {
    if (!labRoomId && labRooms.length) setLabRoomId(labRooms[0].id)
  }, [labRooms, labRoomId])

  // Ask the server where the current tool may legally go. This is what makes
  // the grid clash-blocked: invalid cells are dead before anyone clicks.
  const availability = useQuery({
    queryKey: [
      "availability",
      sectionId,
      tool?.entryType,
      tool?.subjectId,
      labRoomId,
      tool?.entryType === "LAB" ? labSpan : 1,
    ],
    enabled: Boolean(tool),
    queryFn: () => {
      const params = new URLSearchParams({ entryType: tool!.entryType })
      if (tool!.subjectId) params.set("subjectId", tool!.subjectId)
      if (tool!.entryType === "LAB") {
        params.set("periodSpan", String(labSpan))
        if (labRoomId) params.set("roomId", labRoomId)
      }
      return api.get<AvailabilityResponse>(
        `/sections/${sectionId}/availability?${params}`
      )
    },
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["timetable", sectionId] })
    qc.invalidateQueries({ queryKey: ["availability", sectionId] })
    qc.invalidateQueries({ queryKey: ["curriculum-status"] })
  }

  const place = useMutation({
    mutationFn: (body: {
      dayOfWeek: Day
      startPeriod: number
      entryType: EntryType
      subjectId?: string
      roomId?: string
      periodSpan?: number
    }) => api.post(`/sections/${sectionId}/entries`, body),
    onSuccess: () => {
      setPlaceError(null)
      refresh()
    },
    onError: (e) => setPlaceError(e),
  })

  const removeEntry = useMutation({
    mutationFn: (id: string) => api.del(`/entries/${id}`),
    onSuccess: refresh,
  })

  const clearAll = useMutation({
    mutationFn: () => api.del(`/sections/${sectionId}/entries`),
    onSuccess: refresh,
  })

  if (timetable.isLoading) return <LoadingState />
  if (timetable.error) return <ErrorState error={timetable.error} />
  if (!timetable.data) return null

  const { section, grid, entries, legend, validation } = timetable.data
  const label = `${section.branch?.code}-${section.name}`

  // Fast lookup of whether a given cell is placeable with the current tool.
  const availabilityMap = new Map<string, { available: boolean; reason?: string }>()
  for (const slot of availability.data?.slots ?? []) {
    availabilityMap.set(`${slot.dayOfWeek}:${slot.startPeriod}`, {
      available: slot.available,
      reason: slot.reasons[0]?.message,
    })
  }

  const subjectTools: Tool[] = validation.subjects.flatMap((s) => {
    const out: Tool[] = []
    if (s.requiredTheory > 0) {
      out.push({
        entryType: "THEORY",
        subjectId: s.subjectId,
        label: s.subjectCode,
        code: s.subjectCode,
      })
    }
    if (s.requiredLab > 0) {
      out.push({
        entryType: "LAB",
        subjectId: s.subjectId,
        label: `${s.subjectCode} (lab)`,
        code: s.subjectCode,
      })
    }
    return out
  })

  const handleCellClick = (day: Day, period: number) => {
    if (!tool) return
    const cell = availabilityMap.get(`${day}:${period}`)
    if (!cell?.available) return
    place.mutate({
      dayOfWeek: day,
      startPeriod: period,
      entryType: tool.entryType,
      subjectId: tool.subjectId,
      roomId: tool.entryType === "LAB" ? labRoomId : undefined,
      periodSpan: tool.entryType === "LAB" ? labSpan : 1,
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to="/admin/curriculum">
              <ArrowLeft /> All sections
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">
            {label}{" "}
            <span className="text-muted-foreground font-normal">
              · Year {section.year} · {section.branch?.department?.code}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {timetable.data.term.label} · Room {section.homeRoom?.name ?? "not set"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/admin/sections/${sectionId}/import`}>
              <Upload /> Import
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/admin/sections/${sectionId}/timetable`}>
              <Printer /> View &amp; print
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={entries.length === 0 || clearAll.isPending}
            onClick={() => {
              if (window.confirm(`Clear the entire timetable for ${label}?`)) {
                clearAll.mutate()
              }
            }}
          >
            <Eraser /> Clear
          </Button>
        </div>
      </div>

      <ProgressPanel validation={validation} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {tool ? `Placing: ${tool.label}` : "Pick what to place"}
          </CardTitle>
          <CardDescription>
            {tool
              ? "Green cells are free. Greyed cells would clash — hover to see why."
              : "Choose a subject or activity, then click a free slot in the grid."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {subjectTools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subjects in this section's curriculum yet.{" "}
              <Link to={`/admin/curriculum/${sectionId}`} className="underline">
                Set it up first.
              </Link>
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {subjectTools.map((t) => {
                const progress = validation.subjects.find((s) => s.subjectId === t.subjectId)
                const done =
                  t.entryType === "LAB"
                    ? progress && progress.placedLab >= progress.requiredLab
                    : progress && progress.placedTheory >= progress.requiredTheory
                return (
                  <ToolButton
                    key={`${t.entryType}-${t.subjectId}`}
                    active={tool?.subjectId === t.subjectId && tool?.entryType === t.entryType}
                    done={Boolean(done)}
                    onClick={() => setTool(isSameTool(tool, t) ? null : t)}
                  >
                    {t.label}
                    <span className="ml-1.5 opacity-70 text-xs">
                      {t.entryType === "LAB"
                        ? `${progress?.placedLab ?? 0}/${progress?.requiredLab ?? 0}`
                        : `${progress?.placedTheory ?? 0}/${progress?.requiredTheory ?? 0}`}
                    </span>
                  </ToolButton>
                )
              })}

              <span className="w-px bg-border mx-1" />

              {ACTIVITY_TOOLS.map((t) => {
                const progress = validation.activities.find((a) => a.entryType === t.entryType)
                return (
                  <ToolButton
                    key={t.entryType}
                    active={tool?.entryType === t.entryType}
                    done={Boolean(progress?.complete)}
                    onClick={() => setTool(isSameTool(tool, t) ? null : t)}
                  >
                    {t.label}
                    <span className="ml-1.5 opacity-70 text-xs">
                      {progress?.placed ?? 0}/{progress?.required ?? 1}
                    </span>
                  </ToolButton>
                )
              })}
            </div>
          )}

          {tool?.entryType === "LAB" && (
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-muted-foreground">Periods:</span>
              <select
                value={labSpan}
                onChange={(e) => setLabSpan(Number(e.target.value))}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {Array.from(
                  { length: timetable.data?.grid.numPeriods ?? 7 },
                  (_, i) => i + 1
                ).map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "period" : "periods"}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">Laboratory:</span>
              {labRooms.length === 0 ? (
                <span className="text-warning">
                  No lab rooms defined — add one in Master Data.
                </span>
              ) : (
                <select
                  value={labRoomId}
                  onChange={(e) => setLabRoomId(e.target.value)}
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                >
                  {labRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="text-xs text-muted-foreground">
                Runs 3 continuous periods · may span lunch, never the break
              </span>
            </div>
          )}

          {placeError ? <PlacementError error={placeError} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <TimetableTable<TimetableEntry>
            slots={grid.slots}
            workingDays={grid.workingDays}
            entries={entries}
            renderEntry={(entry, isFirstRun) => (
              <EntryCell
                entry={entry}
                isFirstRun={isFirstRun}
                onRemove={() => removeEntry.mutate(entry.id)}
              />
            )}
            renderEmpty={(day, period) => {
              if (!tool) return null
              const cell = availabilityMap.get(`${day}:${period}`)
              if (!cell) return null
              return (
                <button
                  type="button"
                  disabled={!cell.available || place.isPending}
                  title={cell.available ? `Place ${tool.label}` : cell.reason}
                  onClick={() => handleCellClick(day, period)}
                  className={cn(
                    "w-full h-11 text-xs transition-colors",
                    cell.available
                      ? "bg-success/10 hover:bg-success/25 text-success cursor-pointer"
                      : "bg-muted/60 text-muted-foreground/50 cursor-not-allowed"
                  )}
                >
                  {cell.available ? "+" : "×"}
                </button>
              )
            }}
          />

          {legend.length > 0 && (
            <div className="mt-4 pt-3 border-t grid gap-x-8 gap-y-1 sm:grid-cols-2 text-sm">
              {legend.map((l) => (
                <div key={l.subjectId} className="flex gap-2">
                  <span className="font-semibold min-w-14">{l.code}:</span>
                  <span className={l.facultyName ? "" : "text-warning"}>
                    {l.facultyName ? facultyLabel(l) : "no faculty assigned"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function isSameTool(a: Tool | null, b: Tool): boolean {
  return a?.entryType === b.entryType && a?.subjectId === b.subjectId
}

function ToolButton({
  active,
  done,
  onClick,
  children,
}: {
  active: boolean
  done: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-1 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : done
            ? "border-success/40 bg-success/10 text-success hover:bg-success/20"
            : "hover:bg-muted"
      )}
    >
      {done && !active && <Check className="size-3 mr-1" />}
      {children}
    </button>
  )
}

function EntryCell({
  entry,
  isFirstRun,
  onRemove,
}: {
  entry: TimetableEntry
  isFirstRun: boolean
  onRemove: () => void
}) {
  const isLab = entry.entryType === "LAB"
  const isActivity = !entry.subject

  const text = entry.subject
    ? entry.subject.code
    : entry.entryType === "COUNSELING"
      ? "COUN"
      : entry.entryType.slice(0, 3)

  return (
    <div
      className={cn(
        "group relative w-full h-11 flex items-center justify-center px-1 text-xs font-semibold",
        isLab
          ? "bg-warning/20 text-warning-foreground"
          : isActivity
            ? "bg-muted text-muted-foreground"
            : "bg-primary/10"
      )}
      title={
        entry.subject
          ? `${entry.subject.name}${entry.faculty ? ` — ${entry.faculty.facultyNo} ${entry.faculty.name}` : ""}${entry.room ? ` · ${entry.room.name}` : ""}`
          : entry.entryType
      }
    >
      <span className="truncate">
        {text}
        {isLab && isFirstRun && <span className="font-normal"> LAB</span>}
      </span>
      {isLab && entry.room && isFirstRun && (
        <span className="absolute bottom-0 left-1 text-[9px] font-normal opacity-70">
          {entry.room.name}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-destructive"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

function PlacementError({ error }: { error: unknown }) {
  const details =
    error instanceof ApiError && Array.isArray((error as ApiError & { details?: unknown }).details)
      ? ((error as unknown as { details: { message: string }[] }).details ?? [])
      : []
  const message = error instanceof Error ? error.message : "Placement failed"

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <div className="font-medium">{message}</div>
      {details.length > 0 && (
        <ul className="mt-1 ml-4 list-disc">
          {details.map((d, i) => (
            <li key={i}>{d.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ProgressPanel({ validation }: { validation: SectionTimetable["validation"] }) {
  const { subjects, activities, errors, warnings, valid } = validation

  return (
    <Card className={valid ? "border-success/40" : undefined}>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {valid ? (
            <Badge variant="success">
              <Check className="size-3 mr-1" /> Complete
            </Badge>
          ) : (
            <Badge variant="warning">
              {errors.length} thing{errors.length === 1 ? "" : "s"} left
            </Badge>
          )}

          {subjects.map((s) => (
            <Badge key={s.subjectId} variant={s.complete ? "success" : "outline"}>
              {s.subjectCode} {s.placedTheory + s.placedLab}/
              {s.requiredTheory + s.requiredLab}
            </Badge>
          ))}
          {activities.map((a) => (
            <Badge key={a.entryType} variant={a.complete ? "success" : "outline"}>
              {a.entryType.charAt(0) + a.entryType.slice(1).toLowerCase()} {a.placed}/
              {a.required}
            </Badge>
          ))}
        </div>

        {errors.length > 0 && (
          <ul className="text-sm text-muted-foreground space-y-0.5 list-disc ml-5">
            {errors.slice(0, 6).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {errors.length > 6 && <li>…and {errors.length - 6} more</li>}
          </ul>
        )}

        {warnings.map((w, i) => (
          <div key={i} className="flex items-start gap-2 text-sm text-warning">
            <TriangleAlert className="size-4 mt-0.5 shrink-0" />
            {w}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** "FAC003 — Ms. Y. Sireesha", or just the name on older data. */
function facultyLabel(l: { facultyName: string | null; facultyNo?: string | null }): string {
  if (!l.facultyName) return "\u2014"
  return l.facultyNo ? `${l.facultyNo} \u2014 ${l.facultyName}` : l.facultyName
}
