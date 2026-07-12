-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('PENDING', 'SOLVED', 'FAILED', 'SKIPPED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "CoinReason" AS ENUM ('SOLVE', 'SOLVE_HINTED', 'GOAL_BONUS', 'STREAK_BONUS', 'PURCHASE_HINT', 'PURCHASE_SKIP');

-- CreateEnum
CREATE TYPE "RatingOutcome" AS ENUM ('SOLVED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'STUDENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tutor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tutor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lichessPuzzleRating" INTEGER,
    "lichessGameRating" INTEGER,
    "inAppRating" INTEGER NOT NULL DEFAULT 1500,
    "ratingK" INTEGER NOT NULL DEFAULT 40,
    "coinBalance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeCoins" INTEGER NOT NULL DEFAULT 0,
    "dailyGoal" INTEGER NOT NULL DEFAULT 5,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LichessConnection" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lichessId" TEXT NOT NULL,
    "lichessUsername" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "LichessConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Puzzle" (
    "id" TEXT NOT NULL,
    "startFen" TEXT NOT NULL,
    "solutionMoves" TEXT[],
    "rating" INTEGER NOT NULL,
    "ratingDev" INTEGER NOT NULL DEFAULT 80,
    "themes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "openingTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Puzzle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentPuzzle" (
    "studentId" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "timesSeen" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "StudentPuzzle_pkey" PRIMARY KEY ("studentId","puzzleId")
);

-- CreateTable
CREATE TABLE "PuzzleSet" (
    "id" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PuzzleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PuzzleSetItem" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "PuzzleSetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PuzzleSetVersion" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PuzzleSetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PuzzleSetVersionItem" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "PuzzleSetVersionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentItemProgress" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "solved" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "firstSolvedAt" TIMESTAMP(3),

    CONSTRAINT "AssignmentItemProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "assignmentItemId" TEXT,
    "status" "AttemptStatus" NOT NULL DEFAULT 'PENDING',
    "moveIndex" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "solved" BOOLEAN NOT NULL DEFAULT false,
    "usedHint" BOOLEAN NOT NULL DEFAULT false,
    "hintMove" TEXT,
    "usedSkip" BOOLEAN NOT NULL DEFAULT false,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "isReplay" BOOLEAN NOT NULL DEFAULT false,
    "coinsAwarded" INTEGER NOT NULL DEFAULT 0,
    "timeSpentMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyProgress" (
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "solvedCount" INTEGER NOT NULL DEFAULT 0,
    "goalMet" BOOLEAN NOT NULL DEFAULT false,
    "goalBonusAwarded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DailyProgress_pkey" PRIMARY KEY ("studentId","date")
);

-- CreateTable
CREATE TABLE "CoinTransaction" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "CoinReason" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentBadge" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "badgeKey" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatingEvent" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "outcome" "RatingOutcome" NOT NULL,
    "delta" INTEGER NOT NULL,
    "attemptId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Tutor_userId_key" ON "Tutor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LichessConnection_studentId_key" ON "LichessConnection"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "LichessConnection_lichessId_key" ON "LichessConnection"("lichessId");

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");

-- CreateIndex
CREATE INDEX "Puzzle_rating_idx" ON "Puzzle"("rating");

-- CreateIndex
CREATE INDEX "Puzzle_popularity_idx" ON "Puzzle"("popularity");

-- CreateIndex
CREATE INDEX "StudentPuzzle_studentId_lastSeenAt_idx" ON "StudentPuzzle"("studentId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "PuzzleSet_tutorId_idx" ON "PuzzleSet"("tutorId");

-- CreateIndex
CREATE INDEX "PuzzleSetItem_setId_idx" ON "PuzzleSetItem"("setId");

-- CreateIndex
CREATE UNIQUE INDEX "PuzzleSetItem_setId_order_key" ON "PuzzleSetItem"("setId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PuzzleSetVersion_setId_version_key" ON "PuzzleSetVersion"("setId", "version");

-- CreateIndex
CREATE INDEX "PuzzleSetVersionItem_versionId_idx" ON "PuzzleSetVersionItem"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "PuzzleSetVersionItem_versionId_order_key" ON "PuzzleSetVersionItem"("versionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "PuzzleSetVersionItem_versionId_puzzleId_key" ON "PuzzleSetVersionItem"("versionId", "puzzleId");

-- CreateIndex
CREATE INDEX "Assignment_studentId_idx" ON "Assignment"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_versionId_studentId_key" ON "Assignment"("versionId", "studentId");

-- CreateIndex
CREATE INDEX "AssignmentItemProgress_assignmentId_idx" ON "AssignmentItemProgress"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentItemProgress_assignmentId_puzzleId_key" ON "AssignmentItemProgress"("assignmentId", "puzzleId");

-- CreateIndex
CREATE INDEX "Attempt_studentId_createdAt_idx" ON "Attempt"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "Attempt_puzzleId_idx" ON "Attempt"("puzzleId");

-- CreateIndex
CREATE INDEX "Attempt_assignmentId_idx" ON "Attempt"("assignmentId");

-- CreateIndex
CREATE INDEX "Attempt_status_idx" ON "Attempt"("status");

-- CreateIndex
CREATE INDEX "DailyProgress_date_idx" ON "DailyProgress"("date");

-- CreateIndex
CREATE UNIQUE INDEX "CoinTransaction_idempotencyKey_key" ON "CoinTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CoinTransaction_studentId_createdAt_idx" ON "CoinTransaction"("studentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudentBadge_studentId_badgeKey_key" ON "StudentBadge"("studentId", "badgeKey");

-- CreateIndex
CREATE UNIQUE INDEX "RatingEvent_attemptId_key" ON "RatingEvent"("attemptId");

-- CreateIndex
CREATE INDEX "RatingEvent_studentId_createdAt_idx" ON "RatingEvent"("studentId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tutor" ADD CONSTRAINT "Tutor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LichessConnection" ADD CONSTRAINT "LichessConnection_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteCode" ADD CONSTRAINT "InviteCode_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPuzzle" ADD CONSTRAINT "StudentPuzzle_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPuzzle" ADD CONSTRAINT "StudentPuzzle_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleSet" ADD CONSTRAINT "PuzzleSet_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleSetItem" ADD CONSTRAINT "PuzzleSetItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "PuzzleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleSetItem" ADD CONSTRAINT "PuzzleSetItem_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleSetVersion" ADD CONSTRAINT "PuzzleSetVersion_setId_fkey" FOREIGN KEY ("setId") REFERENCES "PuzzleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleSetVersionItem" ADD CONSTRAINT "PuzzleSetVersionItem_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PuzzleSetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleSetVersionItem" ADD CONSTRAINT "PuzzleSetVersionItem_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PuzzleSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentItemProgress" ADD CONSTRAINT "AssignmentItemProgress_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentItemProgress" ADD CONSTRAINT "AssignmentItemProgress_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyProgress" ADD CONSTRAINT "DailyProgress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentBadge" ADD CONSTRAINT "StudentBadge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingEvent" ADD CONSTRAINT "RatingEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingEvent" ADD CONSTRAINT "RatingEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
