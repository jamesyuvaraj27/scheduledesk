/**
 * Live vs Working timetables.
 *
 * The live timetable is the one students and faculty are following right now.
 * A working copy is a full, separate set of TimetableEntry rows — editing the
 * working copy cannot change the live one because they are *different rows*,
 * not different flags on the same row. Publishing swaps which set is LIVE.
 *
 * Master data (faculty, rooms, subjects, sections, periods, days) is shared:
 * versions only ever cover TimetableEntry.
 */

import type { Prisma, PrismaClient, VersionKind } from "@prisma/client"
import { prisma } from "./prisma.js"
import { AppError } from "./errors.js"

export type VersionSpec = "LIVE" | "WORKING" | (string & {})

/** Anything Prisma-shaped: the client itself or a transaction handle. */
type Db = PrismaClient | Prisma.TransactionClient

export interface ResolvedVersion {
  id: string
  kind: VersionKind
  label: string
  termId: string
  note: string | null
  createdAt: Date
  publishedAt: Date | null
  replacedAt: Date | null
}

/**
 * Every term has a LIVE version. Terms created before this feature existed
 * got one in the migration; terms created after get one here, so no code path
 * can produce a term whose timetable has nowhere to live.
 */
export async function ensureLiveVersion(
  db: Db,
  termId: string
): Promise<ResolvedVersion> {
  const existing = await db.timetableVersion.findFirst({
    where: { termId, kind: "LIVE" },
  })
  if (existing) return existing

  return db.timetableVersion.create({
    data: {
      termId,
      kind: "LIVE",
      label: "Live timetable",
      publishedAt: new Date(),
    },
  })
}

export async function getWorkingVersion(
  termId: string
): Promise<ResolvedVersion | null> {
  return prisma.timetableVersion.findFirst({
    where: { termId, kind: "WORKING" },
  })
}

/**
 * Turn whatever the client asked for into a concrete version row.
 *
 * `spec` comes from the `?version=` query param or the `X-Timetable-Version`
 * header. Unrecognised or missing means LIVE, which is the safe read default
 * — public pages never pass one at all.
 */
export async function resolveVersion(
  termId: string,
  spec: VersionSpec | undefined | null
): Promise<ResolvedVersion> {
  const wanted = (spec ?? "LIVE").trim()

  if (wanted.toUpperCase() === "LIVE" || wanted === "") {
    return ensureLiveVersion(prisma, termId)
  }

  if (wanted.toUpperCase() === "WORKING") {
    const working = await getWorkingVersion(termId)
    if (!working) {
      throw new AppError(
        "There is no working copy yet. Create one from the Working Timetable page first.",
        409
      )
    }
    return working
  }

  const byId = await prisma.timetableVersion.findUnique({ where: { id: wanted } })
  if (!byId || byId.termId !== termId) {
    throw new AppError("That timetable version doesn't belong to the active term.", 404)
  }
  return byId
}

/**
 * The hard safety rule.
 *
 * Once a working copy exists, the live timetable becomes read-only. There is
 * then no sequence of clicks — no stale tab, no forgotten toggle, no
 * hand-written request — that can edit the live timetable by accident: the
 * server refuses it outright until the working copy is published or discarded.
 *
 * Before any working copy is created the live timetable is still editable,
 * which is how a timetable gets built in the first place.
 */
export async function assertEditable(version: ResolvedVersion): Promise<void> {
  if (version.kind === "ARCHIVED") {
    throw new AppError(
      "This is an archived timetable kept as history. It can be viewed but not edited.",
      409
    )
  }

  if (version.kind === "LIVE") {
    const working = await getWorkingVersion(version.termId)
    if (working) {
      throw new AppError(
        "The live timetable is locked while a working copy exists. Edit the working copy, then publish it — or discard the working copy to edit live again.",
        409
      )
    }
  }
}

/** Read the requested version off a request, whichever way it was sent. */
export function versionSpecFromRequest(req: {
  query: Record<string, unknown>
  headers: Record<string, unknown>
}): VersionSpec | undefined {
  const fromQuery = req.query?.version
  if (typeof fromQuery === "string" && fromQuery.length) return fromQuery

  const fromHeader = req.headers?.["x-timetable-version"]
  if (typeof fromHeader === "string" && fromHeader.length) return fromHeader

  return undefined
}

/* ------------------------------------------------------------------------ */
/*                          Copy / publish / discard                        */
/* ------------------------------------------------------------------------ */

/**
 * Duplicate every entry of `sourceVersionId` into `targetVersionId`.
 * Rows are copied field for field — same day, period, span, subject, faculty
 * and room — so a fresh working copy is indistinguishable from live until
 * somebody edits it.
 */
export async function copyEntries(
  db: Db,
  termId: string,
  sourceVersionId: string,
  targetVersionId: string
): Promise<number> {
  const source = await db.timetableEntry.findMany({
    where: { versionId: sourceVersionId },
  })
  if (!source.length) return 0

  const result = await db.timetableEntry.createMany({
    data: source.map((e) => ({
      termId,
      versionId: targetVersionId,
      sectionId: e.sectionId,
      dayOfWeek: e.dayOfWeek,
      startPeriod: e.startPeriod,
      periodSpan: e.periodSpan,
      entryType: e.entryType,
      subjectId: e.subjectId,
      facultyId: e.facultyId,
      roomId: e.roomId,
    })),
  })
  return result.count
}

export interface VersionSummary {
  id: string
  kind: VersionKind
  label: string
  note: string | null
  createdAt: Date
  publishedAt: Date | null
  entryCount: number
}

export async function summarise(
  version: { id: string; kind: VersionKind; label: string; note: string | null; createdAt: Date; publishedAt: Date | null }
): Promise<VersionSummary> {
  const entryCount = await prisma.timetableEntry.count({
    where: { versionId: version.id },
  })
  return { ...version, entryCount }
}
