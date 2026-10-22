# Music Composer — Claude Code instructions

Web app where users point at a transparent circle-of-fifths overlay on their live camera feed to play notes, and record the session (video + audio).

**Full requirements, architecture and milestones live in [SPEC.md](SPEC.md). Read it before starting any milestone.** Build milestones in order. Do not start the next one until the current one's acceptance criteria pass.

## Stack

pnpm monorepo, TypeScript (strict) everywhere.

- `apps/web`: React 19 + Vite SPA, Tailwind, React Router, TanStack Query, Tone.js, @mediapipe/tasks-vision
- `apps/api`: Node 22 + Fastify, zod, bcrypt, jose, arctic, AWS SDK v3 (DynamoDB, S3)
- `packages/shared`: zod schemas + types shared by web and api (API contracts live here)
- `infra`: AWS CDK (TypeScript)

## Commands

- `pnpm install`: install everything (first time: `cp apps/api/.env.example apps/api/.env`)
- `pnpm dev`: start DynamoDB Local (8000) + RustFS S3 (9000, console 9001) via docker compose, create the table/bucket, then run web (5173) + api (3000). `pnpm dev:down` stops the containers.
- `pnpm test`: Vitest for all packages (web tests use happy-dom). API `*.int.test.ts` need DynamoDB Local running (`docker compose up -d`); each run uses a throwaway table.
- `pnpm e2e`: Playwright (Chromium with fake camera/mic); starts docker services, api and web itself
- `pnpm lint` / `pnpm typecheck` / `pnpm format:check`: must pass before you call a task done
- `pnpm build`: web → `apps/web/dist`; api → esbuild bundle `apps/api/dist/server.js` (`bcrypt` is external: native addon)
- `pnpm --filter @mc/api keys:generate >> apps/api/.env`: create a JWT signing key (otherwise dev uses an ephemeral one)
- `pnpm --filter infra cdk synth`: validate infrastructure (from M6)

## Conventions

- The SPA calls the API at `/api/*`. The Vite proxy (and CloudFront in prod) strips `/api`, so API routes are registered without the prefix (`/healthz`, `/auth/login`). The refresh cookie path is therefore `/api/auth`.
- `@mc/shared` is consumed as TypeScript source (no build step). Add each endpoint's request/response zod schemas there first, then use them on both sides (`api.get(path, Schema)` / `api.post(...)` from `apps/web/src/lib/apiClient.ts`).
- API errors: throw `AppError(status, code, message)` (`apps/api/src/errors.ts`); codes live in `ErrorCode` in `@mc/shared`. ZodErrors become 400 `VALIDATION_ERROR` with `fieldErrors`; DynamoDB outages become 503 + `Retry-After`.
- API: `buildApp(config, { now, db })` in `apps/api/src/app.ts` wires repositories/services and routes. Protected routes use `preHandler: requireAuth(tokens)` and read `request.userId`. Route tests use `app.inject` via `createTestApp()` in `apps/api/test/testApp.ts` (injectable clock).
- DynamoDB access only through `apps/api/src/repositories/*`; match AWS errors by name with `db/errors.ts`, not `instanceof`.
- Web auth: `useAuth()` for session state; wrap signed-in routes in `ProtectedRoute`. The access token is memory-only; never put tokens in localStorage.
- Keep TypeScript at 6.0.x until typescript-eslint supports 7.

## Rules

- Never store plaintext passwords or log passwords, tokens, or full emails.
- Hash passwords only with `bcrypt` (cost 12). bcrypt generates and embeds a unique salt per hash. Do not roll your own salting.
- Validate every request body/query with zod schemas from `packages/shared`.
- The API must stay **stateless**: no in-memory sessions, no local file writes. All state goes in DynamoDB/S3.
- Never send video bytes through the API. Use S3 presigned URLs.
- Secrets come from env vars (AWS Secrets Manager in prod). Never commit `.env`; keep `.env.example` updated.
- Prefer availability: degrade gracefully instead of failing hard (see SPEC.md §5).
- Write tests alongside code: unit tests for logic (note mapping, auth, token rotation), integration tests for API routes, and an e2e test per user-facing flow.
- Keep components small. Put camera, hand-tracking, audio and recorder logic in hooks/modules under `apps/web/src/features/compose/`, not in JSX.
