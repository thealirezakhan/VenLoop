"use client";

import { useState } from "react";

export function EvidenceExportButton({ checkInId }: { checkInId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(`/api/v1/check-ins/${checkInId}`);
            const body = await res.json();
            if (!res.ok) {
              setError((body as { error?: { message?: string } }).error?.message ?? "Export failed.");
              return;
            }
            const blob = new Blob([JSON.stringify(body.data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `venloop-evidence-${checkInId}.json`;
            a.click();
            URL.revokeObjectURL(url);
          } finally {
            setBusy(false);
          }
        }}
        className="neo-btn h-7 px-2 text-[9.5px]"
      >
        {busy ? "Exporting…" : "Download evidence JSON"}
      </button>
      {error ? (
        <p role="alert" className="text-[10px] font-semibold text-rose-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

