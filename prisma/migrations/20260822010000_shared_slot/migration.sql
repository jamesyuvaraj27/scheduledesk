-- Deliberately-shared timetable slots (combined sections / shared rooms).
--
-- Nullable, so every existing row keeps NULL and every existing clash rule
-- behaves exactly as before. Entries carrying the same non-null value are
-- known to share a day/period on purpose.
ALTER TABLE "TimetableEntry" ADD COLUMN "sharedSlotId" TEXT;

-- CreateIndex
CREATE INDEX "TimetableEntry_sharedSlotId_idx" ON "TimetableEntry"("sharedSlotId");
