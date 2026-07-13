/*
  Warnings:

  - Added the required column `mode` to the `PuzzleSetVersion` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SetMode" AS ENUM ('MANUAL', 'FILTER');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "targetCount" INTEGER;

-- AlterTable
ALTER TABLE "PuzzleSet" ADD COLUMN     "filterRatingMax" INTEGER,
ADD COLUMN     "filterRatingMin" INTEGER,
ADD COLUMN     "filterThemes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mode" "SetMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "targetCount" INTEGER;

-- AlterTable
ALTER TABLE "PuzzleSetVersion" ADD COLUMN     "filterRatingMax" INTEGER,
ADD COLUMN     "filterRatingMin" INTEGER,
ADD COLUMN     "filterThemes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mode" "SetMode" NOT NULL,
ADD COLUMN     "targetCount" INTEGER;
