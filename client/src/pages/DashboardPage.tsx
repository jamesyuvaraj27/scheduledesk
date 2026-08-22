import type { ComponentType } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight, BookOpen, Building2, CalendarCog, CalendarDays, Check, DoorOpen,
  FileSpreadsheet, GitBranch, LayoutGrid, Printer, RotateCcw, TriangleAlert,
  Users, Wrench,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ErrorState, LoadingState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { BuildStage, BuildStatusResponse, BuildStatusRow, Summary } from "@/lib/types"

/**
 * The dashboard, in the order the work actually happens.
 *
 * Master Data comes first: it's what everything else is built on, and it's
 * the screen the office reaches for most often. It used to sit at the bottom
 * under every year's section list, which meant scrolling past the thing you
 * hadn't set up yet to get to the thing that sets it up.
 *
 *   1. Master Data          — departments, branches, sections, rooms, subjects, faculty
 *   2. Academic Settings    — the term and its daily timings
 *   3. Timetable Builder    — per-section progress and what to do next
 *   4. Timetables           — view and print what's been built
 *   5. Reports              — the day-wise view
 *   6. Reset Academic Year  — roll into a new term
 *
 * Every link here must carry the `/admin` prefix. There is no compile-time
 * check for that, and App.tsx's catch-all redirects will quietly bounce a
 * missing prefix back to this page instead of erroring — which is exactly how
 * the Continue button looked broken before.
 */

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

      {/* Not a section — a blocker. It sits above the ordered list because
          nothing below it can be finished until it's cleared. */}
      {setupIncomplete && <SetupChecklist counts={counts} hasTerm={Boolean(term)} />}

      {/* ------------------------------ 1. Master Data ------------------------ */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Master Data</CardTitle>
            <CardDescription>
              Shared across every year and every term. It survives an academic-year reset.
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link to="/admin/master-data">
              Open <ArrowRight />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          {SETUP_CARDS.map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              to="/admin/master-data"
              className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="rounded-md bg-muted p-2 shrink-0">
                <Icon className="size-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-semibold leading-none">{counts[key]}</div>
                <div className="text-xs text-muted-foreground mt-1 truncate">{label}</div>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* --------------------------- 2. Academic Settings --------------------- */}
      <SectionCard
        title="Academic Settings"
        description={
          term
            ? `${term.label} — start time, period lengths, break, lunch and working days.`
            : "Create a term and set the daily timings before building anything."
        }
        links={[
          { to: "/admin/term-setup", label: "Term & timings", icon: CalendarCog },
          { to: "/admin/curriculum", label: "Curriculum & faculty", icon: BookOpen },
        ]}
      />

      {/* --------------------------- 3. Timetable Builder --------------------- */}
      {years.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Wrench className="size-4" /> Timetable Builder
              </h2>
              <p className="text-sm text-muted-foreground">
                Where each section stands, and the one thing to do next.
              </p>
            </div>
          </div>

          {years
            .slice()
            .sort((a, b) => b.year - a.year) // 4th year first — the order they build in
            .map(({ year, sections, done, total }) => (
              <Card key={year}>
                <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
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
        </div>
      )}

      {/* ------------------------------ 4. Timetables ------------------------- */}
      <SectionCard
        title="Timetables"
        description="View and print what's been built — by section, by faculty member, or by room."
        links={[
          { to: "/admin/faculty", label: "Faculty timetables", icon: Users },
          { to: "/admin/rooms", label: "Room timetables", icon: DoorOpen },
          { to: "/admin/print", label: "Print all sections", icon: Printer },
          { to: "/admin/print/faculty", label: "Print all faculty", icon: Printer },
          { to: "/admin/print/rooms", label: "Print all rooms", icon: Printer },
          { to: "/admin/working-timetable", label: "Working copy", icon: LayoutGrid },
        ]}
      />

      {/* -------------------------------- 5. Reports -------------------------- */}
      <SectionCard
        title="Reports"
        description="Cross-section views. These are public pages — no sign-in needed to read them."
        links={[
          { to: "/reports/day-wise", label: "Day-wise section report", icon: FileSpreadsheet },
          { to: "/", label: "Student timetable view", icon: CalendarDays },
          { to: "/adjustment", label: "Class adjustment", icon: Users },
        ]}
      />

      {/* -------------------------- 6. Reset Academic Year -------------------- */}
      <SectionCard
        title="Reset Academic Year"
        description="Start a new term. Master data is kept; last year's timetables stay as history."
        links={[{ to: "/admin/reset", label: "Roll the academic year", icon: RotateCcw }]}
      />
    </div>
  )
}

/**
 * A dashboard section that's a set of destinations rather than a set of
 * numbers — used for everything except Master Data and the builder.
 */
function SectionCard({
  title,
  description,
  links,
}: {
  title: string
  description: string
  links: { to: string; label: string; icon: ComponentType<{ className?: string }> }[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {links.map(({ to, label, icon: Icon }) => (
          <Link
            key={to + label}
            to={to}
            className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors"
          >
            <Icon className="size-4 text-muted-foreground shrink-0" />
            <span className="truncate">{label}</span>
            <ArrowRight className="size-3.5 ml-auto text-muted-foreground shrink-0" />
          </Link>
        ))}
      </CardContent>
    </Card>
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
          <div className="flex items-center gap-2 flex-wrap">
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

        <div className="flex items-center gap-3 shrink-0 ml-auto">
          <div
            className="w-16 sm:w-24 h-1.5 rounded-full bg-muted overflow-hidden"
            aria-hidden
          >
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
                "size-4 rounded-full border flex items-center justify-center text-[10px] shrink-0",
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
