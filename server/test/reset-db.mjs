/**
 * Delete EVERY row in the database.
 *
 * This exists to clean up after the integration scripts, which write real
 * data. It is destructive and irreversible, so it refuses to run unless you
 * explicitly opt in:
 *
 *   CONFIRM_WIPE=yes node test/reset-db.mjs
 *
 * Never point this at a database you care about. To clear a term through the
 * app instead, use Academic Year Reset — that keeps your master data and
 * archives the old term rather than destroying anything.
 */
import { PrismaClient } from "@prisma/client"

if (process.env.CONFIRM_WIPE !== "yes") {
  console.error("\n  Refusing to wipe the database.")
  console.error("  Re-run with CONFIRM_WIPE=yes if that is really what you want.\n")
  process.exit(1)
}

const prisma = new PrismaClient()

// Order matters: children before parents.
await prisma.timetableEntry.deleteMany()
await prisma.sectionAssignment.deleteMany()
await prisma.sectionSubject.deleteMany()
await prisma.facultySubject.deleteMany()
await prisma.section.deleteMany()
await prisma.subject.deleteMany()
await prisma.faculty.deleteMany()
await prisma.room.deleteMany()
await prisma.branch.deleteMany()
await prisma.department.deleteMany()
await prisma.timeConfig.deleteMany()
await prisma.academicTerm.deleteMany()

console.log("Database emptied:", {
  departments: await prisma.department.count(),
  faculty: await prisma.faculty.count(),
  terms: await prisma.academicTerm.count(),
  entries: await prisma.timetableEntry.count(),
})

await prisma.$disconnect()
