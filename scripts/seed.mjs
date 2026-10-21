import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example)");
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Synthetic demo accounts only. Never real credentials (PRD 15.6, 21.16).
const DEMO_PASSWORD = "venloop-demo-123";

const people = [
  { id: "00000000-0000-4000-8000-000000000001", email: "admin@venloop.demo", role: "super_admin", display_name: "Demo Admin" },
  { id: "00000000-0000-4000-8000-000000000002", email: "caregiver.a@venloop.demo", role: "caregiver", display_name: "Caregiver A (Ana)" },
  { id: "00000000-0000-4000-8000-000000000003", email: "caregiver.b@venloop.demo", role: "caregiver", display_name: "Caregiver B (Ben)" },
];

const A = people[1].id;
const B = people[2].id;
const ADMIN_ID = people[0].id;

const patients = [
  {
    id: "00000000-0000-4000-8000-000000000011",
    display_name: "Margaret Thompson",
    timezone: "America/New_York",
    preferred_language: "en",
    caregiver: A,
    date_of_birth: "1947-03-14",
    phone: "(555) 391-7720",
    mrn: "MRN-88412",
    conditions: ["Hypertension", "Type 2 Diabetes"],
    primary_provider: "Dr. Robert Vance (Cardiology)",
    risk_level: "high",
    schedules: [
      { name: "Levothyroxine 50mcg", time: "08:00:00" },
      { name: "Amlodipine 5mg", time: "18:00:00" },
    ],
    medications: [
      { name: "Levothyroxine", dosage: "50mcg", route: "Oral", frequency_label: "Once daily at 8:00 AM, empty stomach", scheduled_times: ["08:00"], prescriber: "Dr. Robert Vance (Cardiology)" },
      { name: "Amlodipine Besylate", dosage: "5mg", route: "Oral", frequency_label: "Once daily at 6:00 PM", scheduled_times: ["18:00"], prescriber: "Dr. Robert Vance (Cardiology)" },
    ],
    contacts: [
      { name: "Karen Thompson", relationship: "Daughter", phone: "(555) 492-1188", priority: 1, channels: ["sms", "voice"], notes: "Health proxy" },
      { name: "Dr. Robert Vance", relationship: "Cardiology", phone: "(555) 901-2244", priority: 2, channels: ["voice"], notes: "Primary physician" },
    ],
    note: "Morning adherence consistent. Daughter Karen aligns evening reminders with tea time.",
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    display_name: "Ramesh Patel",
    timezone: "Asia/Kolkata",
    preferred_language: "en",
    caregiver: A,
    date_of_birth: "1950-08-02",
    phone: "(555) 214-6631",
    mrn: "MRN-77120",
    conditions: ["Coronary Artery Disease"],
    primary_provider: "Dr. Anita Rao (Internal Medicine)",
    risk_level: "medium",
    schedules: [{ name: "Metformin 500mg", time: "09:00:00" }],
    medications: [
      { name: "Metformin", dosage: "500mg", route: "Oral", frequency_label: "Once daily with breakfast", scheduled_times: ["09:00"], prescriber: "Dr. Anita Rao (Internal Medicine)" },
    ],
    contacts: [
      { name: "Priya Patel", relationship: "Daughter", phone: "(555) 330-7712", priority: 1, channels: ["sms", "voice"], notes: null },
      { name: "Dr. Anita Rao", relationship: "Internal Medicine", phone: "(555) 901-5580", priority: 2, channels: ["voice"], notes: null },
    ],
    note: "Prefers calls after breakfast. Confirmed he keeps a pill organizer by the kettle.",
  },
  {
    id: "00000000-0000-4000-8000-000000000013",
    display_name: "Doris Chen",
    timezone: "Europe/London",
    preferred_language: "en",
    caregiver: B,
    date_of_birth: "1942-11-30",
    phone: "(555) 660-1184",
    mrn: "MRN-55301",
    conditions: ["Chronic Kidney Disease", "Hypertension"],
    primary_provider: "Dr. Emily Shaw (Nephrology)",
    risk_level: "low",
    schedules: [{ name: "Lisinopril 10mg", time: "08:30:00" }],
    medications: [
      { name: "Lisinopril", dosage: "10mg", route: "Oral", frequency_label: "Once daily in the morning", scheduled_times: ["08:30"], prescriber: "Dr. Emily Shaw (Nephrology)" },
    ],
    contacts: [
      { name: "Michael Chen", relationship: "Son", phone: "(555) 208-9930", priority: 1, channels: ["sms", "voice"], notes: null },
    ],
    note: "No concerns reported. Continue morning check-in cadence.",
  },
  {
    id: "00000000-0000-4000-8000-000000000014",
    display_name: "Eleanor Davis",
    timezone: "America/New_York",
    preferred_language: "en",
    caregiver: A,
    date_of_birth: "1940-06-21",
    phone: "(555) 492-1190",
    mrn: "MRN-1092-77",
    conditions: ["Congestive Heart Failure", "Renal Stage 2"],
    primary_provider: "Dr. Robert Vance (Cardiology)",
    risk_level: "high",
    schedules: [
      { name: "Lisinopril 10mg", time: "08:45:00" },
      { name: "Furosemide 20mg", time: "14:00:00" },
    ],
    medications: [
      { name: "Lisinopril", dosage: "10mg", route: "Oral", frequency_label: "Once daily in the morning", scheduled_times: ["08:45"], prescriber: "Dr. Robert Vance (Cardiology)" },
      { name: "Furosemide", dosage: "20mg", route: "Oral", frequency_label: "Once daily after lunch", scheduled_times: ["14:00"], prescriber: "Dr. Robert Vance (Cardiology)" },
    ],
    contacts: [
      { name: "Karen Davis", relationship: "Daughter", phone: "(555) 492-1188", priority: 1, channels: ["sms", "voice"], notes: "Designated proxy" },
      { name: "David Davis", relationship: "Son", phone: "(555) 492-1190", priority: 2, channels: ["voice"], notes: "Secondary escalation" },
    ],
    note: "Memory care residence. Front desk can assist with answering the phone.",
  },
  {
    id: "00000000-0000-4000-8000-000000000015",
    display_name: "James Carter",
    timezone: "America/New_York",
    preferred_language: "en",
    caregiver: A,
    date_of_birth: "1945-03-14",
    phone: "(555) 234-8901",
    mrn: "MRN-8942-01",
    conditions: ["Hypertension", "Post-Stent"],
    primary_provider: "Dr. Robert Vance (Cardiology)",
    risk_level: "high",
    schedules: [
      { name: "Metoprolol 25mg", time: "09:15:00" },
      { name: "Atorvastatin 20mg", time: "21:00:00" },
    ],
    medications: [
      { name: "Metoprolol Tartrate", dosage: "25mg", route: "Oral", frequency_label: "Once daily at 9:15 AM with food", scheduled_times: ["09:15"], prescriber: "Dr. Robert Vance (Cardiology)", notes: "Beta-blocker; orthostatic dizziness is a flagged adverse event." },
      { name: "Atorvastatin", dosage: "20mg", route: "Oral", frequency_label: "Once daily at bedtime", scheduled_times: ["21:00"], prescriber: "Metro Heart Clinic" },
    ],
    contacts: [
      { name: "Linda Carter", relationship: "Daughter", phone: "(555) 492-1288", priority: 1, channels: ["sms", "voice"], notes: "Health proxy" },
      { name: "David Carter", relationship: "Son", phone: "(555) 492-1190", priority: 2, channels: ["voice"], notes: null },
      { name: "Dr. Robert Vance", relationship: "Cardiology", phone: "(555) 901-2244", priority: 3, channels: ["voice"], notes: "Primary physician" },
    ],
    note: "Lives alone. Daughter Linda checks in after the morning call window.",
  },
  {
    id: "00000000-0000-4000-8000-000000000016",
    display_name: "Arthur King",
    timezone: "Europe/London",
    preferred_language: "en",
    caregiver: B,
    date_of_birth: "1949-01-09",
    phone: "(555) 901-2244",
    mrn: "MRN-3301-19",
    conditions: ["Type 2 Diabetes"],
    primary_provider: "Dr. Anita Rao (Internal Medicine)",
    risk_level: "medium",
    schedules: [{ name: "Metformin 500mg", time: "10:00:00" }],
    medications: [
      { name: "Metformin", dosage: "500mg", route: "Oral", frequency_label: "Once daily with late breakfast", scheduled_times: ["10:00"], prescriber: "Dr. Anita Rao (Internal Medicine)" },
    ],
    contacts: [
      { name: "Susan King", relationship: "Daughter", phone: "(555) 771-3300", priority: 1, channels: ["sms", "voice"], notes: null },
    ],
    note: "Solo living. Uses a weekly pill box; confirm refill dates during check-ins.",
  },
];

const { data: existing } = await admin.auth.admin.listUsers();
const byId = new Map(existing.users.map((u) => [u.id, u]));

for (const p of people) {
  if (!byId.has(p.id)) {
    const { error } = await admin.auth.admin.createUser({
      id: p.id,
      email: p.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser ${p.email}: ${error.message}`);
  }
  const { error } = await admin
    .from("profiles")
    .upsert(
      { id: p.id, role: p.role, display_name: p.display_name, email: p.email, is_active: true },
      { onConflict: "id" },
    );
  if (error) throw new Error(`profile ${p.email}: ${error.message}`);
}

for (const p of patients) {
  const { error: patientErr } = await admin
    .from("patients")
    .upsert(
      {
        id: p.id,
        display_name: p.display_name,
        timezone: p.timezone,
        preferred_language: p.preferred_language,
        status: "active",
        date_of_birth: p.date_of_birth,
        phone: p.phone,
        mrn: p.mrn,
        conditions: p.conditions,
        primary_provider: p.primary_provider,
        risk_level: p.risk_level,
      },
      { onConflict: "id" },
    );
  if (patientErr) throw new Error(`patient ${p.display_name}: ${patientErr.message}`);

  const { error: assignErr } = await admin
    .from("caregiver_patient_assignments")
    .upsert(
      { caregiver_id: p.caregiver, patient_id: p.id, relationship_label: "demo relative", is_active: true, created_by: ADMIN_ID },
      { onConflict: "caregiver_id,patient_id" },
    );
  if (assignErr) throw new Error(`assignment ${p.display_name}: ${assignErr.message}`);

  // Replace schedule/medication/contact fixtures so reruns stay deterministic.
  const { error: scheduleDelErr } = await admin.from("medication_schedules").delete().eq("patient_id", p.id);
  if (scheduleDelErr) throw new Error(`schedule reset ${p.display_name}: ${scheduleDelErr.message}`);

  const { error: scheduleErr } = await admin.from("medication_schedules").insert(
    p.schedules.map((s) => ({
      patient_id: p.id,
      display_name: s.name,
      schedule_description: `Daily ${s.name} check-in call (simulated).`,
      scheduled_local_time: s.time,
      timezone: p.timezone,
      effective_from: "2026-01-01",
      is_active: true,
      version: 1,
    })),
  );
  if (scheduleErr) throw new Error(`schedule ${p.display_name}: ${scheduleErr.message}`);

  await admin.from("medications").delete().eq("patient_id", p.id);
  const { error: medErr } = await admin.from("medications").insert(
    p.medications.map((m) => ({
      patient_id: p.id,
      name: m.name,
      dosage: m.dosage,
      route: m.route,
      frequency_label: m.frequency_label,
      scheduled_times: m.scheduled_times,
      prescriber: m.prescriber,
      status: "active",
      notes: m.notes ?? null,
    })),
  );
  if (medErr) throw new Error(`medications ${p.display_name}: ${medErr.message}`);

  await admin.from("emergency_contacts").delete().eq("patient_id", p.id);
  const { error: contactErr } = await admin.from("emergency_contacts").insert(
    p.contacts.map((c) => ({
      patient_id: p.id,
      name: c.name,
      relationship: c.relationship,
      phone: c.phone,
      priority: c.priority,
      channels: c.channels,
      notes: c.notes,
    })),
  );
  if (contactErr) throw new Error(`contacts ${p.display_name}: ${contactErr.message}`);

  const { count: noteCount } = await admin
    .from("care_notes")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", p.id);
  if (!noteCount) {
    const { error: noteErr } = await admin.from("care_notes").insert({
      patient_id: p.id,
      author_id: p.caregiver,
      body: p.note,
    });
    if (noteErr) throw new Error(`note ${p.display_name}: ${noteErr.message}`);
  }

  const { count: consentCount } = await admin
    .from("consents")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", p.id)
    .eq("consent_type", "simulated_check_in");
  if (!consentCount) {
    const { error: consentErr } = await admin.from("consents").insert({
      patient_id: p.id,
      consent_type: "simulated_check_in",
      status: "granted",
      scope: "synthetic_demo_only",
      recorded_by: ADMIN_ID,
      source: "synthetic_fixture",
    });
    if (consentErr) throw new Error(`consent ${p.display_name}: ${consentErr.message}`);
  }
}

// Approved synthetic guidance for RAG grounding only. Never dosage advice.
const medicationGuidance = [
  {
    medication_name: "Lisinopril",
    title: "Lightheadedness and missed doses",
    guidance:
      "Take this medicine at the time on the schedule. Stand up slowly if you feel lightheaded. Do not take an extra dose if you are unsure whether you took one; ask your pharmacist or prescriber what to do.",
  },
  {
    medication_name: "Furosemide",
    title: "Urination, thirst, and dizziness",
    guidance:
      "Take this medicine at the time on the schedule. It may make you urinate more often. Tell your caregiver if you feel very thirsty, weak, or dizzy. Do not change the dose yourself.",
  },
  {
    medication_name: "Levothyroxine",
    title: "Routine timing and missed doses",
    guidance:
      "Take this medicine at the scheduled time, following the label. If a dose is missed, ask your pharmacist or prescriber what to do; do not take an extra tablet on your own.",
  },
  {
    medication_name: "Amlodipine",
    title: "Dizziness and ankle swelling",
    guidance:
      "Take this medicine at the scheduled time. Tell your caregiver if you feel dizzy or notice swelling in your ankles. Changes to the dose are decided by your prescriber.",
  },
  {
    medication_name: "Metformin",
    title: "Stomach upset",
    guidance:
      "Take this medicine with food at the scheduled time. Tell your caregiver if stomach upset does not settle. Do not stop or change the medicine without speaking to your prescriber.",
  },
  {
    medication_name: "Metoprolol",
    title: "Dizziness and abrupt changes",
    guidance:
      "Take this medicine at the scheduled time with food. Tell your caregiver about dizziness or a slow pulse. Changes to this medicine are decided by your prescriber.",
  },
  {
    medication_name: "Atorvastatin",
    title: "New muscle aches",
    guidance:
      "Take this medicine at the scheduled time. Tell your caregiver about new or unusual muscle aches. Do not change the dose yourself.",
  },
  {
    medication_name: "General",
    title: "Nausea or feeling unwell during a check-in",
    guidance:
      "Nausea and dizziness can have many causes. Sit somewhere safe and tell your caregiver. VenLoop cannot diagnose symptoms or change medication. Contact your doctor if symptoms are severe or getting worse.",
  },
  {
    medication_name: "General",
    title: "What VenLoop can and cannot do",
    guidance:
      "VenLoop records self-reported adherence and opens a caregiver follow-up when a symptom is reported. It never gives dosage advice, never diagnoses, and never sends a real notification in this demo.",
  },
];

await admin.from("medication_guidance").delete().eq("approved", true);
const { error: guidanceErr } = await admin.from("medication_guidance").insert(medicationGuidance);
if (guidanceErr) throw new Error(`approved guidance: ${guidanceErr.message}`);

console.log(
  `Seeded ${people.length} users, ${patients.length} patients, medications, emergency contacts, care notes, ${medicationGuidance.length} approved guidance rows. Demo password: ${DEMO_PASSWORD}`,
);
