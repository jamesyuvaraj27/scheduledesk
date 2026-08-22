import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight, BookOpen, Building2, Check, DoorOpen, GitBranch,
  LayoutGrid, Printer, TriangleAlert, Users,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ErrorState, LoadingState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { BuildStage, BuildStatusResponse, BuildStatusRow, Summary } from "@/lib/types"

const SETUP_CARDS = [
  { key: "departments", label: "Departments", icon: Building2 },
  { key: "branches", label: "Branches", icon: GitBranch },
  { key: "sections", label: "Sections", icon: LayoutGrid },
  { key: "rooms", label: "Rooms", icon: DoorOpen },
  { key: "subjects", label: "Subjects", icon: BookOpen },
  { key: "faculty", label: "Faculty", icon: Users },
] as const

/** What each stage means and where it sends you. */
const STAGE: Record<
  BuildStage,
  { label: string; tone: "success" | "warning" | "outline" | "secondary"; action: string }
> = {
  "needs-room": { label: "No home room", tone: "warning", action: "Set a room" },
  "needs-curriculum": { label: "No subjects", tone: "outline", action: "Add subjects" },
  "needs-faculty": { label: "Faculty missing", tone: "warning", action: "Assign faculty" },
  "ready-to-build": { label: "Ready to build", tone: "secondary", action: "Build timetable" },
  "in-progress": { label: "In progress", tone: "warning", action: "Continue" },
  done: { label: "Complete", tone: "success", action: "View" },
}

export function DashboardPage() {
  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api.get<Summary>("/summary"),
  })
  const status = useQuery({
    queryKey: ["build-status"],
    queryFn: () => api.get<BuildStatusResponse>("/build-status"),
  })

  if (summary.isLoading || status.isLoading) return <LoadingState />
  if (summary.error) return <ErrorState error={summary.error} />
  if (!summary.data) return null

  const counts = summary.data.counts
  const term = status.data?.term ?? null
  const years = status.data?.years ?? []
  const totals = status.data?.totals
  const setupIncomplete =
    counts.departments === 0 || counts.sections === 0 || counts.subjects === 0 ||
    counts.faculty === 0 || counts.rooms === 0 || !term

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {term ? (
              <>
                Active term: <span className="font-medium">{term.label}</span>
                {totals && totals.sections > 0 && (
                  <> · {totals.done} of {totals.sections} timetables complete</>
                )}
              </>
            ) : (
              "No active term yet."
            )}
          </p>
        </div>
        {years.length > 0 && (
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/print">
              <Printer /> Print all
            </Link>
          </Button>
        )}
      </div>

      {setupIncomplete && <SetupChecklist counts={counts} hasTerm={Boolean(term)} />}

      {years.length > 0 &&
        years
          .slice()
          .sort((a, b) => b.year - a.year) // 4th year first — the order they build in
          .map(({ year, sections, done, total }) => (
            <Card key={year}>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base">Year {year}</CardTitle>
                  <CardDescription>
                    {done} of {total} complete
                  </CardDescription>
                </div>
                <Badge variant={done === total ? "success" : "outline"}>
                  {Math.round((done / total) * 100)}%
                </Badge>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {sections.map((row) => (
                    <SectionRow key={row.section.id} row={row} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Master data</CardTitle>
          <CardDescription>Shared across every year and every term.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {SETUP_CARDS.map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              to="/admin/master-data"
              className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="rounded-md bg-muted p-2">
                <Icon className="size-4 text-muted-foreground" />
              </div>
              <div>
                <div className="text-lg font-semibold leading-none">{counts[key]}</div>
                <div className="text-xs text-muted-foreground mt-1">{label}</div>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function SectionRow({ row }: { row: BuildStatusRow }) {
  const { section, curriculum, timetable, stage } = row
  const meta = STAGE[stage]
  const pct =
    timetable.requiredPeriods > 0
      ? Math.min(100, Math.round((timetable.placedPeriods / timetable.requiredPeriods) * 100))
      : 0

  // Every admin screen lives under /admin/* — these must stay in sync with
  // the routes in App.tsx. Missing the prefix here previously sent Continue,
  // View, Assign faculty etc. to absolute paths outside /admin, which the
  // catch-all redirects bounced straight back to the dashboard (this is what
  // made "Continue" look broken).
  const href =
    stage === "needs-room"
      ? "/admin/master-data"
      : stage === "needs-curriculum" || stage === "needs-faculty"
        ? `/admin/curriculum/${section.id}`
        : stage === "done"
          ? `/admin/sections/${section.id}/timetable`
          : `/admin/sections/${section.id}/builder`

  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">
              {section.branchCode}-{section.name}
            </span>
            <Badge variant={meta.tone}>
              {stage === "done" && <Check className="size-3 mr-1" />}
              {meta.label}
            </Badge>
            {timetable.warnings.length > 0 && (
              <span title={timetable.warnings.join("\n")}>
                <TriangleAlert className="size-3.5 text-warning" />
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {section.departmentCode} · {curriculum.subjectCount} subjects ·{" "}
            {curriculum.assignedCount}/{curriculum.subjectCount} assigned ·{" "}
            {timetable.placedPeriods}/{timetable.requiredPeriods} periods placed
            {section.homeRoom ? ` · ${section.homeRoom}` : " · no room"}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
            <div
              className={cn(
                "h-full transition-all",
                timetable.complete ? "bg-success" : "bg-primary"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link to={href}>
              {meta.action} <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </li>
  )
}

function SetupChecklist({
  counts,
  hasTerm,
}: {
  counts: Summary["counts"]
  hasTerm: boolean
}) {
  const steps = [
    { done: counts.departments > 0, label: "Add departments and branches", to: "/admin/master-data" },
    { done: counts.rooms > 0, label: "Add rooms — classrooms and labs", to: "/admin/master-data" },
    { done: counts.sections > 0, label: "Add sections with a home classroom", to: "/admin/master-data" },
    { done: counts.subjects > 0, label: "Add subjects with their short codes", to: "/admin/master-data" },
    { done: counts.faculty > 0, label: "Add faculty and what they can teach", to: "/admin/master-data" },
    { done: hasTerm, label: "Create a term and set the daily timings", to: "/admin/term-setup" },
  ]
  const next = steps.find((s) => !s.done)

  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardHeader>
        <CardTitle className="text-base">Getting started</CardTitle>
        <CardDescription>
          A few things need to exist before a timetable can be built.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {steps.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span
              className={cn(
                "size-4 rounded-full border flex items-center justify-center text-[10px]",
                s.done
                  ? "bg-success/20 border-success/40 text-success"
                  : "border-muted-foreground/40"
              )}
            >
              {s.done ? "✓" : ""}
            </span>
            <span className={s.done ? "text-muted-foreground line-through" : ""}>
              {s.label}
            </span>
          </div>
        ))}
        {next && (
          <Button asChild size="sm" className="mt-2">
            <Link to={next.to}>
              {next.label} <ArrowRight />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
