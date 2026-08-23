-- Merge Classes: remember each entry's room from before a merge moved it,
-- so Unmerge can restore it. Purely additive — nullable, no default, no
-- backfill — safe to apply before or after the code that reads/writes it
-- deploys.
ALTER TABLE "TimetableEntry" ADD COLUMN "preMergeRoomId" TEXT;
