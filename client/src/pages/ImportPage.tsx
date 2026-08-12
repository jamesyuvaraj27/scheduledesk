import * as React from "react"
import { Link, useParams, useNavigate } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { ArrowLeft, Check, FileSpreadsheet, TriangleAlert, Upload, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ErrorState, LoadingState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import { readSheetAsGrid, textToGrid } from "@/lib/sheet"
import { cn } from "@/lib/utils"
import type { Section } from "@/lib/types"

interface CodeReport {
  code: string
  subjectId: string | null
  subjectName: string | null
  willCreateSubject: boolean
  type: "THEORY" | "LAB"
  facultyName: string | null
  facultyId: string | null
  willCreateFaculty: boolean
  missingFaculty: boolean
  weeklyTheoryHrs: number
  weeklyLabHrs: number
}

interface Preview {
  section: Section
  term: { id: string; label: string }
  entries: { dayOfWeek: string; startPeriod: number; periodSpan: number; code: string }[]
  codes: CodeReport[]
  warnings: string[]
  existingEntryCount: number
  summary: {
    days: number
    entries: number
    periods: number
    needsSubjects: number
    needsFaculty: number
    unknownFaculty: number
  }
}

interface CommitResult {
  created: { subjects: number; faculty: number; entries: number }
  skipped: { code: string; reason: string }[]
  rejected: { dayOfWeek: string; startPeriod: number; code: string; reason: string }[]
  warnings: string[]
  imported: number
  total: number
}

/**
 * Import an existing timetable sheet.
 *
 * Deliberately two steps: read and show exactly what was found, then commit
 * only once the user has seen it. Nothing is written during preview.
 */
export function ImportPage() {
  const { sectionId = "" } = useParams()
  const navigate = useNavigate()

  const [rows, setRows] = React.useState<string[][] | null>(null)
  const [fileName, setFileName] = React.useState("")
  const [readError, setReadError] = React.useState<string | null>(null)
  const [replaceExisting, setReplaceExisting] = React.useState(true)
  const [skipped, setSkipped] = React.useState<Set<string>>(new Set())
  const [result, setResult] = React.useState<CommitResult | null>(null)

  const sections = useQuery({
    queryKey: ["sections"],
    queryFn: () => api.get<Section[]>("/sections"),
  })

  const preview = useMutation({
    mutationFn: (grid: string[][]) =>
      api.post<Preview>(`/sections/${sectionId}/import/preview`, { rows: grid }),
  })

  const commit = useMutation({
    mutationFn: () =>
      api.post<CommitResult>(`/sections/${sectionId}/import/commit`, {
        rows,
        replaceExisting,
        createMissing: true,
        overrides: [...skipped].map((code) => ({ code, skip: true })),
      }),
    onSuccess: (data) => setResult(data),
  })

  const handleFile = async (file: File) => {
    setReadError(null)
    setResult(null)
    try {
      const grid = file.name.endsWith(".csv")
        ? textToGrid(await file.text())
        : (await readSheetAsGrid(file)).rows
      setRows(grid)
      setFileName(file.name)
      preview.mutate(grid)
    } catch (e) {
      setReadError(e instanceof Error ? e.message : "Could not read that file.")
    }
  }

  const section = sections.data?.find((s) => s.id === sectionId)

  return (
    <div className="space-y-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link to="/curriculum">
            <ArrowLeft /> All sections
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">Import a timetable</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {section
            ? `Read an existing sheet into ${section.branch?.code}-${section.name} (Year ${section.year}).`
            : "Read an existing Excel or CSV sheet into a section."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Choose the file</CardTitle>
          <CardDescription>
            An .xlsx or .csv sheet with days down the left and period times across
            the top — the format the office already uses. Merged cells are handled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors",
              "hover:border-primary/50 hover:bg-muted/40"
            )}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files?.[0]
              if (file) void handleFile(file)
            }}
          >
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
            <Upload className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">
              {fileName || "Drop a sheet here, or click to choose"}
            </span>
            <span className="text-xs text-muted-foreground">.xlsx, .xls or .csv</span>
          </label>

          {readError && <ErrorState error={new Error(readError)} />}
          {preview.error ? <ErrorState error={preview.error} /> : null}
        </CardContent>
      </Card>

      {preview.isPending && <LoadingState label="Reading the sheet…" />}

      {preview.data && !result && (
        <>
          <PreviewSummary
            preview={preview.data}
            skipped={skipped}
            onToggleSkip={(code) =>
              setSkipped((prev) => {
                const next = new Set(prev)
                if (next.has(code)) next.delete(code)
                else next.add(code)
                return next
              })
            }
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Import</CardTitle>
              <CardDescription>
                Every class is still checked for clashes as it goes in — anything that
                would collide is reported instead of forced.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {preview.data.existingEntryCount > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={replaceExisting}
                    onChange={(e) => setReplaceExisting(e.target.checked)}
                    className="size-4"
                  />
                  Replace the {preview.data.existingEntryCount} class
                  {preview.data.existingEntryCount === 1 ? "" : "es"} already on this
                  section's timetable
                </label>
              )}

              {commit.error ? <ErrorState error={commit.error} /> : null}

              <Button onClick={() => commit.mutate()} disabled={commit.isPending}>
                <FileSpreadsheet />
                {commit.isPending ? "Importing…" : "Import this timetable"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {result && (
        <ResultPanel
          result={result}
          onView={() => navigate(`/sections/${sectionId}/timetable`)}
          onAgain={() => {
            setResult(null)
            setRows(null)
            setFileName("")
            preview.reset()
          }}
        />
      )}
    </div>
  )
}

function PreviewSummary({
  preview,
  skipped,
  onToggleSkip,
}: {
  preview: Preview
  skipped: Set<string>
  onToggleSkip: (code: string) => void
}) {
  const { summary, codes, warnings } = preview

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">2. Check what was found</CardTitle>
        <CardDescription>
          Nothing has been saved yet. Untick anything that shouldn't be imported.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{summary.entries} classes</Badge>
          <Badge variant="secondary">{summary.periods} periods</Badge>
          <Badge variant="secondary">{summary.days} days</Badge>
          {summary.needsSubjects > 0 && (
            <Badge variant="outline">{summary.needsSubjects} new subjects</Badge>
          )}
          {summary.needsFaculty > 0 && (
            <Badge variant="outline">{summary.needsFaculty} new faculty</Badge>
          )}
          {summary.unknownFaculty > 0 && (
            <Badge variant="warning">
              {summary.unknownFaculty} without a faculty name
            </Badge>
          )}
        </div>

        {warnings.map((w, i) => (
          <div key={i} className="flex items-start gap-2 text-sm text-warning">
            <TriangleAlert className="size-4 mt-0.5 shrink-0" />
            {w}
          </div>
        ))}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="h-9 px-2 w-10" />
                <th className="h-9 px-2 text-left font-medium text-muted-foreground">Code</th>
                <th className="h-9 px-2 text-left font-medium text-muted-foreground">Subject</th>
                <th className="h-9 px-2 text-left font-medium text-muted-foreground">Faculty</th>
                <th className="h-9 px-2 text-left font-medium text-muted-foreground">Hours</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const isSkipped = skipped.has(c.code)
                return (
                  <tr
                    key={c.code}
                    className={cn("border-b", isSkipped && "opacity-40 line-through")}
                  >
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={!isSkipped}
                        onChange={() => onToggleSkip(c.code)}
                        className="size-4"
                        aria-label={`Import ${c.code}`}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-medium">
                      {c.code}
                      {c.type === "LAB" && (
                        <Badge variant="warning" className="ml-1.5">
                          Lab
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {c.subjectName ?? (
                        <span className="text-muted-foreground">
                          new subject &ldquo;{c.code}&rdquo;
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {c.facultyName ? (
                        <span className={c.willCreateFaculty ? "text-muted-foreground" : ""}>
                          {c.facultyName}
                          {c.willCreateFaculty && " (new)"}
                        </span>
                      ) : (
                        <span className="text-warning">
                          not in the sheet's legend — will be skipped
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {c.weeklyTheoryHrs > 0 && `${c.weeklyTheoryHrs} theory`}
                      {c.weeklyTheoryHrs > 0 && c.weeklyLabHrs > 0 && " + "}
                      {c.weeklyLabHrs > 0 && `${c.weeklyLabHrs} lab`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function ResultPanel({
  result,
  onView,
  onAgain,
}: {
  result: CommitResult
  onView: () => void
  onAgain: () => void
}) {
  const clean = result.rejected.length === 0 && result.skipped.length === 0

  return (
    <Card className={clean ? "border-success/40" : "border-warning/40"}>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {clean ? (
            <>
              <Check className="size-4 text-success" /> Imported
            </>
          ) : (
            <>
              <TriangleAlert className="size-4 text-warning" /> Imported with notes
            </>
          )}
        </CardTitle>
        <CardDescription>
          {result.imported} of {result.total} classes placed
          {result.created.subjects > 0 && `, ${result.created.subjects} subjects created`}
          {result.created.faculty > 0 && `, ${result.created.faculty} faculty created`}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.rejected.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1">Not placed</p>
            <ul className="text-sm text-muted-foreground space-y-0.5">
              {result.rejected.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <X className="size-3.5 mt-0.5 text-destructive shrink-0" />
                  <span>
                    {r.dayOfWeek} period {r.startPeriod} · {r.code} — {r.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.skipped.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-1">Skipped</p>
            <ul className="text-sm text-muted-foreground space-y-0.5">
              {result.skipped.map((s, i) => (
                <li key={i}>
                  {s.code} — {s.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={onView}>View the timetable</Button>
          <Button variant="outline" onClick={onAgain}>
            Import another
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
