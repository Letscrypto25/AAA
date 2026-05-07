# AAA Bets

AI-powered horse racing predictor for South African races, using Groq LLaMA 3 for analysis.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/aaa-bets run dev` — run the frontend (port 5173)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `GROQ_API_KEY`, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- AI: Groq SDK (LLaMA 3 70B)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite, Tailwind CSS v4, wouter routing, TanStack Query

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/db/src/schema.ts` — DB schema (races, horses, predictions, predictionWeights, chatMessages)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/groq.ts` — Groq AI analysis + chat
- `artifacts/api-server/src/lib/scheduler.ts` — 30min/5min refresh scheduler
- `artifacts/api-server/src/routes/gallop.ts` — Gallop.co.za GraphQL proxy (venue data + iframe links)
- `artifacts/aaa-bets/src/pages/` — React pages (Dashboard, Races, RaceDetail, FormGuide, Chat, Weights)

## Architecture decisions

- Gallop.co.za has a public Strapi GraphQL API at `https://backend.gallop.co.za/graphql` — introspection open, no auth required for read queries
- Real fixture data comes from SA Horse Form (`sahorseform.co.za/v4.html`), which gallop embeds as an iframe (`fixtureIframeLink` field)
- Venue/date history sourced from gallop's `getStripeReports` GraphQL query — returns real SA race dates and venues
- Prediction weights stored in DB and adjustable via AI chat or sliders UI
- Auto-refresh: 30-minute intervals, switching to 5-minute when within 30 minutes of race time

## Product

- Dashboard with AI top pick, upcoming races, recent predictions
- Races list — add races manually; per-race detail with horse entry form
- Analyze button triggers Groq LLaMA 3 scoring on 5 factors: course form, form/distance, jockey/trainer, odds movement, history
- Form Guide with tabbed iframe viewer: Race Card (SA Horse Form), Programme, Racing Stats, Tote Betting
- AI Chat — conversational advisor that can reweight prediction factors
- Weights page — slider UI for adjusting the 5 prediction factors

## User preferences

- South African horse racing focus (venues: Kenilworth, Vaal, Turffontein, Greyville, Scottsville, Fairview, Durbanville)
- Gallop.co.za as primary data source

## Gotchas

- Frontend workflow port MUST be 5173 (in the Replit supported list). Port 18461 (createArtifact default) was not supported and caused DIDNT_OPEN_A_PORT failures.
- `lib/api-client-react` and `lib/api-zod` export from `./src/index.ts` directly — Vite resolves TypeScript source, requires `fs.strict: false` and `allow: [workspaceRoot]` in vite.config.ts
- Orval codegen must use `mode: "single"` for zod output
- Never use `console.log` in server code — use `req.log` in handlers, `logger` elsewhere

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Gallop GraphQL schema: `https://backend.gallop.co.za/graphql` (Strapi v3, public introspection)
- Key queries: `iframe` (fixture/programme links), `getStripeReports` (venue+date history), `events` (major race events)
