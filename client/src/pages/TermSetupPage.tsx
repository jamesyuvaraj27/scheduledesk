import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ErrorState, LoadingState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import type { AcademicTerm, ComputedGrid, Day } from "@/lib/types"

const ALL_DAYS: Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

interface ConfigForm {
  startTime: string
  numPeriods: number
  morningPeriodDurationMin: number
  afternoonPeriodDurationMin: number
  breakAfterPeriod: number
  breakDurationMin: number
  lunchAfterPeriod: number
  lunchDurationMin: number
  workingDays: Day[]
}

export function TermSetupPage() {
  const qc = useQueryClient()
  const terms = useQuery({
    queryKey: ["terms"],
    queryFn: () => api.get<AcademicTerm[]>("/terms"),
  })

  const activeTerm = terms.data?.find((t) => t.isActive) ?? null

  const createTerm = useMutation({
    mutationFn: (body: { year: number; semester: number; label: string }) =>
      api.post<AcademicTerm>("/terms", { ...body, makeActive: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terms"] })
      qc.invalidateQueries({ queryKey: ["summary"] })
    },
  })

  const activate = useMutation({
    mutationFn: (id: string) => api.post<AcademicTerm>(`/terms/${id}/activate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terms"] })
      qc.invalidateQueries({ queryKey: ["summary"] })
    },
  })

  if (terms.isLoading) return <LoadingState />
  if (terms.error) return <ErrorState error={terms.error} />

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Term Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Daily timings for the active term. Change these and every timetable grid,
          printed sheet and lab rule updates automatically.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Academic terms</CardTitle>
          <CardDescription>
            Exactly one term is active. Older terms stay as history — nothing is deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {createTerm.error ? <ErrorState error={createTerm.error} /> : null}

          {terms.data?.length ? (
            <ul className="space-y-1.5">
              {terms.data.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.label}</span>
                    <span className="text-muted-foreground">
                      {t.year} · Sem {t.semester}
                    </span>
                    {t.isActive && <Badge variant="success">Active</Badge>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {t._count?.timetableEntries ?? 0} entries
                    </span>
                    {!t.isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => activate.mutate(t.id)}
                        disabled={activate.isPending}
                      >
                        Make active
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No terms yet — create one to begin.
            </p>
          )}

          <NewTermForm
            onSubmit={(body) => createTerm.mutate(body)}
            pending={createTerm.isPending}
          />
        </CardContent>
      </Card>

      {activeTerm ? (
        <TimeConfigEditor term={activeTerm} />
      ) : (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">
            Create a term above to configure daily timings.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function NewTermForm({
  onSubmit,
  pending,
}: {
  onSubmit: (body: { year: number; semester: number; label: string }) => void
  pending: boolean
}) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = React.useState(String(thisYear))
  const [semester, setSemester] = React.useState("1")
  const [label, setLabel] = React.useState("")

  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({
          year: Number(year),
          semester: Number(semester),
          label: label || `${year}-${String(Number(year) + 1).slice(2)} Sem ${semester}`,
        })
        setLabel("")
      }}
    >
      <div className="w-28">
        <Label htmlFor="year">Year</Label>
        <Input
          id="year"
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          required
        />
      </div>
      <div className="w-28">
        <Label htmlFor="sem">Semester</Label>
        <Input
          id="sem"
          type="number"
          min={1}
          max={2}
          value={semester}
          onChange={(e) => setSemester(e.target.value)}
          required
        />
      </div>
      <div className="flex-1 min-w-48">
        <Label htmlFor="label">Label</Label>
        <Input
          id="label"
          value={label}
          placeholder={`${year}-${String(Number(year) + 1).slice(2)} Sem ${semester}`}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create term"}
      </Button>
    </form>
  )
}

function TimeConfigEditor({ term }: { term: AcademicTerm }) {
  const qc = useQueryClient()
  const cfg = term.timeConfig

  const [form, setForm] = React.useState<ConfigForm>(() => ({
    startTime: cfg?.startTime ?? "08:00",
    numPeriods: cfg?.numPeriods ?? 7,
    morningPeriodDurationMin: cfg?.morningPeriodDurationMin ?? 60,
    afternoonPeriodDurationMin: cfg?.afternoonPeriodDurationMin ?? 50,
    breakAfterPeriod: cfg?.breakAfterPeriod ?? 2,
    breakDurationMin: cfg?.breakDurationMin ?? 20,
    lunchAfterPeriod: cfg?.lunchAfterPeriod ?? 5,
    lunchDurationMin: cfg?.lunchDurationMin ?? 50,
    workingDays: cfg?.workingDays ?? ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
  }))

  // Live preview — recomputed server-side so the client never duplicates the rules.
  const preview = useQuery({
    queryKey: ["preview-grid", form],
    queryFn: () => {
      const { workingDays: _ignored, ...rest } = form
      return api.post<ComputedGrid>("/terms/preview-grid", rest)
    },
  })

  const save = useMutation({
    mutationFn: () => api.put(`/terms/${term.id}/time-config`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terms"] })
      qc.invalidateQueries({ queryKey: ["summary"] })
    },
  })

  const num = (key: keyof ConfigForm) => ({
    type: "number" as const,
    value: String(form[key]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: Number(e.target.value) })),
  })

  const toggleDay = (d: Day) =>
    setForm((f) => ({
      ...f,
      workingDays: f.workingDays.includes(d)
        ? f.workingDays.filter((x) => x !== d)
        : ALL_DAYS.filter((x) => f.workingDays.includes(x) || x === d),
    }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Daily timings — {term.label}</CardTitle>
        <CardDescription>
          8:00–3:00 with 50-minute periods, or 9:00–5:00 with 60 — it is all just
          configuration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {save.error ? <ErrorState error={save.error} /> : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="startTime">Start time</Label>
            <Input
              id="startTime"
              value={form.startTime}
              placeholder="08:00"
              onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="numPeriods">Periods per day</Label>
            <Input id="numPeriods" min={1} max={12} {...num("numPeriods")} />
          </div>
          <div>
            <Label htmlFor="morningPeriodDurationMin">Morning period (min)</Label>
            <Input
              id="morningPeriodDurationMin"
              min={20}
              max={120}
              {...num("morningPeriodDurationMin")}
            />
          </div>
          <div>
            <Label htmlFor="afternoonPeriodDurationMin">Afternoon period (min)</Label>
            <Input
              id="afternoonPeriodDurationMin"
              min={20}
              max={120}
              {...num("afternoonPeriodDurationMin")}
            />
          </div>
          <div>
            <Label htmlFor="breakAfterPeriod">Break after period</Label>
            <Input id="breakAfterPeriod" min={0} {...num("breakAfterPeriod")} />
          </div>
          <div>
            <Label htmlFor="breakDurationMin">Break length (min)</Label>
            <Input id="breakDurationMin" min={0} {...num("breakDurationMin")} />
          </div>
          <div>
            <Label htmlFor="lunchAfterPeriod">Lunch after period</Label>
            <Input id="lunchAfterPeriod" min={0} {...num("lunchAfterPeriod")} />
          </div>
          <div>
            <Label htmlFor="lunchDurationMin">Lunch length (min)</Label>
            <Input id="lunchDurationMin" min={0} {...num("lunchDurationMin")} />
          </div>
        </div>

        <div>
          <Label>Working days</Label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_DAYS.map((d) => {
              const on = form.workingDays.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors " +
                    (on
                      ? "bg-primary text-primary-foreground border-primary"
                      : "text-muted-foreground hover:bg-muted")
                  }
                >
                  {d}
                </button>
              )
            })}
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <Label className="mb-0">Preview</Label>
            {preview.data && (
              <span className="text-xs text-muted-foreground">
                Day ends at {preview.data.endTime}
              </span>
            )}
          </div>

          {preview.isError ? (
            <ErrorState error={preview.error} />
          ) : preview.data ? (
            <>
              <div className="overflow-x-auto">
                <table className="border-collapse text-xs">
                  <tbody>
                    <tr>
                      {preview.data.slots.map((s, i) => (
                        <td
                          key={i}
                          className={
                            "border px-2 py-1 text-center whitespace-nowrap " +
                            (s.kind === "PERIOD"
                              ? "font-medium"
                              : "bg-muted text-muted-foreground")
                          }
                        >
                          {s.kind === "PERIOD" ? `P${s.period}` : s.kind}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      {preview.data.slots.map((s, i) => (
                        <td
                          key={i}
                          className="border px-2 py-1 text-center text-muted-foreground whitespace-nowrap"
                        >
                          {s.startTime}
                          <br />
                          {s.endTime}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Periods up to and including lunch run{" "}
                <span className="font-medium text-foreground">
                  {form.morningPeriodDurationMin} min
                </span>
                ; periods after lunch run{" "}
                <span className="font-medium text-foreground">
                  {form.afternoonPeriodDurationMin} min
                </span>
                . Labs can cover any number of consecutive periods — you choose
                the length when placing one.
              </p>
            </>
          ) : (
            <LoadingState label="Computing…" />
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save timings"}
          </Button>
          {save.isSuccess && !save.isPending && (
            <span className="text-sm text-success">Saved</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
