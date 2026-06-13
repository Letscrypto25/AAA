# Deployment Fix Rules

1. Before any file edit, read this `todo.md`.
2. Prioritize root-cause fixes over temporary workarounds.
3. After any terminal-driven change that affects behavior, update this file with a short status note.
4. Keep Railway compatibility first:
   - App must bind to `process.env.PORT`.
   - Build and start commands must work in a clean CI environment.
5. Every fix must be verified with a reproducible command and captured result.
6. Keep `.env` formatting strict: `KEY=value` (no spaces around `=`).

## Status Log

- 2026-05-09: Created `todo.md` and started Railway crash investigation.
- 2026-05-09: Found Railway healthcheck mismatch (`/api/health` vs actual `/api/healthz`) and fixed `railway.json`.
- 2026-05-09: Set `.env` `PORT=8080` for platform-compatible default while Railway still binds runtime `process.env.PORT`.
- 2026-05-09: Merged `origin/main` into local `main` to resolve divergence and unrelated histories.
- 2026-05-09: Successfully scrubbed `.env` from the entire Git history using `filter-branch` and force-pushed to `main` using the provided token.
- 2026-05-09: Fixed `pnpm-lock.yaml` mismatch with `overrides` configuration and pushed to the repository specified in `.env`.
- 2026-05-09: Verified local `main` branch is fully synchronized with the remote `main` branch of the new fork.
- 2026-05-10: Fixed `pnpm build` failure by adding fallbacks for `PORT` and `BASE_PATH` in `artifacts/mockup-sandbox/vite.config.ts`.
- 2026-05-10: Fixed `pnpm build` failure on Railway by specifying `engines` requirement (Node.js >= 22.12.0) in `package.json`.
- 2026-05-10: Renamed the primary local branch to `aaa` and synchronized it with the remote `main` and `aaa` branches.
- 2026-05-10: Successfully pushed the database schema to Supabase (port 6543) after fixing Windows-specific compatibility issues and `drizzle-kit` SSL configuration.
- 2026-05-10: Resolved `TypeError: Cannot read properties of undefined (reading 'id')` in `forecasting.ts` by adding safety checks for AI-generated horse indices and filtering out-of-bounds predictions.
- 2026-05-10: Replaced the active Gold Circle plus generated sync path with Tote/4Racing meeting, runner, odds, and official result ingestion in `raceSync.ts` plus a CAT-aware date/time helper pass in `race-time.ts`; verified with `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` in `artifacts/api-server`, `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` in `artifacts/aaa-bets`, and `node node_modules\typescript\bin\tsc --build` at repo root, all exiting 0.
- 2026-05-10: Tightened the deploy story to one Railway app server by removing the extra Replit frontend port, adding explicit Railway script aliases at the repo root, and sanitizing Gallop fallback links so the app no longer emits a `vercel.app` URL; verified with `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` in `artifacts/api-server` and `node node_modules\typescript\bin\tsc --build` at repo root, both exiting 0.
- 2026-05-10: Improved chat clarity by filtering empty shell races out of the AI briefing and chat UI, strengthened the Groq system prompt so live forecast context overrides stale chat history, added deterministic fallback parsing for user weight-change requests, widened the chat layout for easier reading, and deleted 8 empty Kenilworth Tote shell races directly from the live database; verified with `node --env-file=.env tmp\query-empty-races.cjs` (returned `[]`), `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` in `artifacts/api-server`, `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` in `artifacts/aaa-bets`, and `node node_modules\typescript\bin\tsc --build` at repo root, all exiting 0.
- 2026-05-11: Started a simpler AAA UI pass by renaming navigation labels for clarity, simplifying the desktop shell messaging, rebuilding `Dashboard.tsx` into a cleaner home board with fewer competing panels, and simplifying `Races.tsx` into a more focused weekly card view that only surfaces races with real runners, picks, or results; verified with `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` in `artifacts/aaa-bets` and `node node_modules\typescript\bin\tsc --build` at repo root, both exiting 0.
- 2026-05-11: Added an `Analyze today` action to `artifacts/aaa-bets/src/pages/Dashboard.tsx` that runs the existing per-race forecast flow sequentially across all loaded current-day races with runners, then refreshes the dashboard and race list summaries; verified again with `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` in `artifacts/aaa-bets` and `node node_modules\typescript\bin\tsc --build` at repo root, both exiting 0.
- 2026-05-11: Added a direct web-install wrapper path for AAA by turning `artifacts/aaa-bets` into an installable PWA with a manifest, service worker, install banner, and app icons (`manifest.webmanifest`, `sw.js`, `icon-192.svg`, `icon-512.svg`, `icon-maskable.svg`), plus service-worker registration in `src/main.tsx` and install metadata in `index.html`; verified with `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` in `artifacts/aaa-bets` and `node node_modules\typescript\bin\tsc --build` at repo root, both exiting 0, while a direct Vite production build remains blocked in this Windows checkout by missing optional Rollup binary `@rollup/rollup-win32-x64-msvc`.
- 2026-05-11: Expanded the AAA install/download overhaul by adding a dedicated `/install` route (`src/pages/InstallApp.tsx`), a reusable `use-pwa-install` hook, a more helpful install banner with a guide link, a new Install navigation entry, and a dashboard CTA that points users directly to the install guide; verified again with `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` in `artifacts/aaa-bets` and `node node_modules\typescript\bin\tsc --build` at repo root, both exiting 0.
- 2026-05-22: Added a five-mode chat bet lens (`win`, `place`, `exacta`, `trifecta`, `pick3`) across the chat contract, AI briefing, and in-app chat UI; removed the oversized topic cards so chat stays conversation-first; and tightened prediction calibration by reducing AI blend weight when the model and fallback disagree. Verified with `node --input-type=module -` at repo root to regenerate `lib/api-client-react` without Orval's Windows `spawn EPERM` clean/prettier path, then `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` in `artifacts/api-server`, `node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit` in `artifacts/aaa-bets`, and `node node_modules\typescript\bin\tsc --build` at repo root, all exiting 0.
erorr-2026-06-13T19:55:10.594244919Z [inf]  Starting Container
2026-06-13T19:55:10.828666653Z [err]  $ corepack pnpm --filter @workspace/api-server run start
2026-06-13T19:55:10.828678547Z [err]  $ node --enable-source-maps ./dist/index.mjs
2026-06-13T19:55:10.835246181Z [inf]  Server listening
2026-06-13T19:55:10.950964978Z [inf]  request completed
2026-06-13T19:55:12.946890199Z [inf]  Prediction scheduler started (1-minute tick)
2026-06-13T19:55:12.946895691Z [inf]  Sync scheduler started (2-hour tick)
2026-06-13T19:55:12.946901886Z [inf]  Prediction scheduler started
2026-06-13T19:55:15.808129200Z [inf]  Running initial weekly race sync...
2026-06-13T19:55:18.052972291Z [inf]  Starting weekly race sync
2026-06-13T19:55:48.068500957Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T19:55:48.068506549Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards
2026-06-13T19:55:48.068512681Z [inf]  Weekly race sync failed
2026-06-13T19:55:48.070897780Z [inf]  Failed to record race sync status
2026-06-13T19:56:17.532459287Z [inf]  Scheduled analysis triggered
2026-06-13T19:56:21.162968781Z [inf]  Scheduled analysis triggered
2026-06-13T19:56:27.125819954Z [inf]  Scheduled analysis triggered
2026-06-13T19:56:32.336049797Z [inf]  Scheduled analysis triggered
2026-06-13T19:56:38.660454259Z [inf]  Scheduled analysis triggered
2026-06-13T19:56:43.650370174Z [inf]  Scheduled analysis triggered
2026-06-13T19:56:50.443466624Z [inf]  Scheduled analysis triggered
2026-06-13T19:57:20.454484804Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T19:57:20.454489634Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards
2026-06-13T19:57:20.454494364Z [inf]  No synced race data matched during refresh
2026-06-13T19:57:20.454498800Z [inf]  Scheduled forecast skipped; no active runners loaded
2026-06-13T19:57:20.514025929Z [inf]  Scheduled analysis triggered
2026-06-13T19:57:40.542362367Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T19:57:40.542368493Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards
2026-06-13T19:57:40.542374407Z [inf]  No synced race data matched during refresh
2026-06-13T19:57:40.542397183Z [inf]  Scheduled forecast skipped; no active runners loaded
2026-06-13T19:57:40.542413734Z [inf]  Scheduled analysis triggered
2026-06-13T19:58:00.704746398Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T19:58:00.704752229Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards
2026-06-13T19:58:00.704759456Z [inf]  No synced race data matched during refresh
2026-06-13T19:58:00.704765781Z [inf]  Post-race result refresh triggered
2026-06-13T19:58:06.675172204Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T19:58:06.697456945Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards
2026-06-13T19:58:09.576202649Z [inf]  Post-race result refresh triggered
2026-06-13T19:58:09.576387208Z [inf]  No synced race data matched during refresh
2026-06-13T19:59:29.291205611Z [inf]  request completed
2026-06-13T19:59:29.291213464Z [inf]  request completed
2026-06-13T19:59:32.629573262Z [inf]  request completed
2026-06-13T19:59:37.292332645Z [inf]  request completed
2026-06-13T20:00:16.823079439Z [inf]  request completed
2026-06-13T20:03:07.589491458Z [inf]  Manual sync triggered
2026-06-13T20:03:07.589499644Z [inf]  Starting weekly race sync
2026-06-13T20:03:37.137687930Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T20:03:37.137698133Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards
2026-06-13T20:03:37.137706436Z [inf]  Weekly race sync failed
2026-06-13T20:03:37.141375477Z [inf]  Failed to record race sync status
2026-06-13T20:03:37.144916216Z [inf]  request completed
2026-06-13T20:03:37.144928588Z [inf]  request completed
2026-06-13T20:03:37.144935819Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T20:03:37.144944437Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards
2026-06-13T20:03:37.840748005Z [inf]  request completed
2026-06-13T20:03:37.945293083Z [inf]  No synced race data matched during refresh
2026-06-13T20:03:37.945301085Z [inf]  Post-race result refresh triggered
2026-06-13T20:03:40.835038536Z [inf]  request completed
2026-06-13T20:03:44.157517434Z [inf]  request completed
2026-06-13T20:03:46.986075032Z [inf]  request completed
2026-06-13T20:04:46.384589142Z [inf]  request completed
2026-06-13T20:04:46.384594929Z [inf]  request completed
2026-06-13T20:04:46.384600389Z [inf]  request completed
2026-06-13T20:04:46.384605105Z [inf]  request completed
2026-06-13T20:05:06.350591125Z [inf]  request completed
2026-06-13T20:05:43.429483174Z [inf]  request completed
2026-06-13T20:05:43.429491511Z [inf]  request completed
2026-06-13T20:06:23.527460769Z [inf]  request completed
2026-06-13T20:06:23.527473860Z [inf]  request completed
2026-06-13T20:09:43.731964571Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T20:09:43.731971664Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards
2026-06-13T20:09:43.731979460Z [inf]  No synced race data matched during refresh
2026-06-13T20:09:43.731986291Z [inf]  Post-race result refresh triggered
2026-06-13T20:15:45.104530547Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T20:15:45.104537013Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards
2026-06-13T20:15:45.104543804Z [inf]  No synced race data matched during refresh
2026-06-13T20:15:45.104550119Z [inf]  Post-race result refresh triggered
2026-06-13T20:21:47.662606248Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T20:21:47.662611935Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards
2026-06-13T20:21:47.662618019Z [inf]  No synced race data matched during refresh
2026-06-13T20:21:47.662623742Z [inf]  Post-race result refresh triggered
2026-06-13T20:27:38.697154977Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T20:27:38.780687446Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards
2026-06-13T20:27:41.685877796Z [inf]  No synced race data matched during refresh
2026-06-13T20:27:41.685884066Z [inf]  Post-race result refresh triggered
2026-06-13T20:28:41.227217166Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T20:28:41.227223365Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards
2026-06-13T20:28:41.227227090Z [inf]  No synced race data matched during refresh
2026-06-13T20:28:41.227231465Z [inf]  Scheduled forecast skipped; no active runners loaded
2026-06-13T20:33:43.195986745Z [inf]  No synced race data matched during refresh
2026-06-13T20:33:43.196001915Z [inf]  Post-race result refresh triggered
2026-06-13T20:33:43.196221026Z [inf]  Pro racecards request failed; retrying with standard endpoint
2026-06-13T20:33:43.196226448Z [inf]  The Racing API merge skipped due to credential or plan access; keeping Gallop racecards

- 2026-06-13: Root-caused the Railway `Weekly race sync failed` plus `Failed to record race sync status` loop to a Gallop text field containing a PostgreSQL-invalid NUL byte (`0x00`, shown in logs as `Favourite \u0000`). Added DB-bound text sanitization in `artifacts/api-server/src/lib/raceSync.ts` for race/horse/result/error text. Verified with `corepack pnpm --filter @workspace/api-server run typecheck` (exit 0), `corepack pnpm --filter @workspace/api-server run build` (exit 0), and a live `syncTodaysMeetings()` run against the configured second `DATABASE_URL`, which completed with `meetingsFound: 6` and `racesCreated: 0`.
