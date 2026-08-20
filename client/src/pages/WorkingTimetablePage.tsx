import * as React from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRight,
  CopyPlus,
  History,
  Lock,
  Radio,
  Rocket,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ErrorState, LoadingState } from "@/components/ui/feedback"
import { api } from "@/lib/api"
import { useTimetableVersion } from "@/context/TimetableVersion"
import type { VersionState, VersionSummary } from "@/lib/types"

/**
 * Preparing next week without disturbing this week.
 *
 * The live timetable is what students and faculty see. A working copy is a
 * separate set of rows that starts out identical and can be edited freely;
 * publishing swaps it in. Nothing here touches master data — one faculty
 * member, one room, one subject, whichever timetable is open.
 */
export function WorkingTimetablePage() {
  const qc = useQueryClient()
  const { refetch: refetchVersion } = useTimetableVersion()
  const [confirmText, setConfirmText] = React.useState("")
  const [note, setNote] = React.useState("")

  const state = useQuery({
    queryKey: ["timetable-versions"],
    queryFn: () => api.get<VersionState>("/timetable-versions"),
  })

  const history = useQuery({
    queryKey: ["timetable-versions", "history"],
    queryFn: () => api.get<VersionSummary[]>("/timetable-versions/history"),
  })

  const everything = () => {
    qc.invalidateQueries()
    refetchVersion()
  }

  const createCopy = useMutation({
    mutationFn: () =>
      api.post("/timetable-versions/working", note ? { note } : {}),
    onSuccess: () => {
      setNote("")
      everything()
    },
  })

  const discard = useMutation({
    mutationFn: () => api.del("/timetable-versions/working"),
    onSuccess: everything,
  })

  const publish = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>("/timetable-versions/working/publish", {
        confirm: true,
      }),
    onSuccess: () => {
      setConfirmText("")
      everything()
    },
  })

  if (state.isLoading) return <LoadingState />
  if (state.error) return <ErrorState error={state.error} />
  if (!state.data) return null

  const { live, working } = state.data
  const CONFIRM_WORD = "PUBLISH"
  const canPublish = confirmText.trim().toUpperCase() === CONFIRM_WORD

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Working Timetable</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Prepare next week's changes on a copy. The live timetable stays
          exactly as it is until you publish.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* ------------------------------ LIVE ------------------------------ */}
        <Card className="border-success/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="size-4 text-success" /> Live
              <Badge variant="success">In use</Badge>
            </CardTitle>
            <CardDescription>
              What students and faculty see right now, and what Class Adjustment
              reads.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Classes placed" value={live.entryCount} />
            <Row
              label="Published"
              value={live.publishedAt ? formatDate(live.publishedAt) : "—"}
            />
            {working && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground pt-2 border-t">
                <Lock className="size-3.5 mt-0.5 shrink-0" />
                Locked for editing while a working copy exists. This is what
                makes it impossible to change the live timetable by accident.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ---------------------------- WORKING ----------------------------- */}
        <Card className={working ? "border-warning/40" : undefined}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CopyPlus className="size-4 text-muted-foreground" /> Working copy
              {working && <Badge variant="warning">Editing</Badge>}
            </CardTitle>
            <CardDescription>
              {working
                ? "Edit this freely — nothing here reaches students until you publish."
                : "None yet. Make one to start preparing changes."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {createCopy.error ? <ErrorState error={createCopy.error} /> : null}
            {discard.error ? <ErrorState error={discard.error} /> : null}

            {working ? (
              <>
                <Row label="Classes placed" value={working.entryCount} />
                <Row label="Started" value={formatDate(working.createdAt)} />
                {working.note && <Row label="Note" value={working.note} />}

                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/admin">
                      Edit timetables <ArrowRight />
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={discard.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Discard the working copy and everything changed in it? The live timetable is not affected."
                        )
                      ) {
                        discard.mutate()
                      }
                    }}
                  >
                    <Trash2 /> Discard
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor="note">What are you changing? (optional)</Label>
                  <Input
                    id="note"
                    value={note}
                    placeholder="e.g. Swap CN lab to Thursday from 8 Sep"
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <Button
                  onClick={() => createCopy.mutate()}
                  disabled={createCopy.isPending}
                >
                  <CopyPlus />
                  {createCopy.isPending
                    ? "Copying…"
                    : `Create working copy (${live.entryCount} classes)`}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------ PUBLISH ------------------------------ */}
      {working && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Publish</CardTitle>
            <CardDescription>
              The working copy becomes the live timetable. Everyone sees the new
              one immediately, and the current live timetable is kept as history.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {publish.error ? <ErrorState error={publish.error} /> : null}
            {publish.isSuccess && (
              <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
                {publish.data.message}
              </div>
            )}

            <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
              <p className="font-medium">After publishing</p>
              <p className="text-muted-foreground">
                Live goes from {live.entryCount} classes to {working.entryCount}.
                Class Adjustment and the student view switch over at the same
                moment.
              </p>
            </div>

            <div>
              <Label htmlFor="confirm">
                Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to
                confirm
              </Label>
              <div className="flex gap-2">
                <Input
                  id="confirm"
                  value={confirmText}
                  placeholder={CONFIRM_WORD}
                  className="max-w-40"
                  onChange={(e) => setConfirmText(e.target.value)}
                />
                <Button
                  disabled={!canPublish || publish.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Publish the working timetable? Students and faculty will see it straight away."
                      )
                    ) {
                      publish.mutate()
                    }
                  }}
                >
                  <Rocket />
                  {publish.isPending ? "Publishing…" : "Publish to live"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------ HISTORY ------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="size-4" /> Previous timetables
          </CardTitle>
          <CardDescription>
            Each published version replaces one, and the one it replaced is kept.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.isLoading ? (
            <LoadingState />
          ) : !history.data?.length ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet — the first publish will start the history.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {history.data.map((v) => (
                <li key={v.id} className="flex items-center justify-between py-2">
                  <span>{v.label}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {v.entryCount} classes
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="flex items-start gap-2 text-xs text-muted-foreground mt-3 pt-3 border-t">
            <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
            Master data — faculty, rooms, subjects, sections, periods and days —
            is shared by every version. Editing a faculty member changes them
            everywhere, which is what you want.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString()
}
