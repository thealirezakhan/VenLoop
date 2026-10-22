# Implementation Status

Phases per PRD 19. Do not mark a phase done until its acceptance criteria pass.

## Phase 0 — Repository and architecture — DONE

- [x] Next.js 16 + TS strict + ESLint + Prettier wiring
- [x] `env` validation via Zod (`src/lib/env.ts`), `.env.example`
- [x] `.gitignore`, git init (no commits made — awaiting explicit request)
- [x] `AGENTS.md`, docs (architecture, data model, safety policy, this file)
- [x] Acceptance: `pnpm lint && pnpm typecheck && pnpm build` pass

## Phase 1 — Database, authentication, authorization — DONE

- [x] Local Supabase (`pnpm db:start`, Docker), CLI pinned as devDependency
- [x] Migration `20261020120000_init_schema.sql`: all 16 tables, FKs, indexes, RLS
- [x] Migration `20261020150000_caregiver_read_policies.sql`: caregiver-scoped SELECT on operational tables (via assigned patients)
- [x] RLS: profiles self-update cannot change role (DB trigger); writes service-role only
- [x] Seed: `scripts/seed.mjs` (deterministic UUIDs; demo users admin@venloop.demo / caregiver.a@ / caregiver.b@, password `venloop-demo-123`)
- [x] Auth: `/login`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/me`
- [x] Pure permission helpers `src/lib/permissions.ts` + unit tests
- [x] Tests: unit + RLS integration — isolation, self-role-change block, operational write block

## Phase 2 — Domain rules and workflow — DONE

- [x] Domain types (`src/modules/rules-engine/types.ts`), rule set version `v1.1.0` (v1.0.0 + emergency pathway, spoken replies, escalation-case policy)
- [x] Pure rules engine `evaluateDecision` → precedence: consent → emergency → dosage block → symptoms → no-answer (threshold 2) → clarification flag → adherence; unknown never becomes a report (PRD 9.2–9.4)
- [x] Escalation-case policy (replaces approve/reject): urgent notifications execute immediately via the mock adapter (labelled simulated) and open an escalation case for human acknowledgement + category-specific follow-up; dosage advice remains permanently blocked
- [x] Conversation close-out: decisions carry `replyText` + one `followUpQuestion`; post-decision turns are reassessed cumulatively every turn and an escalation can upgrade (symptom/dosage → emergency) without reopening the check-in
- [x] Check-in + action state machines with typed `INVALID_TRANSITION` errors
- [x] Consent validation, idempotency (DB unique constraint), audit event names (incl. `case.*`)
- [x] Unit tests TC1–TC5, emergency precedence, close-out, ambiguity, consent, illegal transitions

## Phase 3 — Caregiver experience — DONE

- [x] Layout + pages: `/dashboard` (persisted metrics incl. open cases), `/patients` (card roster + detail with six tabs: overview/medications, care plan, calendar, care logs, contacts & family, care management), `/calendar` (month grid with event inspector, honest `no_record` days), `/check-ins` (list), `/check-ins/[id]` evidence console (transcript, signals, decisions, attempts, actions/notifications, escalation cases, verification expected vs observed), `/alerts`, `/cases` (acknowledge → category actions → resolve with note)
- [x] Care-record data: migration `20261020190000_care_record.sql` (patient demographics, `medications`, `emergency_contacts`, `care_notes` + RLS); `POST /api/v1/patients/[id]/notes` (author = session user, audited as `care_note.created`)
- [x] Separate shells: caregiver layout redirects `super_admin` to `/admin`; super-admin login lands on `/admin`; caregiver nav has no Admin link
- [x] Evidence export: `GET /api/v1/check-ins/[id]` + Download evidence JSON button
- [x] Live-tested: caregiver login → cases acknowledge/resolve (e2e), simulator close-out (reply → follow-up → goodbye)

## Phase 4 — Admin experience — DONE

- [x] Role-gated layout (`super_admin` only, server-side redirect); admin shell has no caregiver pages (evidence at `/admin/check-ins/[id]`)
- [x] `/admin` overview (open cases metric), `/admin/cases` (cross-patient escalation queue), `/admin/caregivers` (+ create), `/admin/patients` (+ create, search), `/admin/assignments` (+ create/deactivate), `/admin/runs` (TC1–TC5 buttons, history, retry, evidence links), `/admin/audit`, `/admin/config` (env presence only — secrets never printed) + demo reset
- [x] APIs: `GET/POST /api/v1/admin/{caregivers,patients,assignments,audit,overview}`, `POST /api/v1/admin/demo/reset`

## Phase 5 — Scenario rehearsal — DONE

- [x] `/demo/call-simulator`: patient picker (deep-linkable via `?patient=`), call-language selector, chat-style transcript with AI/patient/decision bubbles, scenario chips TC1–TC6 (TC2 records a no-answer attempt; TC6 combines breathing trouble + dosage), conversation-state rail, guardrail/telephony panels, start/submit/no-answer against the real pipeline, browser Web Speech mic by default, optional VerbX STT/TTS + translation when `VERBX_API_KEY` and `SPEECH_PROVIDER=verbx` are set, persistent SIMULATED CALL labeling; no fabricated “caregiver alerted” close-out copy
- [x] Live-tested: TC1 end-to-end (log_adherence → ack.taken → completed); TC4 close-out live (dosage block → follow-up → goodbye)

## Phase 6 — Evidence, audit, operations — DONE

- [x] API routes: check-ins (create/start/submit-input/no-answer/verify/get), cases (list/acknowledge/actions/resolve), test-runs (list/create/get/retry), verifications
- [x] Error envelope `{ error: { code, message, requestId } }` on every route
- [x] Mock notification adapter (labelled simulated) → verification read-back persisted; escalation case records notification/acknowledgement/resolution separately

## Phase 7 — Official tests and e2e — DONE (local scope)

- [x] TC1–TC5 unit tests (rules engine + extractor) + integration `tests/integration/scenarios.test.ts` runs TC1–TC4 through the real DB pipeline and asserts TC3–TC5 open notified escalation cases (skips when `SUPABASE_SERVICE_ROLE_KEY` absent, e.g. CI)
- [x] Playwright suite `tests/e2e/venloop.spec.ts` - 9 tests: unauth redirect, caregiver dashboard, admin restriction, simulator labeling, nausea multi-turn follow-up, breathing+dosage emergency reassessment, TC1-TC4 runs via UI, escalation case acknowledge/contact/resolve, evidence page - all passing locally (`pnpm test:e2e`)
- [x] CI: `.github/workflows/ci.yml` — lint, typecheck, test (DB suites skip), build
- [x] Evidence exportable (JSON download)
- [ ] Deployment smoke tests / running against a deployed app — deferred (local-only per plan)
- [x] Current verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` (112 passed), `pnpm test:e2e` (9 passed), `pnpm build` all green

## UI pass — neo-tactile redesign — DONE

- [x] Design tokens in `src/app/globals.css` (canvas `#F4F5F0`, ink, pastel surfaces, hard offset shadows, Plus Jakarta Sans + Space Grotesk via CSS `@import`)
- [x] Shared primitives: `ui/icon.tsx` (hand-rolled stroke icons, no new dependency), `ui/kit.tsx` (Badge/StatusBadge/Avatar/StatCard/PageHeader/SectionCard/EmptyState/Bar), `lib/format.ts`
- [x] Shared shell for both roles (`shell/app-shell.tsx`, `shell/sidebar-nav.tsx`, `shell/nav-config.ts`); `/demo` wrapped in the matching shell by role
- [x] All caregiver, admin, auth, and simulator screens restyled; login has demo-account shortcuts
- [x] Seed expanded to 6 patients (demographics, medications, emergency contacts, care notes); no historical check-ins are seeded, so empty/adherence states stay honest
- [x] Verified: `pnpm typecheck`, `pnpm lint`, `pnpm test` (53), `pnpm test:e2e` (7), `pnpm build` all pass after the redesign

## LLM conversation layer — DONE (optional provider)

- [x] Persistent per-check-in state (`conversation_states`, JSONB + `turn_count`) tracking medication status, symptoms, severe symptoms, addressed/unanswered questions, contradictions, escalation, and close reason
- [x] Agent replies are persisted on `conversation_records` (`agent_reply`, `follow_up_question`), so later turns receive real conversation history
- [x] Deterministic end gate (`src/modules/conversation/state.ts`): a symptom question stays open until answered or explicitly declined; the call cannot close while it is pending. Emergency stays immediate.
- [x] Medication safety remains rule-owned: the LLM never classifies adherence, picks a decision, opens a case, or writes state. It only rephrases an acknowledgement from supplied facts.
- [x] Optional Groq phrasing (`src/lib/server/llm.ts`, `GROQ_API_KEY` / `GROQ_MODEL`); missing key, timeout, malformed response, or unsafe output falls back to scripted text. Official `synthetic_fixture` runs always use scripted replies.
- [x] Output guard (`src/modules/conversation/reply-guard.ts`) rejects dosage instructions, milligram amounts, diagnoses, questions, unbacked alert claims, and non-emergency 911 references.
- [x] RAG is limited to approved synthetic rows in `medication_guidance`; deterministic token-overlap retrieval (`src/modules/conversation/guidance.ts`), no embeddings or vector DB
- [x] Simulator shows persisted conversation state (symptoms, open/unanswered questions, contradictions, escalation, turn count) and labels `LLM wording` vs `Scripted fallback`; TC3 now demonstrates the Eleanor nausea follow-up path
- [x] Multi-turn coverage: unit `tests/unit/conversation-state.test.ts`, guard/guidance tests, and DB pipeline `tests/integration/conversation.test.ts` (nausea → onset/severity → close)
- [x] PRD divergence, by explicit user request: PRD 3 lists conversational LLM/RAG as non-goals. The LLM is an optional phrasing layer only; safety decisions and escalation stay deterministic and demo-labeled.

## Per-turn safety reassessment + VerbX voice — DONE (voice gated by key)

- [x] Every patient turn re-evaluates cumulative facts (symptoms, severe reports, emergency phrases, dosage questions), not just the latest utterance. A new red flag upgrades an open symptom/dosage call to emergency and opens a separate `emergency` case/action; nothing is downgraded.
- [x] Breathing red flags now include `trouble breathing`, `difficulty breathing`, `breathing is hard`, and `can't catch my breath`, with explicit-denial handling (`no trouble breathing` is not an emergency). Emergency still outranks dosage advice in the same sentence.
- [x] Escalation actions use a purpose-scoped idempotency key and cases are deduplicated by check-in + category.
- [x] Deterministic question/reply flow is unchanged; scripted emergency wording always wins over generic follow-up wording.
- [x] Optional VerbX adapter (`src/lib/server/speech.ts`, routes `/api/v1/speech/{status,stt,tts}`): STT, TTS, and translation stay server-side with timeouts, input caps, and rate limits. Missing key returns `SPEECH_NOT_CONFIGURED`; the simulator stays text-only and labels speech simulated.
- [x] Simulator: call-language selector (English/Hindi/Marathi), browser streaming speech recognition by default with 700 ms silence auto-submit, VerbX batch STT fallback, optional spoken replies, active-concern rail, and TC6 one-turn reassessment demo.
- [x] Non-English input is translated to English only when VerbX is configured; otherwise it degrades to clarification (never a guessed adherence conclusion or missed emergency).
- [x] Groq cost guards: per-process concurrency cap (4), 8-second timeout, 1024-token cap with strict JSON schema, deterministic replies for routine/duplicate/long turns, recent-turn-only context.
- [x] Regression tests: `trouble breathing` + dosage extraction, cumulative non-downgrade/upgrade unit tests, DB pipeline symptom→emergency upgrade with two cases and two actions, TC6 e2e.
- [x] Live VerbX verified with `SPEECH_PROVIDER=verbx`: voice listing, English/Hindi/Marathi TTS, and English→Hindi translation return 200 through the app routes. A Hindi emergency utterance was translated, extracted, and escalated correctly end to end.
- [ ] Live VerbX STT returned `degraded_reason: provider_outage` with empty text (HTTP 200) during verification. The adapter rejects empty transcripts as `provider_error`; browser speech remains the fallback.
- Note: the live API accepts the key via `X-API-Key`; its OpenAPI file advertises `Authorization: Bearer`, which returns 401.

## Known limitations

- Deployment target not configured (local only per user decision).
- `pnpm typecheck` runs `next typegen` first, so it no longer depends on a prior build.
- `cacheComponents` disabled in `next.config.ts`: every authenticated page reads cookies at request time; enabling it requires Suspense-wrapping all session reads.
- PRD 16.4 failure-injection matrix only partially covered (invalid input, consent, transitions covered in unit tests; provider-timeout/DB-down infra scenarios not injected).
- Real telephony is intentionally not started — simulated calls only. The optional Groq LLM layer only rephrases replies; without `GROQ_API_KEY` the app runs fully scripted.
- VerbX TTS and translation are verified live. VerbX STT was unavailable upstream (`provider_outage`) during verification; without working STT, non-English speech falls back to browser recognition and non-English typed input still translates once configured.
- Rate limiting and LLM concurrency caps are per-process/in-memory; a multi-instance deployment needs a shared limiter.
- Demo calendar/adherence reflect only calls created during a session; past scheduled days render as `no record`, never “missed”.
- Typing during an in-progress call is not persisted until submitted; only submitted turns appear in evidence.
