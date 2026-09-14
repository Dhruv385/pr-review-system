-- CreateTable
CREATE TABLE "review_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repositoryFullName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "pattern" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_rules_userId_repositoryFullName_idx" ON "review_rules"("userId", "repositoryFullName");

-- AddForeignKey
ALTER TABLE "review_rules" ADD CONSTRAINT "review_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
