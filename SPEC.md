# Music Composer — Product & Technical Spec

## 1. Overview

A browser app. After signing in, the user opens the **Compose** view. The camera feed fills the screen (mirrored, like a selfie). A semi-transparent **circle-of-fifths** chart is drawn on top of it. The user points with an index finger, and when the fingertip enters a wedge, that note plays. A **Record** button toggles recording of the composited video (camera + overlay) and the audio (mic + played notes). Recordings upload to the cloud and appear in **My Recordings**.

Target: 1M registered users. Priority: **availability over consistency**.

## 2. Functional requirements

### 2.1 Accounts & authentication

**Sign up / log in with email + password**

- `POST /auth/register` `{ email, password, displayName }`
  - Normalize email (trim, lowercase). Password 8–72 **bytes** (bcrypt's limit; reject longer and don't truncate silently). Check it against a small common-password blocklist.
  - Hash with `bcrypt.hash(password, 12)`. The salt is generated per user and embedded in the hash string. Store only the hash.
  - Enforce email uniqueness with a DynamoDB conditional write on an `EMAIL#<email>` item (`attribute_not_exists`), in the same transaction as the user item.
- `POST /auth/login` `{ email, password }`: `bcrypt.compare`. Return a generic "invalid email or password" error on any failure. If the user doesn't exist, still run a dummy compare so timing doesn't reveal which emails are registered.

**Sign in with Google**

- OAuth 2.0 Authorization Code flow with PKCE and `state` (library: `arctic`).
- `GET /auth/google/start`: redirect to Google; store `state` + `code_verifier` in a short-lived httpOnly cookie.
- `GET /auth/google/callback`: exchange the code, verify the ID token (issuer, audience, expiry), and require `email_verified=true`.
  - If a user with that `googleSub` exists, log them in.
  - Else if a user with that email exists, link `googleSub` to that account (allowed only because Google verified the email).
  - Else create a new user with no password hash.

**Tokens (JWT)**

- **Access token**: JWT signed with ES256 (`jose`), 15-minute expiry. Claims: `sub` (userId), `iat`, `exp`, `jti`. Returned in the JSON body. The SPA keeps it **in memory only** (never localStorage).
- **Refresh token**: opaque random 256-bit value with a 30-day expiry. Sent as a `Secure; HttpOnly; SameSite=Strict; Path=/auth` cookie. The DB stores only its SHA-256 hash, together with `familyId`.
- `POST /auth/refresh`: **rotate** on every use. If a token that was already used is presented again, revoke its entire family (theft detection). Check the `Origin` header.
- `POST /auth/logout`: revoke the current refresh family and clear the cookie.
- The API verifies access tokens **locally** with the public key (no DB lookup). Signing keys come from Secrets Manager and support a `kid` for rotation.
- `GET /me`: returns the current user profile.

**Abuse protection**: WAF rate-based rules on `/auth/*` (e.g. 20 req/min/IP for login and register), plus per-account lockout backoff after 10 failed logins in 15 minutes.

### 2.2 Compose view (`/compose`, auth required)

1. **Start screen**: a "Start" button. A user gesture is required to unlock the `AudioContext` (`Tone.start()`) and to request `getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: true })`. Show clear UI when permission is denied, when no camera exists, or when the browser is unsupported.
2. **Camera layer**: a `<video>` element, mirrored horizontally with CSS `scaleX(-1)`.
3. **Overlay layer**: a circle-of-fifths chart drawn on a `<canvas>` at about 40% opacity (user-adjustable 20–80%), centered, with a diameter of about 70% of the shorter viewport side.
   - **Outer ring (12 wedges, major)**: C, G, D, A, E, B, F♯/G♭, D♭, A♭, E♭, B♭, F
   - **Inner ring (12 wedges, relative minor)**: Am, Em, Bm, F♯m, C♯m, G♯m, D♯m/E♭m, B♭m, Fm, Cm, Gm, Dm
   - C is at 12 o'clock, going clockwise. Each wedge spans 30°.
4. **Hand tracking**: MediaPipe `HandLandmarker` (VIDEO mode, GPU delegate, `numHands: 2`), driven by `requestVideoFrameCallback`. Use landmark **8 (index fingertip)**. Mirror the x coordinate to match the mirrored video, then map it to overlay coordinates.
5. **Hit testing**: convert the fingertip to polar coordinates relative to the chart center. The radius picks the ring (outside the chart means no note). The angle picks the wedge: `index = floor(((angleFromTopClockwise + 15°) mod 360) / 30)`.
6. **Playback** (Tone.js `PolySynth` or `Sampler` with piano samples):
   - Entering an outer wedge plays that major key's root note (octave 4). Entering an inner wedge plays the minor key's root note (octave 3).
   - Setting: "Note / Chord" toggle. In chord mode, play a major or minor triad instead.
   - Trigger on **wedge enter** after an 80 ms dwell (to stop jitter). Don't re-trigger until the fingertip leaves that wedge. Each hand is tracked separately, so two notes can sound at once.
   - Visual feedback: the active wedge glows, and a cursor dot is drawn at each fingertip.
   - Fallback: tapping or clicking a wedge also plays it (accessibility; works without hand tracking).
7. Performance budget: overlay and hit-testing must run at ≥ 30 fps on a mid-range laptop. Run MediaPipe off the main render loop if needed.

### 2.3 Recording

- One **Record** button that toggles between "● Record" and "■ Stop", with an elapsed timer and a red indicator while recording. The keyboard shortcut `R` toggles it too.
- **Video**: composite each frame into a hidden `<canvas>` (mirrored camera + overlay + active-wedge highlights), then `canvas.captureStream(30)`.
- **Audio**: create a `MediaStreamAudioDestinationNode` on Tone's context. Connect the mic (`createMediaStreamSource`) and the synth output to it.
- Combine the video track and the mixed audio track into one `MediaStream`, then pass it to `MediaRecorder`. Choose the mime type with `MediaRecorder.isTypeSupported`: `video/webm;codecs=vp9,opus`, then `video/webm`, then `video/mp4` (Safari).
- Limits: 720p, about 2.5 Mbps, **max 5 minutes** (auto-stop with a notice). Per-user quota: 2 GB total.
- On stop: save the Blob to **IndexedDB first** (so a network or API outage never loses a recording), then upload:
  1. `POST /recordings` `{ mimeType, sizeBytes, durationMs }` returns `{ recordingId, uploadId, partUrls[] }` (S3 multipart, 8 MB parts, presigned PUT URLs that expire in 15 min). Status is `pending`.
  2. The client uploads the parts in parallel (3 at a time), retrying each part with exponential backoff.
  3. `POST /recordings/:id/complete` `{ parts:[{partNumber, etag}] }`. The API completes the multipart upload and sets status to `ready`. The call is idempotent.
  4. Delete the IndexedDB copy only after it completes. A background retry runs on app load and on the `online` event.

### 2.4 My Recordings (`/recordings`, auth required)

- `GET /recordings?cursor=`: paginated list of the user's own recordings, newest first.
- `GET /recordings/:id/url`: returns a CloudFront signed URL valid for 1 hour, for playback or download.
- `DELETE /recordings/:id`: deletes the S3 object and the metadata row.
- The UI shows a grid of recordings with duration, date, a player, download and delete. Recordings still waiting in the local upload queue show "Uploading…".

## 3. Architecture

```
Browser (React SPA) ──► CloudFront ──► S3 (static web assets)
        │                   └──────► S3 (recordings, signed URLs)
        │  HTTPS /api/*
        ▼
   CloudFront + WAF ──► ALB ──► ECS Fargate (Fastify API, 3 AZs, autoscale)
                                   ├──► DynamoDB (users, tokens, recordings)
                                   ├──► S3 (presign multipart)
                                   └──► Secrets Manager (JWT keys, Google creds)
```

### Tech stack

| Layer          | Choice                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| Monorepo       | pnpm workspaces + TypeScript (strict)                                  |
| Frontend       | React 19 + Vite SPA, Tailwind CSS, React Router, TanStack Query        |
| Hand tracking  | `@mediapipe/tasks-vision` HandLandmarker (in-browser WASM/GPU)         |
| Audio          | Tone.js (Web Audio)                                                    |
| Recording      | MediaRecorder on `canvas.captureStream()` + mixed audio                |
| API            | Node.js 22 + Fastify, zod                                              |
| Auth           | `bcrypt` (cost 12), `jose` (JWT ES256), `arctic` (Google OAuth + PKCE) |
| Database       | Amazon DynamoDB (on-demand, single table)                              |
| Object storage | S3 + CloudFront signed URLs, presigned multipart upload                |
| Compute        | ECS Fargate behind ALB, 3 AZs, autoscaling                             |
| Edge/security  | CloudFront + AWS WAF rate-based rules, ACM TLS                         |
| IaC            | AWS CDK (TypeScript)                                                   |
| Testing        | Vitest, Fastify `inject`, Playwright (fake media devices), k6          |
| Observability  | CloudWatch + OpenTelemetry, Sentry (frontend)                          |

### Repository layout

```
apps/web/src/
  features/auth/        # login, register, Google button, token refresh logic
  features/compose/     # useCamera, useHandTracking, circleOfFifths.ts (geometry+hit test),
                        # audioEngine.ts (Tone), useRecorder.ts, uploadQueue.ts (IndexedDB)
  features/recordings/
  lib/apiClient.ts      # fetch wrapper: attaches access token, single-flight refresh on 401
apps/api/src/
  routes/auth.ts, routes/me.ts, routes/recordings.ts
  services/ (passwords.ts, tokens.ts, google.ts, storage.ts)
  repositories/ (users.ts, refreshTokens.ts, recordings.ts)  # DynamoDB access
  plugins/ (authGuard.ts, errorHandler.ts)
packages/shared/src/   # zod schemas + inferred types for every endpoint
infra/lib/             # CDK stacks: network, data, api, web, observability
docker-compose.yml     # dynamodb-local, rustfs (S3-compatible)
```

### DynamoDB single-table design (`app`)

| PK              | SK               | Attributes                                                  |
| --------------- | ---------------- | ----------------------------------------------------------- |
| `USER#<id>`     | `PROFILE`        | email, displayName, passwordHash?, googleSub?, createdAt    |
| `EMAIL#<email>` | `EMAIL`          | userId (uniqueness guard)                                   |
| `GOOGLE#<sub>`  | `GOOGLE`         | userId                                                      |
| `USER#<id>`     | `RT#<tokenHash>` | familyId, expiresAt, usedAt?, revoked; **TTL** on expiresAt |
| `USER#<id>`     | `REC#<ulid>`     | s3Key, status, mimeType, sizeBytes, durationMs, createdAt   |

IDs are ULIDs, so recordings sort by time. Billing is on-demand. Point-in-time recovery is on.

## 4. Non-functional: scale (1M users)

Sizing assumptions: 1M registered, about 10% DAU (100k), about 10k peak concurrent users, and about 300 API req/s at peak. Hand tracking and audio run **entirely in the browser**, so server load is only auth, metadata and presigned-URL calls.

- The API is stateless, so it scales horizontally. ECS service autoscaling targets 60% CPU, with a minimum of 3 tasks (one per AZ) and a maximum of 50.
- DynamoDB on-demand absorbs traffic spikes. Keys are partitioned by user, so there are no hot partitions.
- Static assets and recordings are served from CloudFront. Video bytes never pass through the API.
- Storage cost control: 5-minute cap, 2 GB per-user quota, S3 Intelligent-Tiering, and a lifecycle rule that aborts incomplete multipart uploads after 1 day.
- Load test with k6: 300 req/s sustained and a 1,000 req/s burst against auth and recording endpoints. Target p95 < 200 ms with an error rate < 0.1%.

## 5. Non-functional: availability over consistency

- **Everything is Multi-AZ**: Fargate tasks across 3 AZs, and DynamoDB and S3 are regional services by design. ALB health checks run on `/healthz`.
- **Stateless auth**: access-token verification needs no DB call, so authenticated requests keep working when the DB is degraded.
- **Eventually consistent reads** are the default (e.g. the recordings list may lag a just-finished upload by about 1 s; the UI merges its local queue to hide this). **Strongly consistent / conditional operations only where correctness needs them**: email uniqueness, and refresh-token rotation.
- **Compose works without the backend**: once the SPA has loaded, camera, hand tracking, playback and recording work even if the API is down. Recordings wait in IndexedDB and upload when the API is back.
- Google OAuth outage: email/password login keeps working (and the reverse).
- Every outbound call (DynamoDB, S3, Google) has a timeout and retries with jittered exponential backoff. Return a 503 with `Retry-After` rather than hanging.
- Targets: 99.9% availability SLO. Deploys are rolling (ECS minimum healthy 100%). Later, DynamoDB Global Tables + CloudFront origin failover could make it multi-region (out of scope for v1).

## 6. Security checklist

HTTPS only (HSTS). Strict CSP that allows the MediaPipe WASM/model origins (or self-hosts them). CORS restricted to the app origin. Helmet-equivalent headers. Every recording endpoint checks ownership (`USER#<sub>` must match). S3 bucket is private and accessible only through CloudFront OAC. No PII in logs. Dependencies scanned in CI.

## 7. Milestones (build in order)

| #   | Milestone                                                                                                     | Acceptance criteria                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Scaffold monorepo, lint, typecheck, Vitest, Playwright, docker compose (DynamoDB Local + RustFS), CI workflow | `pnpm dev` serves a hello page that calls `/healthz`; CI is green                                                                         |
| M1  | Email/password auth + JWT access/refresh with rotation, `/me`, auth UI, protected routes                      | Integration tests: register, login, refresh rotation, reuse detection, logout. E2E: sign up, then land on /compose                        |
| M2  | Google OAuth (PKCE), account linking                                                                          | Tests with a mocked Google token endpoint; manual check with real credentials                                                             |
| M3  | Compose view: camera, overlay, hit-testing, Tone.js playback, tap fallback, opacity and note/chord settings   | Unit tests for wedge mapping (all 24 wedges plus outside). E2E with a fake camera: overlay renders and clicking a wedge triggers playback |
| M4  | Recording: canvas composite, mixed audio, toggle button, 5-minute cap, IndexedDB queue                        | E2E: record 3 s, stop, and a Blob with size > 0 and a valid mime type is queued                                                           |
| M5  | Upload pipeline + My Recordings (multipart presign, complete, list, signed URL, delete, quota)                | Integration tests against RustFS (local S3). E2E: record, upload, see it in the list, play it, delete it                                  |
| M6  | Infra (CDK), WAF, observability, k6 load test, security headers                                               | `cdk synth` passes; k6 meets the §4 targets in staging                                                                                    |

## 8. Browser support

Latest Chrome, Edge, Firefox and Safari (desktop + mobile). Requires a secure context (HTTPS, or localhost in dev). Feature-detect `MediaRecorder`, `captureStream` and WebGL/WASM, and show an "unsupported browser" message when they are missing.
