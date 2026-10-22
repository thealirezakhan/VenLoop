import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceExportButton } from "@/components/evidence-export-button";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/ui/icon";
import { Badge, EmptyState, SectionCard, StatusBadge, statusTone } from "@/components/ui/kit";
import { formatDateTime, formatTime } from "@/lib/format";

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-1 overflow-x-auto rounded-lg bg-canvas p-2 text-[10px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * Shared check-in evidence console — rendered by both the caregiver shell
 * (`/check-ins/[id]`) and the admin shell (`/admin/check-ins/[id]`) so the
 * evidence view is available in each shell's own navigation context.
 */
export async function EvidenceConsole({ id, backHref, backLabel }: { id: string; backHref: string; backLabel: string }) {
  const supabase = await createClient();

  const { data: checkIn } = await supabase.from("check_ins").select("*").eq("id", id).single();
  if (!checkIn) notFound();

  const [conversation, stateRow, decisions, actions, attempts, verifications, cases] = await Promise.all([
    supabase.from("conversation_records").select("*").eq("check_in_id", id).order("created_at"),
    supabase.from("conversation_states").select("*").eq("check_in_id", id).maybeSingle(),
    supabase.from("decisions").select("*").eq("check_in_id", id).order("created_at"),
    supabase.from("actions").select("*").eq("check_in_id", id).order("created_at"),
    supabase.from("call_attempts").select("*").eq("check_in_id", id).order("attempt_number"),
    supabase.from("verification_records").select("*").eq("check_in_id", id).order("verified_at"),
    supabase.from("escalation_cases").select("*").eq("check_in_id", id).order("created_at"),
  ]);

  const recordIds = (conversation.data ?? []).map((c) => c.id as string);
  const { data: signals } = recordIds.length
    ? await supabase.from("extracted_signals").select("*").in("conversation_record_id", recordIds)
    : { data: [] };

  const actionIds = (actions.data ?? []).map((a) => a.id as string);
  const { data: notifications } = actionIds.length
    ? await supabase.from("notification_events").select("*").in("action_id", actionIds)
    : { data: [] };

  const caseRows = cases.data ?? [];
  const openCases = caseRows.filter((c) => c.resolution_status !== "resolved_reported");
  const state = (stateRow.data?.state ?? {}) as {
    symptoms?: string[];
    severeSymptoms?: string[];
    addressedSymptoms?: string[];
    retractedSymptoms?: string[];
    openQuestions?: string[];
    askedQuestions?: string[];
    unansweredQuestions?: string[];
    followUpAttempts?: Record<string, number>;
    activeConcerns?: string[];
    medicationQuestions?: string[];
    facts?: { kind: string; value: string; severity?: string; sourceTurnId: string; sourceText: string }[];
    summary?: string;
    recommendedNextStep?: string | null;
    analysisSource?: string | null;
    turnCount?: number;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-ink-muted">
        <Link href={backHref} className="hover:underline">
          {backLabel}
        </Link>
        <Icon name="chevronRight" size={11} />
        <span className="text-ink">Evidence</span>
      </div>

      <header className="neo-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border-[1.5px] border-ink bg-sky">
            <Icon name="file" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="neo-eyebrow">Check-in evidence</div>
            <h1 className="font-display text-[22px] leading-tight font-bold">Check-in evidence</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={checkIn.status} />
              <Badge tone="white">{checkIn.channel.replaceAll("_", " ")}</Badge>
              <Badge tone={checkIn.execution_mode === "simulated" ? "sky" : "rose"}>{checkIn.execution_mode}</Badge>
              <span className="text-[9.5px] text-ink-muted">{formatDateTime(checkIn.created_at)}</span>
            </div>
          </div>
          <EvidenceExportButton checkInId={checkIn.id} />
        </div>
        <div className="grid gap-px border-t-[1.5px] border-ink bg-ink/10 sm:grid-cols-4">
          {[
            ["Record id", checkIn.id.slice(0, 8)],
            ["Started", formatTime(checkIn.started_at)],
            ["Completed", formatTime(checkIn.completed_at)],
            ["Open cases", `${openCases.length}`],
          ].map(([label, value]) => (
            <div key={label} className="bg-white px-3 py-2">
              <div className="text-[8.5px] font-bold tracking-wider text-ink-muted uppercase">{label}</div>
              <div className="font-display text-[11px] font-semibold">{value}</div>
            </div>
          ))}
        </div>
        {openCases.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t-[1.5px] border-rose-ink/30 bg-rose px-4 py-2.5 text-[10.5px] font-semibold text-rose-ink">
            <Icon name="alert" size={14} />
            Escalation case opened · {openCases[0].category.replaceAll("_", " ")} · SEV-{openCases[0].severity}
            <Link href="/cases" className="ml-auto underline">
              Open triage
            </Link>
          </div>
        ) : null}
      </header>

      <SectionCard
        title="Cumulative conversation state"
        eyebrow="Merged across turns · facts keep their source turn"
        bodyClassName="p-4"
      >
        {!stateRow.data ? (
          <EmptyState>No conversation state recorded.</EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Active concerns", (state.activeConcerns ?? []).join(", ") || "none"],
                ["Active symptoms", (state.symptoms ?? []).join(", ") || "none"],
                ["Addressed", (state.addressedSymptoms ?? []).join(", ") || "none"],
                ["Retracted", (state.retractedSymptoms ?? []).join(", ") || "none"],
                ["Unanswered questions", `${(state.unansweredQuestions ?? []).length}`],
                ["Medication questions", (state.medicationQuestions ?? []).join(", ") || "none"],
                ["Next step", (state.recommendedNextStep ?? "none").replaceAll("_", " ")],
                ["Analysis source", state.analysisSource ?? "none"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-canvas px-2.5 py-2">
                  <div className="text-[8.5px] font-bold tracking-wider text-ink-muted uppercase">{label}</div>
                  <div className="text-[10.5px] font-semibold capitalize">{value}</div>
                </div>
              ))}
            </div>
            {state.summary ? (
              <p className="rounded-lg border border-line-soft px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-soft">
                {state.summary}
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-canvas px-2.5 py-2">
                <div className="text-[8.5px] font-bold tracking-wider text-ink-muted uppercase">
                  Open questions
                </div>
                <div className="text-[10px]">
                  {(state.openQuestions ?? []).join(", ") || "none"}
                </div>
              </div>
              <div className="rounded-lg bg-canvas px-2.5 py-2">
                <div className="text-[8.5px] font-bold tracking-wider text-ink-muted uppercase">
                  Asked questions
                </div>
                <div className="text-[10px]">
                  {(state.askedQuestions ?? []).join(", ") || "none"}
                </div>
              </div>
              <div className="rounded-lg bg-canvas px-2.5 py-2">
                <div className="text-[8.5px] font-bold tracking-wider text-ink-muted uppercase">
                  Follow-up attempts
                </div>
                <div className="text-[10px]">
                  {Object.entries(state.followUpAttempts ?? {})
                    .map(([question, count]) => `${question}: ${count}`)
                    .join(", ") || "none"}
                </div>
              </div>
              <div className="rounded-lg bg-canvas px-2.5 py-2">
                <div className="text-[8.5px] font-bold tracking-wider text-ink-muted uppercase">
                  Unanswered
                </div>
                <div className="text-[10px]">
                  {(state.unansweredQuestions ?? []).join("; ") || "none"}
                </div>
              </div>
            </div>
            {(state.facts ?? []).length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {(state.facts ?? []).map((fact, index) => (
                  <li
                    key={`${fact.sourceTurnId}-${fact.kind}-${index}`}
                    className="rounded-lg border border-line-soft px-2 py-1 text-[9.5px]"
                  >
                    <span className="font-bold capitalize">{fact.kind.replaceAll("_", " ")}</span>:{" "}
                    {fact.value.replaceAll("_", " ")}
                    {fact.severity && fact.severity !== "unknown" ? ` (${fact.severity})` : ""}
                    <span className="ml-1 text-ink-muted">· turn {fact.sourceTurnId.slice(0, 8)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Original transcript" eyebrow="Immutable input; model interpretation is labelled separately" bodyClassName="p-4">
          {(conversation.data ?? []).length === 0 ? (
            <EmptyState>No conversation recorded.</EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              {(conversation.data ?? []).map((c) => (
                <div key={c.id}>
                  <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-semibold text-ink-muted uppercase">
                    <Badge tone="white">{c.input_source}</Badge>
                    <Badge tone={c.analysis_source === "llm" ? "sky" : "white"}>
                      analysis {c.analysis_source ?? "none"}
                    </Badge>
                    <span>detected {c.language_detected ?? "?"}</span>
                    <span>configured {c.language_configured ?? "?"}</span>
                    <span className="ml-auto">{formatDateTime(c.created_at)}</span>
                  </div>
                  <blockquote className="mt-1 border-l-2 border-ink/25 pl-2 text-[11.5px] leading-relaxed text-ink-soft italic">
                    “{c.original_transcript}”
                  </blockquote>
                  {c.normalized_transcript && c.normalized_transcript !== c.original_transcript ? (
                    <p className="mt-1 pl-2 text-[9.5px] text-ink-muted">
                      Normalized for extraction: {c.normalized_transcript}
                    </p>
                  ) : null}
                  {c.agent_reply ? (
                    <p className="mt-1.5 pl-2 text-[11.5px] leading-relaxed text-ink">
                      <span className="font-semibold">Agent:</span> {c.agent_reply}
                    </p>
                  ) : null}
                  {c.follow_up_question ? (
                    <p className="mt-1 pl-2 text-[11.5px] leading-relaxed text-ink-soft">
                      <span className="font-semibold">Follow-up:</span> {c.follow_up_question}
                    </p>
                  ) : null}
                  {c.analysis ? (
                    <details className="mt-1 pl-2">
                      <summary className="cursor-pointer text-[9px] font-semibold text-ink-muted uppercase">
                        Turn analysis ({c.analysis_source ?? "deterministic"})
                      </summary>
                      <JsonBlock value={c.analysis} />
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Extracted signals" eyebrow="Deterministic extraction · facts keep source turns" bodyClassName="p-4">
          {(signals ?? []).length === 0 ? (
            <EmptyState>No extracted signals.</EmptyState>
          ) : (
            <div className="flex flex-col gap-2">
              {(signals ?? []).map((s) => (
                <details key={s.id} className="rounded-lg border border-line-soft px-3 py-2">
                  <summary className="cursor-pointer text-[10.5px] font-bold">
                    adherence: {s.adherence_status} · symptoms:{" "}
                    {Array.isArray(s.symptoms) && s.symptoms.length > 0 ? s.symptoms.join(", ") : "none"} · dosage
                    question: {String(s.dosage_question)} · emergency: {String(s.emergency)} · clarification:{" "}
                    {String(s.needs_clarification)}
                  </summary>
                  {(s.facts as { kind?: string; value?: string }[] | null)?.length ? (
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {(s.facts as { kind?: string; value?: string }[]).map((fact, index) => (
                        <li
                          key={`${s.id}-${index}`}
                          className="rounded border border-line-soft px-1.5 py-0.5 text-[9px] font-semibold"
                        >
                          {(fact.kind ?? "fact").replaceAll("_", " ")}: {(fact.value ?? "").replaceAll("_", " ")}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <JsonBlock value={s} />
                </details>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Decisions" eyebrow="Deterministic authority; not model interpretation" bodyClassName="p-4">
          {(decisions.data ?? []).length === 0 ? (
            <EmptyState>No decisions recorded.</EmptyState>
          ) : (
            <div className="flex flex-col gap-2.5">
              {(decisions.data ?? []).map((d) => (
                <div key={d.id} className="rounded-xl border border-line-soft border-l-4 border-l-sky-ink px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11.5px] font-bold">{d.decision_type.replaceAll("_", " ")}</span>
                    <Badge tone="white">rules {d.rule_set_version}</Badge>
                    <span className="ml-auto text-[9px] text-ink-muted">{formatDateTime(d.created_at)}</span>
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-ink-soft">{d.decision_reason}</p>
                  <div className="mt-1 font-display text-[8.5px] text-ink-muted">{d.input_evidence_reference}</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Call attempts" eyebrow="Simulated telephony" bodyClassName="p-4">
          {(attempts.data ?? []).length === 0 ? (
            <EmptyState>No call attempts.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {(attempts.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-lg bg-canvas px-2.5 py-2 text-[10.5px]">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-ink bg-white font-display text-[9px] font-bold">
                    {a.attempt_number}
                  </span>
                  <span className="font-semibold">{a.outcome.replaceAll("_", " ")}</span>
                  <Badge tone="sky">{a.execution_mode}</Badge>
                  <span className="ml-auto text-[9px] text-ink-muted">{formatDateTime(a.started_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Actions & delivery" eyebrow="Never claims real effects" bodyClassName="p-4">
          {(actions.data ?? []).length === 0 ? (
            <EmptyState>No actions proposed.</EmptyState>
          ) : (
            <div className="flex flex-col gap-2">
              {(actions.data ?? []).map((a) => (
                <div key={a.id} className="rounded-xl border border-line-soft px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold">{a.action_type.replaceAll("_", " ")}</span>
                    <StatusBadge status={a.status} />
                    <Badge tone="sky">{a.execution_mode}</Badge>
                    <span className="ml-auto text-[9px] text-ink-muted">attempts {a.attempt_count}</span>
                  </div>
                  <div className="mt-1 text-[9px] text-ink-muted">
                    notifications (simulated):{" "}
                    <span className="font-semibold text-ink-soft">
                      {(notifications ?? [])
                        .filter((n) => n.action_id === a.id)
                        .map((n) => `${n.provider_name}=${n.status}`)
                        .join(", ") || "none"}
                    </span>
                  </div>
                  <div className="mt-0.5 font-display text-[8px] text-ink-muted">idempotency {a.idempotency_key}</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Verification" eyebrow="Expected vs observed" bodyClassName="p-4">
          {(verifications.data ?? []).length === 0 ? (
            <EmptyState>No verification records.</EmptyState>
          ) : (
            <div className="flex flex-col gap-2">
              {(verifications.data ?? []).map((v) => (
                <div key={v.id} className="rounded-xl border border-line-soft px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[10.5px]">
                    <Badge tone={statusTone(v.result)}>{v.result}</Badge>
                    <span className="font-semibold">{v.verification_type.replaceAll("_", " ")}</span>
                    <span className="ml-auto text-[9px] text-ink-muted">{formatDateTime(v.verified_at)}</span>
                  </div>
                  <JsonBlock value={{ expected: v.expected_state, observed: v.observed_state }} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Escalation cases" eyebrow="Linked follow-up" bodyClassName="p-4">
        {caseRows.length === 0 ? (
          <EmptyState>No escalation cases for this check-in.</EmptyState>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {caseRows.map((c) => (
              <div key={c.id} className={`rounded-xl border border-line-soft border-l-4 px-3 py-2 ${c.severity >= 3 ? "border-l-rose-ink bg-rose/40" : "border-l-butter-ink bg-butter/30"}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-bold capitalize">{c.category.replaceAll("_", " ")}</span>
                  <Badge tone={c.severity >= 3 ? "rose" : "butter"}>SEV-{c.severity}</Badge>
                  <span className="ml-auto font-display text-[8.5px] text-ink-muted">{c.id.slice(0, 8)}</span>
                </div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-ink-soft">{c.reason}</p>
                <div className="mt-1 flex flex-wrap gap-1 text-[8.5px] font-semibold text-ink-muted uppercase">
                  <span>
                    action{" "}
                    {((actions.data ?? []).find((a) => a.id === c.action_id)?.status as string | undefined) ??
                      "unknown"}
                  </span>
                  <span>· notification {c.notification_status}</span>
                  <span>· ack {c.acknowledgement_status}</span>
                  <span>· resolution {c.resolution_status.replaceAll("_", " ")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
