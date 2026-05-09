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
- 2026-05-09: Attempted to push to `origin/main`, but encountered a 403 Permission Denied error for `Letscrypto25`.
