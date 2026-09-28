-- CreateEnum
CREATE TYPE "AiReviewRating" AS ENUM ('ACCURATE', 'PARTIALLY_ACCURATE', 'INACCURATE');

-- AlterTable
ALTER TABLE "review_rules" ADD COLUMN     "architectureNotes" TEXT,
ADD COLUMN     "conventions" TEXT,
ADD COLUMN     "excludePatterns" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "focusAreas" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "ai_review_feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "rating" "AiReviewRating" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_review_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_assessments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repositoryFullName" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "suggestedConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_review_feedback_reviewId_idx" ON "ai_review_feedback"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_review_feedback_userId_reviewId_key" ON "ai_review_feedback"("userId", "reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "repository_assessments_userId_repositoryFullName_key" ON "repository_assessments"("userId", "repositoryFullName");

-- AddForeignKey
ALTER TABLE "ai_review_feedback" ADD CONSTRAINT "ai_review_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_review_feedback" ADD CONSTRAINT "ai_review_feedback_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_assessments" ADD CONSTRAINT "repository_assessments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
