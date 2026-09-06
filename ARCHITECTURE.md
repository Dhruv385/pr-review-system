# Architecture

A **modular monolith**: one deployable NestJS application, internally split into
self-contained feature modules with explicit boundaries — no shared mutable
state between modules, no direct cross-module repository access, dependencies
only flow through each module's exported providers.

```
                        ┌─────────────────────────┐
                        │        AppModule         │
                        └────────────┬─────────────┘
        ┌───────────┬────────────┬───┴────────┬─────────────┬────────────┐
        ▼           ▼            ▼            ▼             ▼            ▼
  AuthModule  AccountsModule  GithubModule  GitlabModule  SyncModule  PullRequestsModule
   (global)      (OAuth          (API           (API      (staleness     ├─ ReviewsModule
                 linking)       client +       client +     gate that   └─ AiReviewModule
                              persistence)   persistence)  triggers sync)
```

Every feature module owns one directory (`src/<feature>/`) containing its
controller, service(s), DTOs, and module file. Cross-cutting infrastructure —
the database connection, encryption — lives in shared modules instead of
being re-declared per feature:

- **`DatabaseModule`** — the single `PrismaService` instance/connection pool,
  imported by every module that needs the database (not re-instantiated per
  module — this used to be duplicated in `GithubModule`/`GitlabModule` and
  was consolidated as part of this pass).
- **`CommonModule`** — shared stateless services (`CryptoService` for
  at-rest token encryption).
- **`AuthModule`** — the only `@Global()` module. `JwtAuthGuard` is referenced
  via `@UseGuards(JwtAuthGuard)` from nearly every controller, so its
  dependency (`JwtService`) must be resolvable everywhere without every
  consumer explicitly importing `AuthModule`.

## Request flow

Every request follows the same layering, enforced by convention:

```
route (@Controller) → service (business logic) → Prisma (data access) → Postgres
                    ↘ external API client (GithubApiClient / GitlabApiClient) → GitHub / GitLab
```

Controllers never touch Prisma directly and never call a sibling module's
service without going through that module's exported public API. A
controller's only job is: validate input (DTOs + global `ValidationPipe`),
delegate to a service, shape the response.

## Cross-module dependencies (by design, not incidental)

- `PullRequestsModule` depends on `SyncModule` (to trigger a sync-if-stale
  before returning data) and `AiReviewModule` (to post an AI review).
- `SyncModule` depends on `GithubModule` + `GitlabModule` (the two things it
  coordinates syncing between) but knows nothing about HTTP routes.
- `AiReviewModule` depends on `GithubModule` for the API client + stored
  token — it has no idea `PullRequestsController` exists.
- `ReviewsModule` and `PullRequestsModule` depend on each other
  (`forwardRef`) since a PR's reviews and a review's PR are two sides of the
  same relationship — this is the one deliberate exception to strict
  one-directional dependencies.

## Cross-cutting concerns (apply globally, not per-module)

- **Error handling** — `AllExceptionsFilter` (`src/common/filters/`) catches
  everything (HTTP exceptions, Prisma errors, unknown errors) and normalizes
  every error response to `{ statusCode, error, message, timestamp, path }`.
  No endpoint hand-rolls its own error shape or leaks a raw stack trace.
- **Observability** — `LoggingInterceptor` (`src/common/interceptors/`) emits
  one structured JSON log line per request: `requestId`, `userId` (once
  authenticated), `method`, `path`, `statusCode`, `durationMs`.
- **Validation** — a global `ValidationPipe` enforces every DTO's
  `class-validator` decorators on every request body/query, rejecting
  anything that doesn't match before it reaches a controller method.
- **Auth** — `JwtAuthGuard` + `@CurrentUser()` decorator; every
  ownership-scoped query filters by the authenticated `userId` at the Prisma
  query level (never "fetch then filter in memory").

## Why a monolith (not microservices) here

Every feature shares one Postgres schema with real foreign-key relationships
(`User` → `GithubAccount`/`GitlabAccount` → `PullRequest` → `Review`) and one
Redis instance for OAuth state. Splitting this into separate services would
mean either duplicating that schema across service boundaries or paying a
network hop for every ownership check — neither is justified at this scale.
The modular boundaries above exist so that *if* a piece of this ever needs to
become its own service (most likely candidate: the AI review generation,
since it's the most externally-dependent and stateless piece), it can be
extracted without having to first untangle it from the rest of the code.
