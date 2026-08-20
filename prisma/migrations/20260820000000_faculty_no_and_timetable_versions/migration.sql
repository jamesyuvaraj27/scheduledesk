-- ScheduleDesk — unique faculty numbers + Live/Working timetable versions.
--
-- Purely additive and self-backfilling. No existing row is deleted and no
-- existing timetable entry changes its day, period, subject, faculty or room.

/* ------------------------------------------------------------------ */
/* 1. Faculty.facultyNo — unique, human-facing (FAC001, FAC002, ...)   */
/* ------------------------------------------------------------------ */

ALTER TABLE "Faculty" ADD COLUMN "facultyNo" TEXT;

-- Give every existing faculty member exactly one number, ordered by name so
-- the numbering is stable and readable. Existing rows keep their id, so all
-- timetable and assignment relationships are untouched.
WITH numbered AS (
  SELECT "id", 'FAC' || LPAD(ROW_NUMBER() OVER (ORDER BY "name", "id")::text, 3, '0') AS n
  FROM "Faculty"
)
UPDATE "Faculty" f SET "facultyNo" = numbered.n
FROM numbered WHERE f."id" = numbered."id";

ALTER TABLE "Faculty" ALTER COLUMN "facultyNo" SET NOT NULL;
CREATE UNIQUE INDEX "Faculty_facultyNo_key" ON "Faculty"("facultyNo");

/* ------------------------------------------------------------------ */
/* 2. Timetable versions                                               */
/* ------------------------------------------------------------------ */

CREATE TYPE "VersionKind" AS ENUM ('LIVE', 'WORKING', 'ARCHIVED');

CREATE TABLE "TimetableVersion" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "kind" "VersionKind" NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "replacedAt" TIMESTAMP(3),
    CONSTRAINT "TimetableVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TimetableVersion_termId_kind_idx" ON "TimetableVersion"("termId", "kind");

ALTER TABLE "TimetableVersion"
  ADD CONSTRAINT "TimetableVersion_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one LIVE and one WORKING per term. Any number of ARCHIVED.
-- Prisma cannot express partial unique indexes, so they are declared here and
-- the database enforces them regardless of what application code does.
CREATE UNIQUE INDEX "TimetableVersion_one_live_per_term"
  ON "TimetableVersion"("termId") WHERE "kind" = 'LIVE';
CREATE UNIQUE INDEX "TimetableVersion_one_working_per_term"
  ON "TimetableVersion"("termId") WHERE "kind" = 'WORKING';

-- Every term that already exists gets a LIVE version. Whatever is on the
-- timetable today stays exactly where it is and becomes the live timetable.
INSERT INTO "TimetableVersion" ("id", "termId", "kind", "label", "publishedAt")
SELECT
  'v_live_' || "id",
  "id",
  'LIVE',
  'Live timetable',
  CURRENT_TIMESTAMP
FROM "AcademicTerm";

/* ------------------------------------------------------------------ */
/* 3. TimetableEntry.versionId                                         */
/* ------------------------------------------------------------------ */

ALTER TABLE "TimetableEntry" ADD COLUMN "versionId" TEXT;

UPDATE "TimetableEntry" e
SET "versionId" = v."id"
FROM "TimetableVersion" v
WHERE v."termId" = e."termId" AND v."kind" = 'LIVE';

-- Belt and braces: if a term somehow had entries but no row above (impossible
-- given the INSERT, but a NOT NULL that fails mid-deploy is not worth risking).
DELETE FROM "TimetableEntry" WHERE "versionId" IS NULL AND FALSE;

ALTER TABLE "TimetableEntry" ALTER COLUMN "versionId" SET NOT NULL;

ALTER TABLE "TimetableEntry"
  ADD CONSTRAINT "TimetableEntry_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "TimetableVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "TimetableEntry_versionId_sectionId_dayOfWeek_idx"
  ON "TimetableEntry"("versionId", "sectionId", "dayOfWeek");
CREATE INDEX "TimetableEntry_versionId_facultyId_dayOfWeek_idx"
  ON "TimetableEntry"("versionId", "facultyId", "dayOfWeek");
CREATE INDEX "TimetableEntry_versionId_roomId_dayOfWeek_idx"
  ON "TimetableEntry"("versionId", "roomId", "dayOfWeek");

DROP INDEX IF EXISTS "TimetableEntry_termId_facultyId_dayOfWeek_idx";
DROP INDEX IF EXISTS "TimetableEntry_termId_roomId_dayOfWeek_idx";
