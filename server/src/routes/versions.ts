import { Router } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { AppError, asyncHandler } from "../lib/errors.js"
import { copyEntries, ensureLiveVersion, summarise } from "../lib/versions.js"

export const versionsRouter = Router()

async function activeTerm() {
  const term = await prisma.academicTerm.findFirst({ where: { isActive: true } })
  if (!term) {
    throw new AppError(
      "No active academic term. Set one up in Term Setup first.",
      409
    )
  }
  return term
}

/* ------------------------------ Read state ------------------------------ */

/**
 * The state of play for the active term: what's live, whether a working copy
 * exists, and how the two differ in size.
 */
versionsRouter.get(
  "/timetable-versions",
  asyncHandler(async (_req, res) => {
    const term = await activeTerm()
    const live = await ensureLiveVersion(prisma, term.id)
    const working = await prisma.timetableVersion.findFirst({
      where: { termId: term.id, kind: "WORKING" },
    })

    res.json({
      term: { id: term.id, label: term.label },
      live: await summarise(await prisma.timetableVersion.findUniqueOrThrow({ where: { id: live.id } })),
      working: working ? await summarise(working) : null,
      // While a working copy exists the live timetable is locked. The UI shows
      // this; the server enforces it in assertEditable().
      liveLocked: Boolean(working),
    })
  })
)

versionsRouter.get(
  "/timetable-versions/history",
  asyncHandler(async (_req, res) => {
    const term = await activeTerm()
    const archived = await prisma.timetableVersion.findMany({
      where: { termId: term.id, kind: "ARCHIVED" },
      orderBy: { replacedAt: "desc" },
    })
    res.json(await Promise.all(archived.map(summarise)))
  })
)

/* --------------------------- Create working copy ------------------------- */

versionsRouter.post(
  "/timetable-versions/working",
  asyncHandler(async (req, res) => {
    const { note } = z
      .object({ note: z.string().trim().max(200).optional() })
      .parse(req.body ?? {})

    const term = await activeTerm()

    const existing = await prisma.timetableVersion.findFirst({
      where: { termId: term.id, kind: "WORKING" },
    })
    if (existing) {
      throw new AppError(
        "A working copy already exists. Publish or discard it before making another.",
        409
      )
    }

    const created = await prisma.$transaction(async (tx) => {
      const live = await ensureLiveVersion(tx, term.id)
      const working = await tx.timetableVersion.create({
        data: {
          termId: term.id,
          kind: "WORKING",
          label: "Working copy",
          note: note ?? null,
        },
      })
      const copied = await copyEntries(tx, term.id, live.id, working.id)
      return { working, copied }
    })

    res.status(201).json({
      ...(await summarise(created.working)),
      copiedFromLive: created.copied,
    })
  })
)

/* ------------------------------- Discard -------------------------------- */

/**
 * Throw the working copy away. The live timetable is untouched — that is the
 * whole point of it being separate rows.
 */
versionsRouter.delete(
  "/timetable-versions/working",
  asyncHandler(async (_req, res) => {
    const term = await activeTerm()
    const working = await prisma.timetableVersion.findFirst({
      where: { termId: term.id, kind: "WORKING" },
    })
    if (!working) throw new AppError("There is no working copy to discard.", 404)

    // Entries cascade with the version row.
    await prisma.timetableVersion.delete({ where: { id: working.id } })
    res.status(204).end()
  })
)

/* ------------------------------- Publish -------------------------------- */

/**
 * Working becomes live.
 *
 * The outgoing live version is kept as ARCHIVED rather than deleted, so last
 * week's timetable stays on record and can be looked at (or copied forward
 * again) later. Everything happens in one transaction: there is no instant
 * where the college has two live timetables or none.
 */
versionsRouter.post(
  "/timetable-versions/working/publish",
  asyncHandler(async (req, res) => {
    const { confirm, label } = z
      .object({
        // The client must say so explicitly — publishing changes what every
        // student and faculty member sees.
        confirm: z.literal(true, {
          error: "Publishing has to be confirmed.",
        }),
        label: z.string().trim().max(120).optional(),
      })
      .parse(req.body ?? {})

    if (!confirm) throw new AppError("Publishing has to be confirmed.", 400)

    const term = await activeTerm()
    const working = await prisma.timetableVersion.findFirst({
      where: { termId: term.id, kind: "WORKING" },
    })
    if (!working) {
      throw new AppError("There is no working copy to publish.", 404)
    }

    const now = new Date()

    const published = await prisma.$transaction(async (tx) => {
      const live = await ensureLiveVersion(tx, term.id)

      // Step the old live out of the way first: the partial unique index only
      // allows one LIVE row per term, so it has to stop being LIVE before the
      // working copy becomes it.
      await tx.timetableVersion.update({
        where: { id: live.id },
        data: {
          kind: "ARCHIVED",
          label: live.label === "Live timetable" ? previousLabel(now) : live.label,
          replacedAt: now,
        },
      })

      return tx.timetableVersion.update({
        where: { id: working.id },
        data: {
          kind: "LIVE",
          label: label?.length ? label : "Live timetable",
          publishedAt: now,
        },
      })
    })

    res.json({
      ...(await summarise(published)),
      message: "The working timetable is now live. Students and faculty see it immediately.",
    })
  })
)

function previousLabel(at: Date): string {
  return `Previous live timetable (until ${at.toISOString().slice(0, 10)})`
}
