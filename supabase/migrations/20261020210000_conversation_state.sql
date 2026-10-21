-- Persistent conversation state + approved medication guidance for the
-- LLM-assisted check-in conversation. Safety decisions remain deterministic;
-- the LLM only phrases replies from facts supplied by the rules engine.

alter table conversation_records
  add column agent_reply text,
  add column follow_up_question text;

create table conversation_states (
  check_in_id uuid primary key references check_ins (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  turn_count int not null default 0 check (turn_count >= 0),
  reply_source text not null default 'scripted'
    check (reply_source in ('llm', 'scripted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table conversation_states enable row level security;

create trigger conversation_states_set_updated_at
  before update on conversation_states
  for each row execute function public.set_updated_at();

create policy "conversation_states_select_assigned_or_admin"
  on conversation_states for select
  using (public.is_super_admin() or exists (
    select 1 from check_ins c where c.id = check_in_id and public.is_caregiver_of(c.patient_id)
  ));

-- Approved, synthetic medication guidance used only as LLM grounding.
-- No dosage-change advice; rows are seeded, never written at runtime.
create table medication_guidance (
  id uuid primary key default gen_random_uuid(),
  medication_name text not null,
  title text not null,
  guidance text not null,
  source_label text not null default 'Approved synthetic demo guidance',
  approved boolean not null default true,
  created_at timestamptz not null default now()
);

create index medication_guidance_name_idx on medication_guidance (lower(medication_name));

alter table medication_guidance enable row level security;

create policy "medication_guidance_read_approved"
  on medication_guidance for select
  to authenticated
  using (approved);
