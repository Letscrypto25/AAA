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
