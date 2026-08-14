-- Split period durations into morning / afternoon.
-- Existing rows keep their old single duration for BOTH halves, so nothing
-- about an already-built timetable shifts until the admin edits the term.
ALTER TABLE "TimeConfig" ADD COLUMN "morningPeriodDurationMin" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "TimeConfig" ADD COLUMN "afternoonPeriodDurationMin" INTEGER NOT NULL DEFAULT 50;
UPDATE "TimeConfig"
  SET "morningPeriodDurationMin" = "periodDurationMin",
      "afternoonPeriodDurationMin" = "periodDurationMin";
ALTER TABLE "TimeConfig" DROP COLUMN "periodDurationMin";

-- Room block / floor
CREATE TYPE "Block" AS ENUM ('A', 'L', 'V');
CREATE TYPE "Floor" AS ENUM ('GF', 'FF', 'SF', 'TF', 'LF');
ALTER TABLE "Room" ADD COLUMN "block" "Block";
ALTER TABLE "Room" ADD COLUMN "floor" "Floor";
CREATE INDEX "Room_block_floor_idx" ON "Room"("block", "floor");

-- Deleting a Subject must clear everything that referenced it, rather than
-- being blocked by RESTRICT and leaving the admin stuck.
ALTER TABLE "FacultySubject" DROP CONSTRAINT "FacultySubject_subjectId_fkey";
ALTER TABLE "FacultySubject" ADD CONSTRAINT "FacultySubject_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FacultySubject" DROP CONSTRAINT "FacultySubject_facultyId_fkey";
ALTER TABLE "FacultySubject" ADD CONSTRAINT "FacultySubject_facultyId_fkey"
  FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SectionSubject" DROP CONSTRAINT "SectionSubject_subjectId_fkey";
ALTER TABLE "SectionSubject" ADD CONSTRAINT "SectionSubject_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SectionAssignment" DROP CONSTRAINT "SectionAssignment_subjectId_fkey";
ALTER TABLE "SectionAssignment" ADD CONSTRAINT "SectionAssignment_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimetableEntry" DROP CONSTRAINT "TimetableEntry_subjectId_fkey";
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
