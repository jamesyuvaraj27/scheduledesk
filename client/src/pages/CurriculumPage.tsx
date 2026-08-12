import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, ArrowLeft, TriangleAlert, Upload, CalendarDays } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Dialog } from "@/components/ui/dialog"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import type { CurriculumResponse, CurriculumRow } from "@/lib/types"

const LAB_SPAN = 3

export function CurriculumPage() {
  const { sectionId = "" } = useParams()
  const qc = useQueryClient()
  const [adding, setAdding] = React.useState(false)

  const key = ["curriculum", sectionId]
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.get<CurriculumResponse>(`/sections/${sectionId}/curriculum`),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ["curriculum-status"] })
    qc.invalidateQueries({ queryKey: ["faculty-workload"] })
  }

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/curriculum/${id}`),
    onSuccess: invalidate,
  })

  const assign = useMutation({
    mutationFn: ({ subjectId, facultyId }: { subjectId: string; facultyId: string | null }) =>
      api.put(`/sections/${sectionId}/assignments/${subjectId}`, { facultyId }),
    onSuccess: invalidate,
  })

  const updateHours = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, number> }) =>
      api.patch(`/curriculum/${id}`, body),
    onSuccess: invalidate,
  })

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (!data) return null

  const { section, rows, availableSubjects, totals } = data
  const label = `${section.branch?.code}-${section.name}`

  return (
    <div className="space-y-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link to="/curriculum">
            <ArrowLeft /> All sections
          </Link>
        </Button>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <h1 className="text-xl font-semibold">
            {label} <span className="text-muted-foreground font-normal">· Year {section.year}</span>
          </h1>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/sections/${sectionId}/import`}>
                <Upload /> Import sheet
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to={`/sections/${sectionId}/builder`}>
                <CalendarDays /> Build timetable
              </Link>
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {section.branch?.department?.code} · {data.term.label} · Home room{" "}
          {section.homeRoom?.name ?? "not set"}
        </p>
      </div>

      {!section.homeRoomId && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <TriangleAlert className="size-4 mt-0.5 text-warning shrink-0" />
          <span>
            This section has no home classroom. Set one in{" "}
            <Link to="/master-data" className="underline">
              Master Data
            </Link>{" "}
            — theory classes need a room to check clashes against.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Subjects" value={totals.subjects} />
        <StatCard
          label="Weekly teaching hours"
          value={totals.weeklyHours}
          hint={`+${totals.weeklyActivityHours} for library, seminar & counseling`}
        />
        <StatCard
          label="Faculty assigned"
          value={`${totals.subjects - totals.missingFaculty.length}/${totals.subjects}`}
          warn={totals.missingFaculty.length > 0}
          hint={
            totals.missingFaculty.length
              ? `Missing: ${totals.missingFaculty.join(", ")}`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Curriculum</CardTitle>
            <CardDescription>
              Required weekly hours per subject, and who teaches it in this section.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => setAdding(true)}
            disabled={availableSubjects.length === 0}
          >
            <Plus /> Add subject
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {remove.error ? <ErrorState error={remove.error} /> : null}
          {assign.error ? <ErrorState error={assign.error} /> : null}
          {updateHours.error ? <ErrorState error={updateHours.error} /> : null}

          {rows.length === 0 ? (
            <EmptyState
              title="No subjects yet"
              hint="Add the subjects this section studies, with their weekly hours."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <Th>Code</Th>
                    <Th>Subject</Th>
                    <Th className="w-28">Theory hrs</Th>
                    <Th className="w-28">Lab hrs</Th>
                    <Th>Faculty</Th>
                    <Th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <CurriculumTableRow
                      key={row.id}
                      row={row}
                      onHoursChange={(body) => updateHours.mutate({ id: row.id, body })}
                      onFacultyChange={(facultyId) =>
                        assign.mutate({ subjectId: row.subject.id, facultyId })
                      }
                      onRemove={() => {
                        if (window.confirm(`Remove ${row.subject.code} from this section?`)) {
                          remove.mutate(row.id)
                        }
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {availableSubjects.length === 0 && rows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Every subject for this branch is already in the curriculum. Add more
              subjects in Master Data if needed.
            </p>
          )}
        </CardContent>
      </Card>

      <AddSubjectDialog
        open={adding}
        onClose={() => setAdding(false)}
        sectionId={sectionId}
        subjects={availableSubjects}
        onSaved={invalidate}
      />
    </div>
  )
}

function CurriculumTableRow({
  row,
  onHoursChange,
  onFacultyChange,
  onRemove,
}: {
  row: CurriculumRow
  onHoursChange: (body: Record<string, number>) => void
  onFacultyChange: (facultyId: string | null) => void
  onRemove: () => void
}) {
  return (
    <tr className="border-b hover:bg-muted/40">
      <Td className="font-medium">{row.subject.code}</Td>
      <Td>
        <div className="flex items-center gap-2">
          {row.subject.name}
          {row.subject.type === "LAB" && <Badge variant="warning">Lab</Badge>}
        </div>
      </Td>
      <Td>
        <HoursInput
          value={row.weeklyTheoryHrs}
          onCommit={(v) => onHoursChange({ weeklyTheoryHrs: v })}
        />
      </Td>
      <Td>
        <HoursInput
          value={row.weeklyLabHrs}
          step={LAB_SPAN}
          onCommit={(v) => onHoursChange({ weeklyLabHrs: v })}
        />
      </Td>
      <Td>
        {row.eligibleFaculty.length === 0 ? (
          <span className="text-xs text-muted-foreground italic">
            nobody is marked able to teach this
          </span>
        ) : (
          <Select
            value={row.faculty?.id ?? ""}
            onChange={(e) => onFacultyChange(e.target.value || null)}
            className={row.faculty ? "" : "border-warning/60"}
          >
            <option value="">— not assigned —</option>
            {row.eligibleFaculty.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        )}
      </Td>
      <Td>
        <Button
          size="icon"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          aria-label="Remove subject"
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </Td>
    </tr>
  )
}

/** Commits on blur so we don't fire a request per keystroke. */
function HoursInput({
  value,
  step = 1,
  onCommit,
}: {
  value: number
  step?: number
  onCommit: (value: number) => void
}) {
  const [local, setLocal] = React.useState(String(value))
  React.useEffect(() => setLocal(String(value)), [value])

  return (
    <Input
      type="number"
      min={0}
      step={step}
      value={local}
      className="h-8"
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        const n = Number(local)
        if (!Number.isNaN(n) && n !== value) onCommit(n)
        else setLocal(String(value))
      }}
    />
  )
}

function AddSubjectDialog({
  open,
  onClose,
  sectionId,
  subjects,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  sectionId: string
  subjects: CurriculumResponse["availableSubjects"]
  onSaved: () => void
}) {
  const [subjectId, setSubjectId] = React.useState("")
  const [theory, setTheory] = React.useState("4")
  const [lab, setLab] = React.useState("0")

  const chosen = subjects.find((s) => s.id === subjectId)

  React.useEffect(() => {
    if (!chosen) return
    // Sensible defaults: a lab subject is one 3-period block a week.
    if (chosen.type === "LAB") {
      setTheory("0")
      setLab(String(LAB_SPAN))
    } else {
      setTheory("4")
      setLab("0")
    }
  }, [chosen])

  const create = useMutation({
    mutationFn: () =>
      api.post(`/sections/${sectionId}/curriculum`, {
        subjectId,
        weeklyTheoryHrs: Number(theory),
        weeklyLabHrs: Number(lab),
      }),
    onSuccess: () => {
      onSaved()
      setSubjectId("")
      onClose()
    },
  })

  return (
    <Dialog open={open} onClose={onClose} title="Add subject to curriculum">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        {create.error ? <ErrorState error={create.error} /> : null}

        <div>
          <Label htmlFor="subject">Subject</Label>
          <Select
            id="subject"
            value={subjectId}
            required
            onChange={(e) => setSubjectId(e.target.value)}
          >
            <option value="">— select —</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
                {s.type === "LAB" ? " (lab)" : ""}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="theory">Weekly theory hours</Label>
            <Input
              id="theory"
              type="number"
              min={0}
              value={theory}
              onChange={(e) => setTheory(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lab">Weekly lab hours</Label>
            <Input
              id="lab"
              type="number"
              min={0}
              step={LAB_SPAN}
              value={lab}
              onChange={(e) => setLab(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Must be a multiple of {LAB_SPAN} — a lab runs {LAB_SPAN} continuous periods.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || !subjectId}>
            {create.isPending ? "Adding…" : "Add"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function StatCard({
  label,
  value,
  hint,
  warn,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  warn?: boolean
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className={"text-2xl font-semibold leading-none " + (warn ? "text-warning" : "")}>
          {value}
        </div>
        <div className="text-sm text-muted-foreground mt-1.5">{label}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  )
}

function Th({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <th className={"h-10 px-3 text-left align-middle font-medium text-muted-foreground " + className}>
      {children}
    </th>
  )
}

function Td({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return <td className={"px-3 py-2 align-middle " + className}>{children}</td>
}
