-- Escalation cases: risk-based human follow-up (replaces generic approval workflow).
-- Acknowledgement, notification delivery, and resolution are tracked separately.

alter table extracted_signals add column emergency boolean not null default false;

-- Emergency decisions use their own type (rule precedence: consent → emergency → …).
alter table decisions drop constraint decisions_decision_type_check;
alter table decisions add constraint decisions_decision_type_check check (decision_type in (
  'log_adherence', 'unreachable_escalation', 'symptom_escalation',
  'dosage_safety_response', 'emergency_guidance', 'clarification_required', 'unresolved'
));

create table escalation_cases (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id),
  check_in_id uuid references check_ins(id),
  action_id uuid references actions(id),
  category text not null check (category in ('symptom', 'dosage_question', 'unreachable', 'emergency')),
  severity int not null check (severity between 0 and 3),
  reason text not null,
  evidence_reference text not null,
  assigned_contact text,
  status text not null default 'detected'
    check (status in ('detected', 'escalated', 'closed')),
  notification_status text not null default 'notification_pending'
    check (notification_status in ('notification_pending', 'notification_failed', 'notification_unknown', 'notified')),
  acknowledgement_status text not null default 'pending'
    check (acknowledgement_status in ('pending', 'acknowledged')),
  resolution_status text not null default 'open'
    check (resolution_status in ('open', 'follow_up_in_progress', 'resolved_reported', 'closed')),
  outcome_note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index escalation_cases_patient_idx on escalation_cases (patient_id);
create index escalation_cases_status_idx on escalation_cases (status);

alter table escalation_cases enable row level security;

-- Caregivers read cases for their assigned patients; writes are service-role only.
create policy "Caregivers read cases for assigned patients"
  on escalation_cases for select
  to authenticated
  using (
    exists (
      select 1 from caregiver_patient_assignments a
      where a.caregiver_id = auth.uid()
        and a.patient_id = escalation_cases.patient_id
        and a.is_active
    )
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'super_admin'
    )
  );
