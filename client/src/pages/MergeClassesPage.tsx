import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, GitMerge, Split } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { ErrorState, LoadingState, EmptyState } from "@/components/ui/feedback"
import { displayTime } from "@/components/timetable/gridLayout"
import { api } from "@/lib/api"
import type {
  AcademicTerm,
  ActiveMergesResponse,
  Day,
  MergeOption,
  MergeOptionsResponse,
  MergeResult,
  Room,
} from "@/lib/types"

const ROMAN = ["", "I", "II", "III", "IV"]
const sectionLabel = (s: { year: number; branchCode: string; name: string }) =>
  `${ROMAN[s.year] ?? s.year} ${s.branchCode}-${s.name}`

/**
 * Merge Classes — combine two already-placed classes into one occurrence,
 * after the fact.
 *
 * This is a room-sharing operation, not a "these are the same class"
 * declaration — the two classes keep their own individual subject and
 * faculty unchanged; only the destination room is shared. Any combination
 * of matching/different subject and faculty is allowed, EXCEPT two classes
 * with the same faculty: a faculty clash between two sections stays a
 * normal, blocking clash (see `scheduling.ts`'s `facultyShareAllowed`) —
 * for that case, use "Shared Room" while placing the class instead.
 */
export function MergeClassesPage() {
  const qc = useQueryClient()

  const term = useQuery({
    queryKey: ["terms-active"],
    queryFn: () => api.get<AcademicTerm | null>("/terms/active"),
  })

  const [day, setDay] = React.useState<Day | "">("")
  const [period, setPeriod] = React.useState<number | "">("")
  const [entryIdA, setEntryIdA] = React.useState("")
  const [entryIdB, setEntryIdB] = React.useState("")
  const [roomId, setRoomId] = React.useState("")

  const options = useQuery({
    queryKey: ["merge-options", day, period],
    enabled: day !== "" && period !== "",
    queryFn: () =>
      api.get<MergeOptionsResponse>(
        `/merge/options?dayOfWeek=${day}&startPeriod=${period}`
      ),
  })

  const classA = options.data?.options.find((o) => o.entryId === entryIdA) ?? null
  const classB = options.data?.options.find((o) => o.entryId === entryIdB) ?? null

  const classBChoices = React.useMemo(
    () => (options.data?.options ?? []).filter((o) => classA?.compatibleWith.includes(o.entryId)),
    [options.data, classA]
  )

  const roomType = classA?.entryType === "LAB" ? "LAB" : "CLASSROOM"
  const rooms = useQuery({
    queryKey: ["rooms", roomType],
    enabled: Boolean(classA),
    queryFn: () => api.get<Room[]>(`/rooms?type=${roomType}`),
  })

  // Default the destination room to Class 1's current room, once both the
  // pair and the room list are known — the admin can still change it.
  React.useEffect(() => {
    if (!roomId && classA?.room && rooms.data?.some((r) => r.id === classA.room!.id)) {
      setRoomId(classA.room.id)
    }
  }, [classA, rooms.data, roomId])

  const resetSelection = () => {
    setEntryIdA("")
    setEntryIdB("")
    setRoomId("")
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["merge-options"] })
    qc.invalidateQueries({ queryKey: ["merge-active"] })
    qc.invalidateQueries({ queryKey: ["timetable"] })
    qc.invalidateQueries({ queryKey: ["faculty-timetable"] })
    qc.invalidateQueries({ queryKey: ["room-timetable"] })
    qc.invalidateQueries({ queryKey: ["curriculum-status"] })
  }

  const merge = useMutation({
    mutationFn: () =>
      api.post<MergeResult>("/merge", { entryIdA, entryIdB, roomId }),
    onSuccess: () => {
      resetSelection()
      refresh()
    },
  })

  const periodSlots = (term.data?.grid?.slots ?? []).filter((s) => s.kind === "PERIOD")

  if (term.isLoading) return <LoadingState />
  if (term.error) return <ErrorState error={term.error} />
  if (!term.data) {
    return (
      <EmptyState
        title="No active term"
        hint="Set one up in Term Setup before merging classes."
      />
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <GitMerge className="size-5" /> Merge Classes
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Build each section's timetable normally first. Come back here to
          intentionally put two already-placed classes into one shared room —
          each keeps its own subject and faculty.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Pick the hour</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Day</label>
            <Select
              className="w-36"
              value={day}
              onChange={(e) => {
                setDay(e.target.value as Day)
                resetSelection()
              }}
            >
              <option value="">Choose a day…</option>
              {(term.data.timeConfig?.workingDays ?? []).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Period</label>
            <Select
              className="w-48"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value ? Number(e.target.value) : "")
                resetSelection()
              }}
            >
              <option value="">Choose a period…</option>
              {periodSlots.map((s) => (
                <option key={s.period} value={s.period ?? ""}>
                  P{s.period} ({displayTime(s.startTime)}–{displayTime(s.endTime)})
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {day !== "" && period !== "" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Pick the two classes</CardTitle>
            <CardDescription>
              Any two different sections' classes at this hour can share a
              room — pick the first one to see who it can be merged with.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {options.isLoading ? (
              <LoadingState />
            ) : options.error ? (
              <ErrorState error={options.error} />
            ) : !options.data?.options.length ? (
              <p className="text-sm text-muted-foreground">
                Nothing is timetabled at this hour yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Class 1</label>
                  <Select
                    className="w-72"
                    value={entryIdA}
                    onChange={(e) => {
                      setEntryIdA(e.target.value)
                      setEntryIdB("")
                      setRoomId("")
                    }}
                  >
                    <option value="">Choose a class…</option>
                    {options.data.options.map((o) => (
                      <OptionRow key={o.entryId} option={o} />
                    ))}
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Class 2</label>
                  <Select
                    className="w-72"
                    value={entryIdB}
                    disabled={!classA}
                    onChange={(e) => {
                      setEntryIdB(e.target.value)
                      setRoomId("")
                    }}
                  >
                    <option value="">
                      {classA
                        ? classBChoices.length
                          ? "Choose a class…"
                          : "No compatible class at this hour"
                        : "Pick Class 1 first"}
                    </option>
                    {classBChoices.map((o) => (
                      <OptionRow key={o.entryId} option={o} />
                    ))}
                  </Select>
                </div>
              </div>
            )}

            {classA?.alreadyMerged && (
              <p className="text-xs text-warning">
                {sectionLabel(classA.section)} is already merged with{" "}
                {classA.mergedWithLabel ?? "another section"} — unmerge it first
                (see "Currently merged" below).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {classA && classB && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Destination room</CardTitle>
            <CardDescription>
              Where the merged class will actually be conducted — the office
              chooses, it isn't inferred.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-1 w-56">
              <label className="text-xs text-muted-foreground">Room</label>
              {rooms.isLoading ? (
                <LoadingState />
              ) : rooms.error ? (
                <ErrorState error={rooms.error} />
              ) : (
                <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                  <option value="">Choose a room…</option>
                  {(rooms.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            <MergePreview classA={classA} classB={classB} roomId={roomId} rooms={rooms.data ?? []} />

            {merge.error && <ErrorState error={merge.error} />}

            <div className="flex justify-end">
              <Button disabled={!roomId || merge.isPending} onClick={() => merge.mutate()}>
                <GitMerge /> {merge.isPending ? "Merging…" : "Merge"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ActiveMerges onChanged={refresh} />
    </div>
  )
}

function OptionRow({ option }: { option: MergeOption }) {
  const label = `${sectionLabel(option.section)} — ${option.subject?.code ?? option.entryType} — ${
    option.faculty?.name ?? "no faculty"
  }`
  return (
    <option value={option.entryId} disabled={option.alreadyMerged}>
      {label}
      {option.room ? ` (${option.room.name})` : " (no room)"}
      {option.alreadyMerged ? " — already merged" : ""}
    </option>
  )
}

function MergePreview({
  classA,
  classB,
  roomId,
  rooms,
}: {
  classA: MergeOption
  classB: MergeOption
  roomId: string
  rooms: Room[]
}) {
  const roomName = rooms.find((r) => r.id === roomId)?.name ?? "—"
  return (
    <div className="rounded-lg border bg-muted/30 p-4 text-sm">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-center">
        <div className="space-y-0.5">
          <div className="font-medium">{sectionLabel(classA.section)}</div>
          <div className="text-muted-foreground">
            {classA.subject?.code} · {classA.faculty?.name} ·{" "}
            {classA.room?.name ?? "no room"}
          </div>
        </div>
        <ArrowRight className="size-4 text-muted-foreground justify-self-center rotate-90 sm:rotate-0" />
        <div className="space-y-0.5">
          <div className="font-medium">{sectionLabel(classB.section)}</div>
          <div className="text-muted-foreground">
            {classB.subject?.code} · {classB.faculty?.name} ·{" "}
            {classB.room?.name ?? "no room"}
          </div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t flex items-center gap-2">
        <Badge variant="warning">Shared room</Badge>
        <span>
          {sectionLabel(classA.section)} ({classA.subject?.code ?? "—"} /{" "}
          {classA.faculty?.name ?? "—"}) + {sectionLabel(classB.section)} (
          {classB.subject?.code ?? "—"} / {classB.faculty?.name ?? "—"}) →{" "}
          <span className="font-medium">{roomName}</span>
        </span>
      </div>
    </div>
  )
}

function ActiveMerges({ onChanged }: { onChanged: () => void }) {
  const active = useQuery({
    queryKey: ["merge-active"],
    queryFn: () => api.get<ActiveMergesResponse>("/merge/active"),
  })

  const unmerge = useMutation({
    mutationFn: (entryId: string) => api.post(`/entries/${entryId}/unmerge`),
    onSuccess: onChanged,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Currently merged</CardTitle>
        <CardDescription>Every combined class active right now.</CardDescription>
      </CardHeader>
      <CardContent>
        {active.isLoading ? (
          <LoadingState />
        ) : active.error ? (
          <ErrorState error={active.error} />
        ) : !active.data?.active.length ? (
          <p className="text-sm text-muted-foreground">Nothing is merged right now.</p>
        ) : (
          <div className="space-y-2">
            {unmerge.error && <ErrorState error={unmerge.error} />}
            {active.data.active.map((g) => (
              <div
                key={g.sharedSlotId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {g.dayOfWeek} P{g.startPeriod}
                    {g.periodSpan > 1 ? `–${g.startPeriod + g.periodSpan - 1}` : ""} ·{" "}
                    {g.room?.name ?? "no room"}
                  </div>
                  <div className="text-muted-foreground">
                    {g.sections
                      .map(
                        (s) =>
                          `${sectionLabel(s)} (${s.subject?.code ?? "—"} / ${s.faculty?.name ?? "—"})`
                      )
                      .join(" + ")}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={unmerge.isPending}
                  onClick={() => unmerge.mutate(g.sections[0].entryId)}
                >
                  <Split /> Unmerge
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
