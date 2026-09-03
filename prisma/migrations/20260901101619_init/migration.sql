-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('GITHUB', 'GITLAB');

-- CreateEnum
CREATE TYPE "PullRequestStatus" AS ENUM ('OPEN', 'CLOSED', 'MERGED');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'PENDING', 'DISMISSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "githubId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "tokenRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "github_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gitlab_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gitlabId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "tokenRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gitlab_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pull_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "repositoryId" TEXT NOT NULL,
    "repositoryName" TEXT NOT NULL,
    "repositoryFullName" TEXT NOT NULL,
    "status" "PullRequestStatus" NOT NULL,
    "authorName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "reviewerAvatarUrl" TEXT,
    "state" "ReviewState" NOT NULL,
    "comment" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "github_accounts_userId_key" ON "github_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "github_accounts_githubId_key" ON "github_accounts"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "gitlab_accounts_userId_key" ON "gitlab_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "gitlab_accounts_gitlabId_key" ON "gitlab_accounts"("gitlabId");

-- CreateIndex
CREATE INDEX "pull_requests_userId_idx" ON "pull_requests"("userId");

-- CreateIndex
CREATE INDEX "pull_requests_userId_platform_idx" ON "pull_requests"("userId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_userId_platform_externalId_key" ON "pull_requests"("userId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "reviews_pullRequestId_idx" ON "reviews"("pullRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_pullRequestId_externalId_key" ON "reviews"("pullRequestId", "externalId");

-- AddForeignKey
ALTER TABLE "github_accounts" ADD CONSTRAINT "github_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gitlab_accounts" ADD CONSTRAINT "gitlab_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
