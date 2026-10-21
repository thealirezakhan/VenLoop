-- Care record extensions for the coordinated-care workspace UI (synthetic demo data).
-- Adds patient profile detail, active prescriptions, emergency contacts, and
-- coordinator care notes. All caregiver access stays scoped by assignment.

alter table patients
  add column date_of_birth date,
  add column phone text,
  add column mrn text,
  add column conditions text[] not null default '{}',
  add column primary_provider text,
  add column risk_level text not null default 'low'
    check (risk_level in ('low', 'medium', 'high'));

create table medications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients (id) on delete restrict,
  name text not null,
  dosage text not null,
  route text not null default 'Oral',
  frequency_label text not null,
  scheduled_times text[] not null default '{}',
  prescriber text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'discontinued')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_medications_patient on medications (patient_id) where status = 'active';

alter table medications enable row level security;

create trigger medications_set_updated_at
  before update on medications
  for each row execute function public.set_updated_at();

create policy "medications_select_assigned_or_admin"
  on medications for select
  using (public.is_super_admin() or public.is_caregiver_of(patient_id));

create policy "medications_admin_write"
  on medications for insert
  with check (public.is_super_admin());

create policy "medications_admin_update"
  on medications for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

create table emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients (id) on delete restrict,
  name text not null,
  relationship text not null,
  phone text not null,
  priority int not null default 1 check (priority between 1 and 5),
  channels text[] not null default '{sms,voice}',
  notes text,
  created_at timestamptz not null default now(),
  unique (patient_id, priority)
);

alter table emergency_contacts enable row level security;

create policy "contacts_select_assigned_or_admin"
  on emergency_contacts for select
  using (public.is_super_admin() or public.is_caregiver_of(patient_id));

create policy "contacts_admin_write"
  on emergency_contacts for insert
  with check (public.is_super_admin());

create policy "contacts_admin_update"
  on emergency_contacts for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

create table care_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients (id) on delete restrict,
  author_id uuid not null references profiles (id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index idx_care_notes_patient on care_notes (patient_id, created_at desc);

alter table care_notes enable row level security;

create policy "care_notes_select_assigned_or_admin"
  on care_notes for select
  using (public.is_super_admin() or public.is_caregiver_of(patient_id));

create policy "care_notes_insert_assigned_or_admin"
  on care_notes for insert
  with check (
    author_id = auth.uid()
    and (public.is_super_admin() or public.is_caregiver_of(patient_id))
  );
