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
