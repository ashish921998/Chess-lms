-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('COMMENT', 'FEATURE_REQUEST', 'BUG');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'DONE', 'WONTFIX');

-- CreateTable
CREATE TABLE "TutorFeedback" (
    "id" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "sectionTitle" TEXT NOT NULL,
    "kind" "FeedbackKind" NOT NULL DEFAULT 'COMMENT',
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "body" TEXT NOT NULL,
    "devNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "TutorFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TutorFeedback_sectionId_idx" ON "TutorFeedback"("sectionId");

-- CreateIndex
CREATE INDEX "TutorFeedback_status_idx" ON "TutorFeedback"("status");

-- AddForeignKey
ALTER TABLE "TutorFeedback" ADD CONSTRAINT "TutorFeedback_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
