-- DropIndex
DROP INDEX "review_rules_userId_repositoryFullName_idx";

-- AlterTable
ALTER TABLE "review_rules" DROP COLUMN "pattern",
DROP COLUMN "source",
DROP COLUMN "text",
ADD COLUMN     "rules" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "review_rules_userId_repositoryFullName_key" ON "review_rules"("userId", "repositoryFullName");
