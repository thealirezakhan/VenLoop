-- VenLoop init schema (PRD 7). All tenant tables get RLS; operational tables are
-- service-role-only until later phases expose scoped reads.

create extension if not exists pgcrypto;

-- Helper functions reference tables created later in this file.
set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'super_admin' and is_active
  );
$$;

create or replace function public.is_caregiver_of(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from caregiver_patient_assignments a
    join profiles c on c.id = a.caregiver_id
    where a.patient_id = p
      and a.caregiver_id = auth.uid()
      and a.is_active
      and c.is_active
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Users cannot change their own role (PRD 3.3, 3.4). Only admin APIs (service role) may.
create or replace function public.guard_profile_self_update()
returns trigger
language plpgsql
as $$
begin
  if old.role is distinct from new.role and not public.is_super_admin() then
    raise exception 'role change requires super_admin';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- identity tables
-- ---------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('caregiver', 'super_admin')),
  display_name text not null,
  email text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function public.set_updated_at();

create trigger profiles_guard_self_update
  before update on profiles
  for each row execute function public.guard_profile_self_update();

create policy "profiles_select_own_or_admin"
  on profiles for select
  using (id = auth.uid() or public.is_super_admin());

create policy "profiles_insert_admin_only"
  on profiles for insert
  with check (public.is_super_admin());

create policy "profiles_update_own_or_admin"
  on profiles for update
  using (id = auth.uid() or public.is_super_admin())
  with check (id = auth.uid() or public.is_super_admin());

create table patients (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  timezone text not null,
  preferred_language text not null default 'en',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table patients enable row level security;

create trigger patients_set_updated_at
  before update on patients
  for each row execute function public.set_updated_at();

create policy "patients_select_assigned_or_admin"
  on patients for select
  using (public.is_super_admin() or public.is_caregiver_of(id));

create policy "patients_admin_write"
  on patients for insert
  with check (public.is_super_admin());

create policy "patients_admin_update"
  on patients for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

create table caregiver_patient_assignments (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null references profiles (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  relationship_label text,
  is_active boolean not null default true,
  created_by uuid not null references profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (caregiver_id, patient_id)
);

create index idx_assignments_caregiver on caregiver_patient_assignments (caregiver_id) where is_active;
create index idx_assignments_patient on caregiver_patient_assignments (patient_id) where is_active;

alter table caregiver_patient_assignments enable row level security;

create policy "assignments_select_own_or_admin"
  on caregiver_patient_assignments for select
  using (public.is_super_admin() or caregiver_id = auth.uid());

create policy "assignments_admin_write"
  on caregiver_patient_assignments for insert
  with check (public.is_super_admin());

create policy "assignments_admin_update"
  on caregiver_patient_assignments for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- schedules and consent
-- ---------------------------------------------------------------------------

create table medication_schedules (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients (id) on delete restrict,
  display_name text not null,
  schedule_description text not null,
  scheduled_local_time time not null,
  timezone text not null,
  effective_from date not null,
  effective_until date,
  is_active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from)
);

create index idx_schedules_patient on medication_schedules (patient_id) where is_active;

alter table medication_schedules enable row level security;

create trigger medication_schedules_set_updated_at
  before update on medication_schedules
  for each row execute function public.set_updated_at();

create policy "schedules_select_assigned_or_admin"
  on medication_schedules for select
  using (public.is_super_admin() or public.is_caregiver_of(patient_id));

create policy "schedules_write_assigned_or_admin"
  on medication_schedules for insert
  with check (public.is_super_admin() or public.is_caregiver_of(patient_id));

create policy "schedules_update_assigned_or_admin"
  on medication_schedules for update
  using (public.is_super_admin() or public.is_caregiver_of(patient_id))
  with check (public.is_super_admin() or public.is_caregiver_of(patient_id));

create table consents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients (id) on delete restrict,
  consent_type text not null,
  status text not null check (status in ('granted', 'denied', 'revoked', 'expired')),
  scope text not null default 'demo',
  recorded_at timestamptz not null default now(),
  expires_at timestamptz,
  recorded_by uuid not null references profiles (id) on delete restrict,
  source text not null default 'synthetic_fixture',
  created_at timestamptz not null default now()
);

create index idx_consents_patient on consents (patient_id);

alter table consents enable row level security;

create policy "consents_select_assigned_or_admin"
  on consents for select
  using (public.is_super_admin() or public.is_caregiver_of(patient_id));

create policy "consents_write_assigned_or_admin"
  on consents for insert
  with check (public.is_super_admin() or public.is_caregiver_of(patient_id));

create policy "consents_update_assigned_or_admin"
  on consents for update
  using (public.is_super_admin() or public.is_caregiver_of(patient_id))
  with check (public.is_super_admin() or public.is_caregiver_of(patient_id));

-- ---------------------------------------------------------------------------
-- workflow tables (server-side writes via service role until later phases)
-- ---------------------------------------------------------------------------

create table check_ins (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients (id) on delete restrict,
  schedule_id uuid references medication_schedules (id) on delete restrict,
  scenario_id text,
  channel text not null check (channel in ('browser_simulation', 'telephone', 'inbound_telephone', 'manual_test')),
  execution_mode text not null default 'simulated' check (execution_mode in ('simulated', 'real')),
  status text not null default 'scheduled' check (status in (
    'scheduled', 'validating', 'ready', 'in_progress', 'awaiting_clarification',
    'awaiting_approval', 'processing_action', 'verifying', 'completed',
    'escalated', 'failed', 'cancelled', 'unresolved'
  )),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_check_ins_patient on check_ins (patient_id, created_at desc);
create index idx_check_ins_status on check_ins (status);

alter table check_ins enable row level security;

create trigger check_ins_set_updated_at
  before update on check_ins
  for each row execute function public.set_updated_at();

create policy "check_ins_admin_select" on check_ins for select using (public.is_super_admin());

create table call_attempts (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references check_ins (id) on delete restrict,
  attempt_number int not null check (attempt_number >= 1),
  provider_name text,
  provider_call_id text,
  outcome text not null check (outcome in ('answered', 'no_answer', 'busy', 'failed', 'cancelled', 'simulated_no_answer', 'unknown')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  error_code text,
  execution_mode text not null default 'simulated' check (execution_mode in ('simulated', 'real')),
  created_at timestamptz not null default now(),
  unique (check_in_id, attempt_number)
);

alter table call_attempts enable row level security;
create policy "call_attempts_admin_select" on call_attempts for select using (public.is_super_admin());

create table conversation_records (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references check_ins (id) on delete restrict,
  input_source text not null check (input_source in ('speech', 'typed', 'synthetic_fixture')),
  original_transcript text,
  normalized_transcript text,
  language_detected text,
  language_configured text,
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'extracted', 'failed', 'clarification_needed')),
  created_at timestamptz not null default now()
);

create index idx_conversation_records_check_in on conversation_records (check_in_id);

alter table conversation_records enable row level security;
create policy "conversation_records_admin_select" on conversation_records for select using (public.is_super_admin());

create table extracted_signals (
  id uuid primary key default gen_random_uuid(),
  conversation_record_id uuid not null references conversation_records (id) on delete restrict,
  adherence_status text not null default 'unknown' check (adherence_status in ('reported_taken', 'reported_not_taken', 'unknown', 'not_applicable')),
  symptoms jsonb not null default '[]'::jsonb,
  dosage_question boolean not null default false,
  needs_clarification boolean not null default false,
  extraction_source text not null,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now()
);

alter table extracted_signals enable row level security;
create policy "extracted_signals_admin_select" on extracted_signals for select using (public.is_super_admin());

create table decisions (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references check_ins (id) on delete restrict,
  rule_set_version text not null,
  input_evidence_reference text not null,
  decision_type text not null check (decision_type in (
    'log_adherence', 'unreachable_escalation', 'symptom_escalation',
    'dosage_safety_response', 'clarification_required', 'unresolved'
  )),
  decision_reason text not null,
  expected_outcome text not null,
  decision_status text not null default 'recorded' check (decision_status in ('recorded', 'superseded')),
  created_at timestamptz not null default now()
);

create index idx_decisions_check_in on decisions (check_in_id);

alter table decisions enable row level security;
create policy "decisions_admin_select" on decisions for select using (public.is_super_admin());

create table actions (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references check_ins (id) on delete restrict,
  action_type text not null,
  execution_mode text not null default 'simulated' check (execution_mode in ('simulated', 'real')),
  status text not null default 'pending' check (status in (
    'pending', 'approval_required', 'approved', 'rejected', 'executing',
    'succeeded', 'failed', 'unknown', 'cancelled'
  )),
  idempotency_key text not null unique,
  destination_reference text,
  payload_reference text,
  provider_reference text,
  attempt_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_actions_status on actions (status);
create index idx_actions_check_in on actions (check_in_id);

alter table actions enable row level security;

create trigger actions_set_updated_at
  before update on actions
  for each row execute function public.set_updated_at();

create policy "actions_admin_select" on actions for select using (public.is_super_admin());

create table approvals (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references actions (id) on delete restrict,
  requested_by uuid not null references profiles (id) on delete restrict,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text,
  decided_by uuid not null references profiles (id) on delete restrict,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table approvals enable row level security;
create policy "approvals_admin_select" on approvals for select using (public.is_super_admin());

create table notification_events (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references actions (id) on delete restrict,
  provider_name text not null,
  provider_message_id text,
  status text not null check (status in ('simulated', 'pending', 'accepted', 'delivered', 'failed', 'unknown')),
  error_code text,
  attempted_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index idx_notification_events_action on notification_events (action_id);

alter table notification_events enable row level security;
create policy "notification_events_admin_select" on notification_events for select using (public.is_super_admin());

create table verification_records (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references check_ins (id) on delete restrict,
  action_id uuid references actions (id) on delete restrict,
  verification_type text not null,
  expected_state jsonb not null,
  observed_state jsonb not null,
  result text not null check (result in ('passed', 'failed', 'pending', 'unknown')),
  evidence_reference text not null,
  verified_at timestamptz not null default now()
);

alter table verification_records enable row level security;
create policy "verification_records_admin_select" on verification_records for select using (public.is_super_admin());

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,
  actor_id uuid,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  request_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_events_entity on audit_events (entity_type, entity_id);
create index idx_audit_events_created on audit_events (created_at desc);

alter table audit_events enable row level security;
create policy "audit_admin_select" on audit_events for select using (public.is_super_admin());

create table test_runs (
  id uuid primary key default gen_random_uuid(),
  scenario_id text not null,
  check_in_id uuid references check_ins (id) on delete restrict,
  run_mode text not null default 'simulated',
  expected_result jsonb not null,
  actual_result jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'passed', 'failed', 'inconclusive')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  evidence_reference text,
  failure_summary text
);

alter table test_runs enable row level security;
create policy "test_runs_admin_select" on test_runs for select using (public.is_super_admin());
