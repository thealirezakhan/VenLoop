# Data Model — VenLoop

PostgreSQL via Supabase. UUID PKs, FK with restrict, timezone-aware timestamps, migrations only (PRD 7).

Tables (one migration may group related tables; order matters for FKs):

| Table | Purpose |
|---|---|
| `profiles` | auth user → role (`caregiver` \| `super_admin`); users cannot self-assign role |
| `patients` | synthetic patient records (name, timezone, language, status) |
| `caregiver_patient_assignments` | caregiver ↔ patient, unique active pair, `created_by` |
| `medication_schedules` | metadata + check-in local time; never dosage recommendations |
| `consents` | type, status (`granted`/`denied`/`revoked`/`expired`), scope, expires_at |
| `check_ins` | one check-in workflow; channel + `execution_mode` |
| `call_attempts` | per attempt; unique (check_in_id, attempt_number) |
| `conversation_records` | original + normalized transcript, languages |
| `extracted_signals` | adherence, symptoms, dosage_question, needs_clarification |
| `decisions` | rule_set_version, reason, evidence reference |
| `actions` | action_type, status, unique `idempotency_key` |
| `approvals` | approve/reject decisions on actions |
| `notification_events` | provider status (`simulated` ≠ delivered) |
| `verification_records` | expected vs observed state, result |
| `audit_events` | append-only; no app edit/delete endpoints |
| `test_runs` | TC1–TC4 runs: expected, actual, evidence, failures preserved |

## Rules

- Prefer soft deactivation (`is_active`) over deletes.
- Indexes: patient, active assignment, check-in date, action status, audit lookups.
- RLS enabled on all tenant-scoped tables; service role only on the server.
- Seed data is deterministic (`supabase/seed.sql`); reset via `pnpm db:reset` only.
