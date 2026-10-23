"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { Avatar, Badge, type Tone } from "@/components/ui/kit";
import {
  canSubmitTurn,
  formatElapsed,
  phaseDetail,
  phaseLabel,
  type CallLogEntry,
  type CallPhase,
  type MicState,
} from "@/modules/audio/call-state";

const CALLER_LABEL = "AI care coordinator";

function phaseTone(phase: CallPhase): Tone {
  switch (phase) {
    case "listening":
      return "sage";
    case "speaking":
      return "sky";
    case "processing":
    case "requesting_mic":
    case "connecting":
      return "butter";
    case "text_fallback":
      return "sand";
    case "error":
      return "rose";
    default:
      return "white";
  }
}

function speakerLabel(role: CallLogEntry["role"], patientName: string): string {
  if (role === "ai") return CALLER_LABEL;
  if (role === "patient") return patientName;
  if (role === "decision") return "Rule decision";
  return "System";
}

export interface CallStageProps {
  patientName: string;
  languageLabel: string;
  phase: CallPhase;
  micState: MicState;
  micMuted: boolean;
  speakerOn: boolean;
  voiceConfigured: boolean;
  elapsedSeconds: number;
  levels: number[];
  log: CallLogEntry[];
  interim: string;
  error: string | null;
  micError: string | null;
  voiceNote: string | null;
  scenarioLabel: string;
  canStart: boolean;
  checkInId: string | null;
  onStart: () => void;
  onToggleMic: () => void;
  onRetryMic: () => void;
  onToggleSpeaker: () => void;
  onEndCall: () => void;
  onRetryVoice: () => void;
  canRetryVoice: boolean;
  onTypedSubmit: (text: string) => void;
  typedText: string;
  onTypedTextChange: (text: string) => void;
  children?: ReactNode;
}

export function CallStage({
  patientName,
  languageLabel,
  phase,
  micState,
  micMuted,
  speakerOn,
  voiceConfigured,
  elapsedSeconds,
  levels,
  log,
  interim,
  error,
  micError,
  voiceNote,
  scenarioLabel,
  canStart,
  checkInId,
  onStart,
  onToggleMic,
  onRetryMic,
  onToggleSpeaker,
  onEndCall,
  onRetryVoice,
  canRetryVoice,
  onTypedSubmit,
  typedText,
  onTypedTextChange,
  children,
}: CallStageProps) {
  const status = phaseLabel(phase, micMuted, speakerOn);
  const recent = log.slice(-4);
  const bars = levels.length > 0 ? levels : new Array(28).fill(0);
  const micReady = micState === "ready";

  return (
    <section className="overflow-hidden rounded-[28px] border-[1.5px] border-ink bg-ink text-white shadow-tactile">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="butter">
            <Icon name="phone" size={11} /> SIMULATED CALL
          </Badge>
          <span className="text-[9.5px] font-semibold text-white/55">
            no real phone, SMS, or email
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-display text-[15px] tabular-nums text-white/85">
            {formatElapsed(elapsedSeconds)}
          </span>
          <Badge tone={phaseTone(phase)}>{status}</Badge>
        </div>
      </div>

      {phase === "idle" || phase === "ended" || phase === "error" ? (
        <div className="flex flex-col items-center gap-4 px-5 py-10 text-center sm:py-14">
          <div className="relative">
            <Avatar name={patientName} size={76} tone="sage" />
            <span className="absolute -right-2 -bottom-2 flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] border-ink bg-white text-ink">
              <Icon name={phase === "ended" ? "check" : "phone"} size={15} />
            </span>
          </div>
          <div>
            <div className="neo-eyebrow text-white/50">
              {phase === "ended" ? "Completed rehearsal" : "Medication check-in"}
            </div>
            <h2 className="mt-1 font-display text-[22px] font-bold">{patientName}</h2>
            <p className="mt-1 max-w-sm text-[11.5px] leading-relaxed text-white/60">
              {phase === "ended"
                ? "The call is over. Capture is stopped and every turn is available in the evidence trail."
                : `A calm, simulated check-in in ${languageLabel}. ${scenarioLabel}`}
            </p>
          </div>
          {error ? (
            <p role="alert" className="max-w-md rounded-xl border border-rose bg-rose px-3 py-2 text-left text-[11px] font-semibold text-rose-ink">
              {error}
            </p>
          ) : null}
          {micError ? (
            <p role="alert" className="max-w-md rounded-xl border border-butter bg-butter px-3 py-2 text-left text-[11px] font-semibold text-butter-ink">
              {micError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onStart}
            disabled={!canStart}
            className="neo-btn neo-btn-sage h-11 px-5 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="play" size={13} />
            {phase === "ended" ? "Start new simulated call" : "Start simulated call"}
          </button>
          <p className="text-[9.5px] text-white/45">
            Requests microphone access. Nothing is dialed.
          </p>
        </div>
      ) : (
        <div className="px-4 pt-5 pb-4 sm:px-6">
          <div className="flex flex-col items-center text-center">
            <div className="relative">
              <span
                className={`absolute -inset-2 rounded-[26px] border-2 ${
                  phase === "listening" || phase === "speaking"
                    ? "animate-pulse border-sage/45"
                    : "border-transparent"
                }`}
                aria-hidden="true"
              />
              <Avatar name={patientName} size={78} tone="sage" />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              <Badge tone="white">Medication check-in</Badge>
              <Badge tone="white">{languageLabel}</Badge>
              <Badge tone="white">consent on file</Badge>
            </div>
            <h2 className="mt-2 font-display text-[22px] font-bold">{patientName}</h2>
            <p className="mt-0.5 text-[10.5px] text-white/55">Self-reported adherence</p>
            <div className="mt-3 flex items-center gap-2" aria-live="polite">
              <span
                className={`h-2 w-2 rounded-full ${
                  phase === "listening"
                    ? "bg-sage"
                    : phase === "speaking"
                      ? "bg-sky"
                      : "bg-butter"
                }`}
              />
              <span className="text-[11.5px] font-semibold text-white/90">{status}</span>
              <span className="text-[9.5px] text-white/45">{phaseDetail(phase)}</span>
            </div>
          </div>

          <div className="mt-5 flex h-16 items-center justify-center gap-[3px]" aria-hidden="true">
            {bars.map((level, index) => (
              <span
                key={index}
                className={`w-[4px] shrink-0 rounded-full transition-[height] duration-75 ${
                  phase === "speaking" ? "bg-sky" : phase === "processing" ? "bg-butter" : "bg-sage"
                }`}
                style={{ height: `${6 + Math.min(1, Math.max(0, level)) * 54}px` }}
              />
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[8.5px] font-bold tracking-[0.12em] text-white/45 uppercase">
                Live transcript
              </span>
              {checkInId ? (
                <span className="text-[8.5px] text-white/35">session {checkInId.slice(0, 8)}</span>
              ) : null}
            </div>
            <div className="mt-1.5 max-h-44 min-h-24 overflow-y-auto" aria-live="polite">
              {recent.length === 0 && !interim ? (
                <p className="py-3 text-center text-[10.5px] text-white/40">
                  The first sentence will appear here.
                </p>
              ) : (
                <ol className="flex flex-col">
                  {recent.map((entry, index) => (
                    <li
                      key={`${index}-${entry.role}`}
                      className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 border-b border-white/10 py-1.5 last:border-0"
                    >
                      <span className="text-[8px] font-bold tracking-wide text-white/40 uppercase">
                        {speakerLabel(entry.role, patientName)}
                      </span>
                      <span className="text-[10.5px] leading-relaxed text-white/85">{entry.text}</span>
                    </li>
                  ))}
                  {interim ? (
                    <li className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 border-t border-dashed border-white/15 py-1.5">
                      <span className="text-[8px] font-bold tracking-wide text-sage uppercase">
                        {patientName} speaking...
                      </span>
                      <span className="text-[10.5px] leading-relaxed text-sage/90">{interim}</span>
                    </li>
                  ) : null}
                </ol>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={micReady ? onToggleMic : onRetryMic}
              aria-pressed={micMuted}
              aria-label={
                !micReady
                  ? "Retry microphone"
                  : micMuted
                    ? "Unmute microphone"
                    : "Mute microphone"
              }
              className={`neo-btn h-12 w-12 rounded-full p-0 ${
                micMuted || !micReady ? "neo-btn-rose" : ""
              }`}
            >
              <Icon name="mic" size={18} />
            </button>
            <button
              type="button"
              onClick={onToggleSpeaker}
              disabled={!voiceConfigured}
              aria-pressed={!speakerOn}
              aria-label={speakerOn ? "Mute speaker" : "Unmute speaker"}
              className={`neo-btn h-12 w-12 rounded-full p-0 ${!speakerOn ? "neo-btn-rose" : ""}`}
            >
              <Icon name="activity" size={18} />
            </button>
            <button
              type="button"
              onClick={onEndCall}
              className="neo-btn neo-btn-rose h-12 rounded-full px-4 text-[11px]"
              aria-label="End call"
            >
              <Icon name="phoneOff" size={15} />
              End call
            </button>
          </div>
          <p className="mt-2 text-center text-[9px] text-white/40">
            {micReady
              ? micMuted
                ? "Microphone muted. The call stays connected."
                : "Half-duplex: the microphone pauses while the AI speaks."
              : "No microphone. Use the text fallback below."}
          </p>

          {error ? (
            <p role="alert" className="mt-3 rounded-xl border border-rose bg-rose px-3 py-2 text-[10.5px] font-semibold text-rose-ink">
              {error}
            </p>
          ) : null}
          {micError ? (
            <p role="alert" className="mt-2 rounded-xl border border-butter bg-butter px-3 py-2 text-[10.5px] font-semibold text-butter-ink">
              {micError}
            </p>
          ) : null}
          {voiceNote ? <p className="mt-2 text-center text-[9px] text-white/45">{voiceNote}</p> : null}
          {canRetryVoice ? (
            <div className="mt-2 text-center">
              <button type="button" onClick={onRetryVoice} className="text-[9.5px] font-semibold text-sage underline">
                Replay the last reply
              </button>
            </div>
          ) : null}

          <details className="mt-4 rounded-xl border border-white/15 bg-white/[0.04] p-3">
            <summary className="cursor-pointer text-[9.5px] font-bold tracking-wide text-white/60 uppercase">
              Type a reply (fallback)
            </summary>
            <form
              className="mt-2 flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const text = typedText.trim();
                if (text) onTypedSubmit(text);
              }}
            >
              <input
                value={typedText}
                onChange={(event) => onTypedTextChange(event.target.value)}
                placeholder="Type what the patient says"
                aria-label="Type a reply instead"
                disabled={!canSubmitTurn(phase)}
                className="neo-input h-9 min-w-0 flex-1 bg-white text-[11px] text-ink"
              />
              <button
                type="submit"
                disabled={!typedText.trim() || !canSubmitTurn(phase)}
                className="neo-btn h-9 px-3 text-[10px]"
              >
                <Icon name="send" size={12} />
                Send typed reply
              </button>
            </form>
            <p className="mt-1.5 text-[9px] text-white/40">
              Typing stops any playing reply. Evidence records this turn as typed.
            </p>
          </details>

          {children}
        </div>
      )}
    </section>
  );
}
