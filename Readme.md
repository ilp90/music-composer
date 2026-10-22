# Music Composer

Point at a transparent circle-of-fifths chart over your camera feed to play notes, and record the session. See [SPEC.md](SPEC.md) for the full spec.

## Prerequisites

- Node.js 22 (`.nvmrc`); Node ≥ 22.22 recommended
- pnpm 9 — `corepack enable pnpm` (or `corepack enable pnpm --install-directory ~/.local/bin` if `/usr/local/bin` isn't writable)
- Docker Desktop (running)

## Getting started

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm exec playwright install chromium   # once, for e2e tests
pnpm dev                                 # http://localhost:5173
```

`pnpm dev` starts DynamoDB Local and RustFS (S3) in Docker, creates the `app` table and `recordings` bucket, and runs the API (port 3000) and web app (port 5173). Stop the containers with `pnpm dev:down`.

## Checks

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e
```

CI runs the same steps (`.github/workflows/ci.yml`).
