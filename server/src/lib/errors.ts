import type { Request, Response, NextFunction } from "express"
import { ZodError } from "zod"

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public details?: unknown
  ) {
    super(message)
    this.name = "AppError"
  }
}

export const notFound = (what: string) => new AppError(`${what} not found`, 404)

/** Wrap async route handlers so thrown errors reach the error middleware. */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: T, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: "Validation failed",
      details: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    })
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, details: err.details })
  }

  // Prisma unique-constraint violation -> friendly message
  const e = err as { code?: string; meta?: { target?: string[] } }
  if (e?.code === "P2002") {
    const fields = e.meta?.target?.join(", ") ?? "field"
    return res.status(409).json({ error: `Duplicate value for ${fields}` })
  }
  // Foreign-key violations arrive either as Prisma's P2003 or, for RESTRICT
  // constraints, as a raw Postgres error (23001/23503) wrapped in a Prisma
  // "unknown request" error. Both mean the same thing to the user.
  const message = err instanceof Error ? err.message : ""
  const isFkViolation =
    e?.code === "P2003" ||
    message.includes("foreign key constraint") ||
    message.includes('code: "23001"') ||
    message.includes('code: "23503"')

  if (isFkViolation) {
    // Postgres says: on table "Department" violates ... constraint
    // "Branch_departmentId_fkey" on table "Branch". The LAST table named is
    // the one still holding references, which is what the user needs to know.
    const tables = [...message.matchAll(/on table \\?"(\w+)\\?"/g)].map((m) => m[1])
    const referencedBy = tables.length > 1 ? tables[tables.length - 1] : undefined
    return res.status(409).json({
      error: referencedBy
        ? `Cannot delete: still used by existing ${referencedBy} records. Remove those first.`
        : "Cannot delete: this record is still referenced by other data.",
    })
  }
  if (e?.code === "P2025") {
    return res.status(404).json({ error: "Record not found" })
  }

  console.error(err)
  return res.status(500).json({ error: "Internal server error" })
}

/**
 * Express 5 types route params as `string | string[]`. This narrows to a
 * plain string (and fails loudly rather than silently passing an array
 * into a database query).
 */
export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, unknown>)[name]
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError(`Missing route parameter "${name}"`, 400)
  }
  return value
}
