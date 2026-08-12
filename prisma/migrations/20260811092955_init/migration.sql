-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('CLASSROOM', 'LAB', 'LIBRARY', 'SEMINAR_HALL');

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('THEORY', 'LAB');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('THEORY', 'LAB', 'LIBRARY', 'SEMINAR', 'COUNSELING');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT');

-- CreateTable
CREATE TABLE "AcademicTerm" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "semester" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeConfig" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "numPeriods" INTEGER NOT NULL DEFAULT 7,
    "periodDurationMin" INTEGER NOT NULL DEFAULT 50,
    "breakAfterPeriod" INTEGER NOT NULL DEFAULT 2,
    "breakDurationMin" INTEGER NOT NULL DEFAULT 15,
    "lunchAfterPeriod" INTEGER NOT NULL DEFAULT 5,
    "lunchDurationMin" INTEGER NOT NULL DEFAULT 60,
    "workingDays" TEXT[] DEFAULT ARRAY['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']::TEXT[],

    CONSTRAINT "TimeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "homeRoomId" TEXT,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "RoomType" NOT NULL,
    "capacity" INTEGER,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faculty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Faculty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "SubjectType" NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultySubject" (
    "facultyId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,

    CONSTRAINT "FacultySubject_pkey" PRIMARY KEY ("facultyId","subjectId")
);

-- CreateTable
CREATE TABLE "SectionSubject" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "weeklyTheoryHrs" INTEGER NOT NULL DEFAULT 0,
    "weeklyLabHrs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SectionSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionAssignment" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,

    CONSTRAINT "SectionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableEntry" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "startPeriod" INTEGER NOT NULL,
    "periodSpan" INTEGER NOT NULL DEFAULT 1,
    "entryType" "EntryType" NOT NULL,
    "subjectId" TEXT,
    "facultyId" TEXT,
    "roomId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimetableEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcademicTerm_isActive_idx" ON "AcademicTerm"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TimeConfig_termId_key" ON "TimeConfig"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_departmentId_code_key" ON "Branch"("departmentId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Section_branchId_year_name_key" ON "Section"("branchId", "year", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Room_name_key" ON "Room"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_branchId_code_key" ON "Subject"("branchId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SectionSubject_termId_sectionId_subjectId_key" ON "SectionSubject"("termId", "sectionId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "SectionAssignment_termId_sectionId_subjectId_key" ON "SectionAssignment"("termId", "sectionId", "subjectId");

-- CreateIndex
CREATE INDEX "TimetableEntry_termId_sectionId_dayOfWeek_idx" ON "TimetableEntry"("termId", "sectionId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "TimetableEntry_termId_facultyId_dayOfWeek_idx" ON "TimetableEntry"("termId", "facultyId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "TimetableEntry_termId_roomId_dayOfWeek_idx" ON "TimetableEntry"("termId", "roomId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "TimeConfig" ADD CONSTRAINT "TimeConfig_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_homeRoomId_fkey" FOREIGN KEY ("homeRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Faculty" ADD CONSTRAINT "Faculty_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultySubject" ADD CONSTRAINT "FacultySubject_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultySubject" ADD CONSTRAINT "FacultySubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionSubject" ADD CONSTRAINT "SectionSubject_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionSubject" ADD CONSTRAINT "SectionSubject_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionSubject" ADD CONSTRAINT "SectionSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAssignment" ADD CONSTRAINT "SectionAssignment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAssignment" ADD CONSTRAINT "SectionAssignment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAssignment" ADD CONSTRAINT "SectionAssignment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAssignment" ADD CONSTRAINT "SectionAssignment_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
