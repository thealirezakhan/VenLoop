"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Avatar, Badge, StatusBadge } from "@/components/ui/kit";
import { ageFrom, formatTime, humanAgo } from "@/lib/format";
import {
  CASE_ACTIONS_BY_CATEGORY,
  type CaseActionType,
  type CaseCategory,
} from "@/modules/escalation/case-actions";

export interface CaseCardData {
  id: string;
  patient_id: string;
  category: string;
  severity: number;
  reason: string;
  status: string;
  notification_status: string;
  acknowledgement_status: string;
  resolution_status: string;
  outcome_note: string | null;
  evidence_reference: string;
  assigned_contact: string | null;
  created_at: string;
  check_in_id: string | null;
  patient?: {
    id: string;
    display_name: string;
    mrn: string | null;
    date_of_birth: string | null;
    risk_level: string | null;
    phone: string | null;
  } | null;
}

const ACTION_LABELS: Record<string, string> = {
  acknowledge: "Acknowledge",
  contacted_patient: "Contacted patient",
  contact_healthcare_professional: "Contact doctor/pharmacist (simulated)",
  escalate_urgently: "Escalate urgently (simulated)",
  assign_follow_up: "Assign follow-up",
  call_alternate_contact: "Call alternate contact (simulated)",
  retry_later: "Retry later",
  record_professional_guidance: "Record professional guidance",
  record_outcome: "Record outcome note",
};

const CATEGORY_LABELS: Record<string, string> = {
  symptom: "Acute symptom escalation",
  dosage_question: "Medication safety question",
  emergency: "Emergency safety cascade",
  unreachable: "Unreachable threshold",
  contradiction: "Dose contradiction",
};

export function CaseCard({ caseRow }: { caseRow: CaseCardData }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(caseRow.outcome_note ?? "");

  async function post(url: string, body?: unknown, key?: string) {
    setBusy(key ?? url);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    setBusy(null);
    if (!res.ok) {
      const payload = (await res.json()) as { error?: { message?: string } };
      setError(payload.error?.message ?? "Request failed.");
      return;
    }
    router.refresh();
  }

  const acknowledged = caseRow.acknowledgement_status === "acknowledged";
  const resolved = caseRow.resolution_status === "resolved_reported";
  const allowed = CASE_ACTIONS_BY_CATEGORY[caseRow.category as CaseCategory] ?? [];
  const critical = caseRow.severity >= 3;
  const patient = caseRow.patient;

  return (
    <article
      className={`neo-card overflow-hidden border-l-[6px] ${critical ? "border-l-rose-ink" : "border-l-butter-ink"} shadow-tactile-sm`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-canvas/50 px-4 py-2.5">
        <Badge tone={critical ? "rose" : "butter"}>
          {critical ? "Critical severity" : "High priority"} · SEV-{caseRow.severity}
        </Badge>
        <Badge tone="white">{CATEGORY_LABELS[caseRow.category] ?? caseRow.category}</Badge>
        <span
          suppressHydrationWarning
          className="text-[9.5px] font-semibold tracking-wide text-ink-muted uppercase"
        >
          Detected {formatTime(caseRow.created_at)} · {humanAgo(caseRow.created_at)}
        </span>
        <span className="ml-auto font-display text-[9px] font-bold text-ink-muted">CASE {caseRow.id.slice(0, 8)}</span>
      </div>

      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Avatar name={patient?.display_name ?? "Patient"} size={32} tone={critical ? "rose" : "butter"} />
          <div>
            <div className="flex items-center gap-1.5">
              <Link href={`/patients/${caseRow.patient_id}`} className="text-[12.5px] font-bold hover:underline">
                {patient?.display_name ?? "Patient"}
              </Link>
              {patient?.risk_level ? <Badge tone={patient.risk_level === "high" ? "rose" : "white"}>{patient.risk_level} risk</Badge> : null}
            </div>
            <div className="text-[9.5px] text-ink-muted">
              {patient?.date_of_birth ? `${ageFrom(patient.date_of_birth)} yrs · ` : ""}
              {patient?.mrn ?? "no MRN"}
              {caseRow.assigned_contact ? ` · contact: ${caseRow.assigned_contact}` : ""}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <StatusBadge status={caseRow.status} />
            <Badge tone={critical ? "rose" : "sky"}>{caseRow.category.replaceAll("_", " ")}</Badge>
          </div>
        </div>

        <h3 className="mt-2.5 font-display text-[12.5px] font-bold">
          {CATEGORY_LABELS[caseRow.category] ?? caseRow.category.replaceAll("_", " ")}
        </h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">{caseRow.reason}</p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-canvas px-2.5 py-1.5 text-[9.5px] font-semibold">
          <span className="text-ink-muted">notification</span>
          <span className="font-display text-ink">{caseRow.notification_status}</span>
          <span className="text-ink-muted">· acknowledgement</span>
          <span className="font-display text-ink">{caseRow.acknowledgement_status}</span>
          <span className="text-ink-muted">· resolution</span>
          <span className="font-display text-ink">{caseRow.resolution_status}</span>
          <span className="ml-auto font-display text-[8.5px] text-ink-muted">{caseRow.evidence_reference}</span>
        </div>

        {caseRow.outcome_note ? (
          <p className="mt-2 rounded-lg border border-sage-ink/30 bg-sage px-2.5 py-1.5 text-[10.5px] text-sage-ink">
            <strong>Outcome:</strong> {caseRow.outcome_note}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-2 rounded-lg bg-rose px-2.5 py-1.5 text-[11px] font-semibold text-rose-ink">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line-soft bg-white px-4 py-2.5">
        {caseRow.check_in_id ? (
          <Link href={`/check-ins/${caseRow.check_in_id}`} className="neo-btn h-8 text-[10px]">
            <Icon name="file" size={12} />
            Evidence record
          </Link>
        ) : null}

        {!resolved ? (
          !acknowledged ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => post(`/api/v1/cases/${caseRow.id}/acknowledge`, undefined, "ack")}
              className="neo-btn neo-btn-dark h-8 text-[10px]"
            >
              <Icon name="check" size={12} />
              {busy === "ack" ? "Acknowledging…" : "Acknowledge"}
            </button>
          ) : (
            <>
              {allowed
                .filter((a) => a !== "acknowledge" && a !== "mark_resolved")
                .map((a: CaseActionType) => (
                  <button
                    key={a}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => post(`/api/v1/cases/${caseRow.id}/actions`, { actionType: a }, a)}
                    className="neo-btn h-8 text-[10px]"
                  >
                    <Icon name={a === "contacted_patient" ? "phone" : "arrowRight"} size={12} />
                    {busy === a ? "Working…" : ACTION_LABELS[a] ?? a}
                  </button>
                ))}
              {allowed.includes("mark_resolved") ? (
                <span className="ml-auto flex flex-wrap items-center gap-1.5">
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Outcome note (optional)"
                    className="neo-input h-8 w-52 py-0 text-[11px]"
                  />
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => post(`/api/v1/cases/${caseRow.id}/resolve`, { note }, "resolve")}
                    className="neo-btn neo-btn-sage h-8 text-[10px]"
                  >
                    <Icon name="checkCircle" size={12} />
                    {busy === "resolve" ? "Recording…" : "Mark resolved"}
                  </button>
                </span>
              ) : null}
            </>
          )
        ) : (
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-sage-ink">
            <Icon name="checkCircle" size={13} />
            Case closed with documented outcome
          </span>
        )}
      </div>
    </article>
  );
}
