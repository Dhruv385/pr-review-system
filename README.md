# PR / MR Review Management System

Full implementation per your spec: OAuth-connected GitHub/GitLab accounts,
polling-based sync (no webhooks) triggered on GET requests, normalized
`PullRequest`/`Review` models, and strict per-user ownership on every query.

## Install

```bash
npm install @nestjs/axios axios ioredis @nestjs-modules/ioredis class-transformer class-validator
```

(`@prisma/client` and `class-validator`/`class-transformer` are likely already in your project.)

## File map

```
prisma/
  schema-additions.prisma   # Step 2 — merge into your schema.prisma
  MIGRATION_STEPS.md        # Steps 1 & 3 — analysis + migration commands

src/
  common/
    decorators/current-user.decorator.ts   # stub — delete if you already have one
    exceptions/provider.exceptions.ts       # maps GitHub/GitLab errors -> Nest exceptions
    interfaces/pr-review.interfaces.ts      # IUser stub + normalized DTOs
    services/crypto.service.ts              # AES-256-GCM token encryption
    services/sync-coordinator.service.ts    # the 5-minute staleness gate
    utils/concurrency.util.ts               # bounded-concurrency helper
    sync.module.ts

  github/
    github-api.client.ts     # raw GitHub REST calls + pagination
    github-auth.service.ts   # OAuth exchange + account storage
    github.service.ts        # fetch -> normalize -> upsert
    github.module.ts

  gitlab/                    # mirrors github/ (approvals + notes -> Review)

  accounts/
    accounts.controller.ts   # /accounts/{github,gitlab}/connect + /callback
    oauth-state.service.ts   # CSRF-safe state <-> userId mapping (Redis)
    accounts.module.ts

  pull-requests/
    pull-requests.controller.ts   # GET /pull-requests, /:id, /:id/reviews
    pull-requests.service.ts
    dto/

  reviews/
    reviews.controller.ts     # GET /reviews, /:reviewId/pull-request
    reviews.service.ts
    dto/

  app.module.snippet.ts       # imports to merge into your AppModule
```

## Step 11 — Ownership model (how "User A can never see User B's data" is enforced)

Every query that touches `PullRequest` or `Review` filters by the
authenticated user, never by a client-supplied id alone:

```typescript
// PullRequest — direct ownership
where: { id: pullRequestId, userId: currentUser.id }

// Review — ownership via the parent PullRequest relation
where: { id: reviewId, pullRequest: { userId: currentUser.id } }
```

`pullRequestId`/`reviewId` are looked up **and** ownership-checked in the
same query — there's no separate "does this exist" check followed by an
"is it mine" check, which avoids a timing gap and a class of bugs where the
second check gets forgotten. A row that exists but belongs to someone else
returns exactly the same `404 NotFoundException` as a row that doesn't
exist at all, so ownership can't be probed by comparing 403 vs 404
responses.

The one thing this pattern does NOT protect by itself: the JWT guard must
actually run on every route (`@UseGuards(JwtAuthGuard)` on each controller)
and `currentUser.id` must come from the verified JWT payload, never from a
header, query param, or body field the client controls.

## Step 13 — How OAuth tokens are stored securely

1. **Never touch the user's provider password.** OAuth exchanges a
   short-lived `code` (from the redirect) for an access token server-side,
   using your app's `client_secret` — the user's GitHub/GitLab credentials
   never pass through your backend.
2. **Encrypt at rest.** `CryptoService` uses AES-256-GCM with a 256-bit key
   from `ENCRYPTION_KEY` (never commit this — inject via your secrets
   manager in production). GCM's auth tag means a tampered ciphertext fails
   to decrypt rather than silently returning garbage.
3. **Decrypt only in memory, only when needed** — `getDecryptedToken()` is
   called right before an outbound API request and the plaintext token is
   never logged, returned in an API response, or persisted anywhere else.
4. **Key rotation**: if you rotate `ENCRYPTION_KEY`, existing rows won't
   decrypt with the new key. Either keep the old key available for a
   rolling re-encryption migration, or (simpler at this scale) ask
   affected users to reconnect — `tokenRevoked` + the `401` handling in
   `provider.exceptions.ts` already prompts that flow.
5. **Revocation**: on a `401` from either provider, mark `tokenRevoked =
   true` (wire this into `mapProviderError`'s caller if you want it fully
   automatic) so sync stops silently retrying a dead token and the user is
   prompted to reconnect.

## Step 12 — API examples

```http
GET /pull-requests
Authorization: Bearer <jwt>

200 OK
{
  "pullRequests": [
    { "id": "cln1...", "externalId": "...", "platform": "GITHUB", "number": 25,
      "title": "Add GitHub OAuth Integration", "repository": "Dhruv385/Scheduling",
      "status": "OPEN", "reviewCount": 2 }
  ]
}
```

```http
GET /pull-requests/cln1.../reviews
Authorization: Bearer <jwt>

200 OK
{
  "pullRequest": { "id": "cln1...", "platform": "GITHUB", "title": "Add GitHub OAuth Integration" },
  "reviews": [
    { "id": "rev1...", "reviewer": "john", "state": "APPROVED", "comment": "Looks good!" }
  ]
}
```

```http
GET /reviews?platform=GITHUB
Authorization: Bearer <jwt>

200 OK
{ "reviews": [{ "id": "rev1...", "reviewer": "john", "state": "APPROVED",
                "comment": "Looks good!", "pullRequestId": "cln1..." }] }
```

```http
GET /reviews/rev1.../pull-request
Authorization: Bearer <jwt>

404 Not Found          <-- if rev1... belongs to another user, or doesn't exist
200 OK
{ "id": "cln1...", "platform": "GITHUB", "number": 25,
  "title": "Add GitHub OAuth Integration", "repository": "Dhruv385/Scheduling", "status": "OPEN" }
```

```http
GET /accounts/github/connect
Authorization: Bearer <jwt>
--> 302 redirect to GitHub's OAuth consent screen

GET /accounts/github/callback?code=...&state=...   (hit by the browser, no JWT)
200 OK
{ "connected": true, "provider": "GITHUB", "username": "octocat" }
```

## Error handling reference

| Condition                              | Exception                    |
|-----------------------------------------|-------------------------------|
| Missing/invalid JWT                     | `401 Unauthorized` (your existing guard) |
| GitHub/GitLab token expired or revoked  | `401 Unauthorized`            |
| Repo/project access removed             | `403 Forbidden`               |
| PR/MR or review not found, or not owned by caller | `404 Not Found`      |
| Malformed OAuth code / bad request body | `400 Bad Request`             |
| GitHub/GitLab rate limit hit            | `503 Service Unavailable`     |
| GitHub/GitLab outage                    | `503 Service Unavailable`     |

## Things to adapt before running

- `@/database/prisma.service`, `@/auth/jwt-auth.guard`, and
  `@/common/decorators/current-user.decorator` are referenced at the paths
  your conventions use — delete the stub decorator/IUser and point imports
  at your real ones.
- `@InjectRedis()` from `@nestjs-modules/ioredis` is used for OAuth state —
  swap for however your project already injects Redis.
- `GitlabApiClient` targets `gitlab.com`; if you're on a self-managed
  instance, make the base URL configurable via env var.
- Approvals is a GitLab feature that isn't available on every plan/instance
  — `getApprovals()` degrades to an empty array rather than failing the
  whole sync when it 404s/403s.
# pr-review-system
