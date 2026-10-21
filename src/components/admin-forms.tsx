"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return data.error?.message ?? `Request failed (${res.status}).`;
}

function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  };
  return { error, busy, run };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-[11px] font-semibold text-rose-ink">
      {error}
    </p>
  ) : null;
}

const input =
  "neo-input";

export function CreateCaregiverForm() {
  const { error, busy, run } = useSubmit();
  const [form, setForm] = useState({ email: "", displayName: "", password: "" });
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => post("/api/v1/admin/caregivers", form));
      }}
    >
      <input
        className={`${input} w-full`}
        placeholder="Email"
        type="email"
        required
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
      />
      <input
        className={`${input} w-full`}
        placeholder="Display name"
        required
        value={form.displayName}
        onChange={(e) => setForm({ ...form, displayName: e.target.value })}
      />
      <input
        className={`${input} w-full`}
        placeholder="Password (min 10 chars)"
        type="password"
        required
        minLength={10}
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
      />
      <ErrorLine error={error} />
      <button type="submit" disabled={busy} className="neo-btn neo-btn-dark">
        {busy ? "Creating…" : "Create caregiver"}
      </button>
    </form>
  );
}

export function CreatePatientForm() {
  const { error, busy, run } = useSubmit();
  const [form, setForm] = useState({ displayName: "", timezone: "Europe/Lisbon", preferredLanguage: "en" });
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => post("/api/v1/admin/patients", form));
      }}
    >
      <input
        className={`${input} w-full`}
        placeholder="Display name"
        required
        value={form.displayName}
        onChange={(e) => setForm({ ...form, displayName: e.target.value })}
      />
      <input
        className={`${input} w-full`}
        placeholder="Timezone"
        required
        value={form.timezone}
        onChange={(e) => setForm({ ...form, timezone: e.target.value })}
      />
      <input
        className={`${input} w-full`}
        placeholder="Language (e.g. en)"
        required
        value={form.preferredLanguage}
        onChange={(e) => setForm({ ...form, preferredLanguage: e.target.value })}
      />
      <ErrorLine error={error} />
      <button type="submit" disabled={busy} className="neo-btn neo-btn-dark">
        {busy ? "Creating…" : "Create patient"}
      </button>
    </form>
  );
}

interface Option {
  id: string;
  label: string;
}

export function CreateAssignmentForm({ caregivers, patients }: { caregivers: Option[]; patients: Option[] }) {
  const { error, busy, run } = useSubmit();
  const [caregiverId, setCaregiverId] = useState("");
  const [patientId, setPatientId] = useState("");
  if (caregivers.length === 0 || patients.length === 0) {
    return <p className="text-[10.5px] text-ink-muted">Create at least one caregiver and one patient first.</p>;
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => post("/api/v1/admin/assignments", { caregiverId, patientId }));
      }}
    >
      <select className={`${input} w-full`} required value={caregiverId} onChange={(e) => setCaregiverId(e.target.value)}>
        <option value="">Caregiver…</option>
        {caregivers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <select className={`${input} w-full`} required value={patientId} onChange={(e) => setPatientId(e.target.value)}>
        <option value="">Patient…</option>
        {patients.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <ErrorLine error={error} />
      <button type="submit" disabled={busy} className="neo-btn neo-btn-dark">
        {busy ? "Assigning…" : "Assign"}
      </button>
    </form>
  );
}

export function DeactivateButton({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/v1/admin/assignments?id=${assignmentId}`, { method: "DELETE" });
        setBusy(false);
        router.refresh();
      }}
      className="neo-btn h-7 px-2 text-[10px]"
    >
      {busy ? "…" : "Deactivate"}
    </button>
  );
}

export function RunScenarioButtons({ scenarios }: { scenarios: { id: string; label: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {scenarios.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(s.id);
              setError(null);
              const err = await post("/api/v1/test-runs", { scenarioId: s.id });
              setBusy(null);
              if (err) setError(err);
              router.refresh();
            }}
            className="neo-btn neo-btn-dark"
          >
            {busy === s.id ? "Running…" : `Run ${s.id}`}
          </button>
        ))}
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

export function RetryRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/v1/test-runs/${runId}/retry`, { method: "POST" });
        setBusy(false);
        router.refresh();
      }}
      className="neo-btn h-7 px-2 text-[10px]"
    >
      {busy ? "…" : "Retry"}
    </button>
  );
}

export function ResetDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm("Reset demo data to the seeded state? This deletes current check-ins, actions, runs, and assignments.")) return;
          setBusy(true);
          setError(null);
          const err = await post("/api/v1/admin/demo/reset", {});
          setBusy(false);
          if (err) setError(err);
          else router.refresh();
        }}
        className="neo-btn bg-rose text-rose-ink"
      >
        {busy ? "Resetting…" : "Reset demo data"}
      </button>
      <ErrorLine error={error} />
    </div>
  );
}


