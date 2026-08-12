import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, ArrowRight, Check, RotateCcw, Trash2, TriangleAlert } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ErrorState, LoadingState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import type { AcademicTerm } from "@/lib/types"

interface ResetPreview {
  currentTerm: AcademicTerm | null
  preserved: {
    departments: number
    branches: number
    sections: number
    rooms: number
    faculty: number
    subjects: number
  }
  archived: { entries: number; curriculumRows: number; assignments: number }
  suggestion: { year: number; semester: number }
}

/**
 * Rolling into a new academic year.
 *
 * Nothing is deleted. A new term becomes active and the old one stays put as
 * history, which is both safer and how the office actually thinks about it —
 * last year's timetable is a record, not rubbish.
 */
export function ResetYearPage() {
  const qc = useQueryClient()
  const [confirmText, setConfirmText] = React.useState("")
  const [copyCurriculum, setCopyCurriculum] = React.useState(true)
  const [copyTimings, setCopyTimings] = React.useState(true)
  const [done, setDone] = React.useState<{ label: string; copied: number } | null>(null)

  const preview = useQuery({
    queryKey: ["reset-preview"],
    queryFn: () => api.get<ResetPreview>("/terms/reset-preview"),
  })

  const terms = useQuery({
    queryKey: ["terms"],
    queryFn: () => api.get<AcademicTerm[]>("/terms"),
  })

  const [year, setYear] = React.useState("")
  const [semester, setSemester] = React.useState("")
  const [label, setLabel] = React.useState("")

  // Seed the form from the server's suggestion once it arrives.
  React.useEffect(() => {
    if (preview.data && !year) {
      setYear(String(preview.data.suggestion.year))
      setSemester(String(preview.data.suggestion.semester))
    }
  }, [preview.data, year])

  const invalidateEverything = () => {
    qc.invalidateQueries()
  }

  const reset = useMutation({
    mutationFn: () =>
      api.post<AcademicTerm & { copiedCurriculumRows: number }>("/terms/reset", {
        year: Number(year),
        semester: Number(semester),
        label: label || defaultLabel(year, semester),
        copyTimeConfigFromTermId:
          copyTimings && preview.data?.currentTerm ? preview.data.currentTerm.id : undefined,
        copyCurriculumFromTermId:
          copyCurriculum && preview.data?.currentTerm ? preview.data.currentTerm.id : undefined,
      }),
    onSuccess: (data) => {
      setDone({ label: data.label, copied: data.copiedCurriculumRows ?? 0 })
      setConfirmText("")
      invalidateEverything()
    },
  })

  const activate = useMutation({
    mutationFn: (id: string) => api.post(`/terms/${id}/activate`),
    onSuccess: invalidateEverything,
  })

  const removeTerm = useMutation({
    mutationFn: (id: string) => api.del(`/terms/${id}`),
    onSuccess: invalidateEverything,
  })

  if (preview.isLoading) return <LoadingState />
  if (preview.error) return <ErrorState error={preview.error} />
  if (!preview.data) return null

  const { currentTerm, preserved, archived } = preview.data
  const CONFIRM_WORD = "NEW YEAR"
  const canReset =
    confirmText.trim().toUpperCase() === CONFIRM_WORD && year !== "" && semester !== ""

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Academic Year Reset</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Start a fresh term without losing anything you've set up.
        </p>
      </div>

      {done && (
        <Card className="border-success/40">
          <CardContent className="pt-5 flex items-start gap-3">
            <Check className="size-5 text-success mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">{done.label} is now the active term.</p>
              <p className="text-muted-foreground mt-1">
                {done.copied > 0
                  ? `${done.copied} curriculum rows were carried over — set the faculty for each in Curriculum, then build the timetables.`
                  : "Set up each section's curriculum, then build the timetables."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Check className="size-4 text-success" /> Kept as-is
            </CardTitle>
            <CardDescription>
              Master data belongs to the college, not the year. None of this is touched.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-y-1.5 text-sm">
            <Kept label="Departments" value={preserved.departments} />
            <Kept label="Branches" value={preserved.branches} />
            <Kept label="Sections" value={preserved.sections} />
            <Kept label="Rooms" value={preserved.rooms} />
            <Kept label="Faculty" value={preserved.faculty} />
            <Kept label="Subjects" value={preserved.subjects} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Archive className="size-4 text-muted-foreground" /> Kept as history
            </CardTitle>
            <CardDescription>
              {currentTerm
                ? `Stays attached to ${currentTerm.label}. Nothing is deleted — you can make that term active again to look at it.`
                : "There's no active term yet, so there's nothing to archive."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-y-1.5 text-sm">
            <Kept label="Placed classes" value={archived.entries} />
            <Kept label="Curriculum rows" value={archived.curriculumRows} />
            <Kept label="Faculty assignments" value={archived.assignments} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Start the new term</CardTitle>
          <CardDescription>
            The new term begins with empty timetables. Faculty assignments always start
            fresh, since who teaches what changes year to year.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {reset.error ? <ErrorState error={reset.error} /> : null}

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-28">
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
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
              />
            </div>
            <div className="flex-1 min-w-52">
              <Label htmlFor="label">Label</Label>
              <Input
                id="label"
                value={label}
                placeholder={defaultLabel(year, semester)}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
          </div>

          {currentTerm && (
            <div className="space-y-2 border-t pt-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={copyTimings}
                  onChange={(e) => setCopyTimings(e.target.checked)}
                  className="size-4 mt-0.5"
                />
                <span>
                  Copy the daily timings from {currentTerm.label}
                  <span className="block text-xs text-muted-foreground">
                    Start time, periods, break and lunch. Editable afterwards.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={copyCurriculum}
                  onChange={(e) => setCopyCurriculum(e.target.checked)}
                  className="size-4 mt-0.5"
                />
                <span>
                  Copy the curriculum ({archived.curriculumRows} rows)
                  <span className="block text-xs text-muted-foreground">
                    Each section's subjects and weekly hours. The syllabus usually stays
                    the same — only the faculty change.
                  </span>
                </span>
              </label>
            </div>
          )}

          <div className="border-t pt-3">
            <Label htmlFor="confirm">
              Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
            </Label>
            <div className="flex gap-2">
              <Input
                id="confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_WORD}
                className="max-w-48"
              />
              <Button onClick={() => reset.mutate()} disabled={!canReset || reset.isPending}>
                <RotateCcw />
                {reset.isPending ? "Starting…" : "Start new term"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All terms</CardTitle>
          <CardDescription>
            Make an older term active to view or print its timetables.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {removeTerm.error ? <ErrorState error={removeTerm.error} /> : null}
          {terms.isLoading ? (
            <LoadingState />
          ) : !terms.data?.length ? (
            <p className="text-sm text-muted-foreground">No terms yet.</p>
          ) : (
            <ul className="divide-y">
              {terms.data.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{t.label}</span>
                      {t.isActive && <Badge variant="success">Active</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t.year} · Semester {t.semester} · {t._count?.timetableEntries ?? 0}{" "}
                      classes · {t._count?.sectionAssignments ?? 0} assignments
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!t.isActive && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => activate.mutate(t.id)}
                          disabled={activate.isPending}
                        >
                          Make active <ArrowRight />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Delete term"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Permanently delete ${t.label} and everything in it? This cannot be undone.`
                              )
                            ) {
                              removeTerm.mutate(t.id)
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="flex items-start gap-2 text-xs text-muted-foreground mt-3 pt-3 border-t">
            <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
            Deleting a term removes its timetables permanently. Rolling the year with the
            button above keeps them.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Kept({ label, value }: { label: string; value: number }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </>
  )
}

function defaultLabel(year: string, semester: string): string {
  if (!year) return ""
  const next = String(Number(year) + 1).slice(2)
  return `${year}-${next} Sem ${semester || 1}`
}
