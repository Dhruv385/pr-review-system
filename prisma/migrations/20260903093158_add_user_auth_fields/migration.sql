-- Remove pre-auth test/demo rows (created before email/password were
-- required) so the new NOT NULL constraints below can be applied. Confirmed
-- via manual inspection: the only such row is the throwaway "demo-user-id"
-- test user created while debugging the OAuth connect flow, with everything
-- it cascades to (its github_accounts row, synced pull_requests, reviews).
DELETE FROM "User" WHERE "email" IS NULL;

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "passwordHash" TEXT NOT NULL,
  ADD COLUMN "platform" "Platform" NOT NULL,
  ADD COLUMN "platformUsername" TEXT NOT NULL,
  ALTER COLUMN "email" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_platform_platformUsername_key" ON "User"("platform", "platformUsername");
