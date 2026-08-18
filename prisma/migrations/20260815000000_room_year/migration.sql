-- Optional year a room is set aside for. NULL = available to any year,
-- which is what every existing room becomes.
ALTER TABLE "Room" ADD COLUMN "year" INTEGER;
