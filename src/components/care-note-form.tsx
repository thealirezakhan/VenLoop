"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CareNoteForm({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/patients/${patientId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(data.error?.message ?? `Request failed (${res.status}).`);
      return;
    }
    setBody("");
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={(event) => void submit(event)}>
      <textarea
        className="neo-input min-h-20 w-full resize-y"
        placeholder="Add a care note for the assigned team"
        maxLength={2000}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-[11px] font-semibold text-rose-ink">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy || !body.trim()} className="neo-btn neo-btn-dark self-start">
        {busy ? "Saving..." : "Add note"}
      </button>
    </form>
  );
}
