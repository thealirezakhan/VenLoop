# Architecture — VenLoop

Modular monolith, single Next.js app (PRD 5). Layers and their boundaries:

| Layer | Location | Rule |
|---|---|---|
| Presentation | `src/app/**/page.tsx`, `src/components/**` | No business rules, no direct DB calls |
| API | `src/app/api/v1/**` | Auth, validation (Zod), orchestration only |
| Domain | `src/modules/**` (pure TS) | No React, no Next.js, no Supabase, no providers |
| Persistence | `src/lib/supabase/**`, SQL migrations | Migrations only; no runtime schema mutation |
| Integrations | `src/modules/providers/**` | Typed adapters; mock implements same interface as real |

## Data flow (one check-in)

1. Input arrives (simulator / test fixture) → `POST /api/v1/check-ins/:id/submit-input`.
2. Original transcript persisted (`conversation_records.original_transcript` never overwritten).
3. Signal extraction → Zod-validated `extracted_signals`.
4. Pure rules engine (`src/modules/rules-engine`) → `DecisionResult` (versioned rule set).
5. Decision + proposed action persisted; approval policy applied.
6. Action executed via notification adapter (mock in demo).
7. Independent read-back verification compares expected vs observed DB state.
8. Evidence + audit events written; dashboard reads only persisted records.

## Non-negotiables (PRD 9, 14)

- Deterministic rules for all four official scenarios; no LLM in the decision path.
- Dosage-change advice is always blocked, any language, any wording.
- Unclear input becomes clarification or `unresolved`, never `reported_taken`.
- Every external effect has `execution_mode` (`simulated`/`real`) and distinct status values.
- Server-side authorization on every protected operation; RLS as second line.
- Domain layer testable without Supabase, browser, or network.

## Provider interfaces

`SpeechToTextProvider`, `TextToSpeechProvider`, `TelephonyProvider`, `NotificationProvider` — defined in `src/modules/providers/types.ts`. Mock adapters are the only ones enabled by default (`SPEECH_PROVIDER=mock`, etc.).
