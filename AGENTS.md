<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# VenLoop — agent rules

Product: elder medication check-in (hackathon demo, synthetic data). Full spec: `prd.md`. Working agreement: PRD section 21 — one phase at a time, no fake success states, no hardcoded metrics, no dosage advice ever.

## Commands

- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` — run before claiming a phase done
- `pnpm db:start` / `pnpm db:reset` / `pnpm db:migrate <name>` — local Supabase

## Conventions

- TypeScript strict; no `any`; validate all external input with Zod (`src/lib/env.ts` pattern).
- Domain logic = pure TS in `src/modules/*`, no React/Next/Supabase imports there.
- API routes under `src/app/api/v1/*`: validate → authorize → orchestrate. Error envelope: `{ "error": { "code", "message", "requestId" } }`.
- DB changes = new migration only, never runtime schema mutation. Prefer soft deactivation over delete.
- Mock adapters must be labelled `simulated`; never claim real calls/notifications.
- Frontend: minimal until backend phases complete. No design systems, no speculative components.
- Env: secrets server-side only; keep `.env.example` updated; never commit `.env`.
