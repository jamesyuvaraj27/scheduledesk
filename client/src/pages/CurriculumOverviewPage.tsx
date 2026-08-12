import * as React from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import type { CurriculumStatusResponse, FacultyWorkloadResponse } from "@/lib/types"

/** Soft warning line — nobody is blocked, they're just flagged. */
const WORKLOAD_WARN_HOURS = 6 * 6

export function CurriculumOverviewPage() {
  const [year, setYear] = React.useState<number | "all">("all")

  const status = useQuery({
    queryKey: ["curriculum-status"],
    queryFn: () => api.get<CurriculumStatusResponse>("/curriculum-status"),
  })

  const workload = useQuery({
    queryKey: ["faculty-workload"],
    queryFn: () => api.get<FacultyWorkloadResponse>("/faculty-workload"),
  })

  if (status.isLoading) return <LoadingState />
  if (status.error) return <ErrorState error={status.error} />
  if (!status.data) return null

  const { term, sections } = status.data
  const years = [...new Set(sections.map((s) => s.section.year))].sort()
  const visible = year === "all" ? sections : sections.filter((s) => s.section.year === year)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Curriculum</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {term
            ? `What each section studies this term, and who teaches it. (${term.label})`
            : "No active term — create one in Term Setup first."}
        </p>
      </div>

      {!term ? (
        <Card>
          <CardContent className="pt-5">
            <EmptyState
              title="No active academic term"
              hint="Create a term in Term Setup before setting up curriculum."
            />
            <div className="flex justify-center">
              <Button asChild size="sm">
                <Link to="/term-setup">Go to Term Setup</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : sections.length === 0 ? (
        <Card>
          <CardContent className="pt-5">
            <EmptyState
              title="No sections yet"
              hint="Add sections in Master Data first."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {years.length > 1 && (
            <div className="flex gap-1.5">
              <YearChip active={year === "all"} onClick={() => setYear("all")}>
                All years
              </YearChip>
              {years.map((y) => (
                <YearChip key={y} active={year === y} onClick={() => setYear(y)}>
                  Year {y}
                </YearChip>
              ))}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sections</CardTitle>
              <CardDescription>
                A section is ready to schedule once it has a home room, subjects, and a
                faculty member chosen for each.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {visible.map(({ section, subjectCount, assignedCount, weeklyHours, ready }) => (
                  <li key={section.id}>
                    <Link
                      to={`/curriculum/${section.id}`}
                      className="flex items-center justify-between gap-4 py-2.5 hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {section.branch?.code}-{section.name}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            Year {section.year}
                          </span>
                          {ready ? (
                            <Badge variant="success">Ready</Badge>
                          ) : subjectCount === 0 ? (
                            <Badge variant="outline">Not started</Badge>
                          ) : (
                            <Badge variant="warning">Incomplete</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {subjectCount} subject{subjectCount === 1 ? "" : "s"} ·{" "}
                          {assignedCount}/{subjectCount} assigned · {weeklyHours} hrs/week
                          {!section.homeRoomId && " · no home room"}
                        </div>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {workload.data && workload.data.faculty.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Faculty workload</CardTitle>
                <CardDescription>
                  Weekly hours from curriculum assignments across every year. This is a
                  guide, not a limit — 4 theory plus a 3-hour lab is perfectly valid.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="h-10 px-3 text-left font-medium text-muted-foreground">
                          Faculty
                        </th>
                        <th className="h-10 px-3 text-left font-medium text-muted-foreground w-28">
                          Hrs/week
                        </th>
                        <th className="h-10 px-3 text-left font-medium text-muted-foreground">
                          Teaching
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {workload.data.faculty.map(({ faculty, weeklyHours, assignments }) => (
                        <tr key={faculty.id} className="border-b hover:bg-muted/40">
                          <td className="px-3 py-2 font-medium">{faculty.name}</td>
                          <td className="px-3 py-2">
                            <span
                              className={
                                weeklyHours > WORKLOAD_WARN_HOURS
                                  ? "text-warning font-medium"
                                  : ""
                              }
                            >
                              {weeklyHours}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {assignments.length === 0 ? (
                              <span className="text-muted-foreground italic text-xs">
                                nothing assigned
                              </span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {assignments.map((a, i) => (
                                  <Badge key={i} variant="outline">
                                    {a.subject} · {a.section}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function YearChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors " +
        (active
          ? "bg-primary text-primary-foreground border-primary"
          : "text-muted-foreground hover:bg-muted")
      }
    >
      {children}
    </button>
  )
}
