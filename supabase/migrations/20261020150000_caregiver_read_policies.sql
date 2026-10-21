-- Caregiver-scoped READ access to operational records (Phase 3 dashboard).
-- All writes to these tables remain service-role-only, authorized in server code.

create policy "check_ins_select_assigned_or_admin"
  on check_ins for select
  using (public.is_super_admin() or public.is_caregiver_of(patient_id));

create policy "call_attempts_select_assigned_or_admin"
  on call_attempts for select
  using (public.is_super_admin() or exists (
    select 1 from check_ins c where c.id = check_in_id and public.is_caregiver_of(c.patient_id)
  ));

create policy "conversation_records_select_assigned_or_admin"
  on conversation_records for select
  using (public.is_super_admin() or exists (
    select 1 from check_ins c where c.id = check_in_id and public.is_caregiver_of(c.patient_id)
  ));

create policy "extracted_signals_select_assigned_or_admin"
  on extracted_signals for select
  using (public.is_super_admin() or exists (
    select 1 from conversation_records cr
    join check_ins c on c.id = cr.check_in_id
    where cr.id = conversation_record_id and public.is_caregiver_of(c.patient_id)
  ));

create policy "decisions_select_assigned_or_admin"
  on decisions for select
  using (public.is_super_admin() or exists (
    select 1 from check_ins c where c.id = check_in_id and public.is_caregiver_of(c.patient_id)
  ));

create policy "actions_select_assigned_or_admin"
  on actions for select
  using (public.is_super_admin() or exists (
    select 1 from check_ins c where c.id = check_in_id and public.is_caregiver_of(c.patient_id)
  ));

create policy "approvals_select_assigned_or_admin"
  on approvals for select
  using (public.is_super_admin() or exists (
    select 1 from actions a
    join check_ins c on c.id = a.check_in_id
    where a.id = action_id and public.is_caregiver_of(c.patient_id)
  ));

create policy "notification_events_select_assigned_or_admin"
  on notification_events for select
  using (public.is_super_admin() or exists (
    select 1 from actions a
    join check_ins c on c.id = a.check_in_id
    where a.id = action_id and public.is_caregiver_of(c.patient_id)
  ));

create policy "verification_records_select_assigned_or_admin"
  on verification_records for select
  using (public.is_super_admin() or exists (
    select 1 from check_ins c where c.id = check_in_id and public.is_caregiver_of(c.patient_id)
  ));

-- Replace admin-only test_runs policy with admin-only stays; nothing to change.
