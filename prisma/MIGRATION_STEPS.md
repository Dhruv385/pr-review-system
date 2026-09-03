# Step 1–3: Schema analysis & migration

## Step 1 — Analysis of existing schema

You need:
1. Two new 1:1 relations off `User` (`GithubAccount`, `GitlabAccount`) — a user connects at most one GitHub and one GitLab account. If you actually want to support multiple GitHub accounts per user later, drop the `@unique` on `GithubAccount.userId` / `GitlabAccount.userId` and adjust lookups from `findUnique` to `findFirst`/`findMany`.
2. `PullRequest` normalizes GitHub PRs and GitLab MRs into one table, scoped to `userId` directly (not through the provider account) so ownership checks stay a single `where: { id, userId }` — no join needed.
3. `Review` is scoped to its parent `PullRequest`, so ownership checks go through `pullRequest: { userId }`.
4. Composite unique constraints (`userId+platform+externalId` for PRs, `pullRequestId+externalId` for reviews) are what make `upsert` idempotent and prevent duplicates on repeated syncs.

## Step 2 — Schema

See `schema-additions.prisma` — copy the enums + 4 models into your existing `schema.prisma`, and add the three relation fields to your `User` model as noted in the comment block.

## Step 3 — Migration commands

```bash
# after merging schema-additions.prisma into schema.prisma
npx prisma format
npx prisma migrate dev --name add_pr_review_system

# generate client
npx prisma generate
```

If you're on a shared/staging DB and want to review SQL first:

```bash
npx prisma migrate dev --name add_pr_review_system --create-only
# inspect the generated SQL in prisma/migrations/*/migration.sql
npx prisma migrate dev
```

## Env vars needed

```bash
# .env
ENCRYPTION_KEY=<32-byte base64 key>   # generate: openssl rand -base64 32
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_OAUTH_CALLBACK_URL=https://your-api/auth/github/callback
GITLAB_CLIENT_ID=...
GITLAB_CLIENT_SECRET=...
GITLAB_OAUTH_CALLBACK_URL=https://your-api/auth/gitlab/callback
PR_SYNC_STALE_MINUTES=5
```
