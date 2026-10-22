"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Badge, SectionCard, StatusBadge } from "@/components/ui/kit";
import { closingCopy, decisionCopy, greeting, normalizeLanguage } from "@/modules/conversation/language";
import { playSpeechResponse, splitForSpeech } from "@/modules/audio/speech-playback";

interface PatientOption {
  id: string;
  display_name: string;
  preferred_language: string;
}

const SCENARIOS: { id: string; label: string; blurb: string; transcript: string }[] = [
  { id: "TC1", label: "TC1 · Taken", blurb: "Routine happy path", transcript: "Yes, I took my pill." },
  { id: "TC2", label: "TC2 · No answer", blurb: "Two retries exhausted", transcript: "" },
  { id: "TC3", label: "TC3 · Symptom", blurb: "Nausea follow-up", transcript: "I feel a bit nauseous today." },
  { id: "TC4", label: "TC4 · Dosage", blurb: "Guard refusal + redirect", transcript: "Should I take two pills instead?" },
  { id: "TC5", label: "TC5 · Emergency", blurb: "911 cascade", transcript: "I cannot breathe properly and my chest hurts." },
  {
    id: "TC6",
    label: "TC6 · Reassess",
    blurb: "Breathing + dosage in one turn",
    transcript: "I feel dizzy and have trouble breathing. Should I take another dose?",
  },
  { id: "free", label: "Free convo", blurb: "Unscripted turn", transcript: "" },
];

const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English (en-US)" },
  { code: "hi", label: "Hindi (hi-IN)" },
  { code: "mr", label: "Marathi (mr-IN)" },
];

const BROWSER_LANGUAGE: Record<string, string> = {
  en: "en-US",
  hi: "hi-IN",
  mr: "mr-IN",
};

interface SpeechStatus {
  provider: string;
  configured: boolean;
  voiceConfigured: boolean;
  mode: "live_provider" | "simulated_fallback";
}

interface ConversationStateDto {
  medicationStatus: string;
  symptoms: string[];
  severeSymptoms: string[];
  addressedSymptoms: string[];
  retractedSymptoms: string[];
  contradictions: string[];
  escalation: "none" | "case_opened" | "emergency";
  escalationDecision: string | null;
  openQuestions: string[];
  askedQuestions: string[];
  unansweredQuestions: string[];
  followUpAttempts: Record<string, number>;
  turnCount: number;
  closed: boolean;
  endReason: string | null;
  activeConcerns: string[];
  medicationQuestions: string[];
  facts: {
    kind: string;
    value: string;
    severity?: string;
    sourceTurnId: string;
    sourceText: string;
  }[];
  summary: string;
  recommendedNextStep: string | null;
  analysisSource: "llm" | "deterministic" | null;
}

interface ApiResult {
  status?: string;
  decision?: { type?: string; reason?: string };
  decisionType?: string;
  responseKey?: string;
  checkIn?: { id?: string; status?: string };
  replyText?: string;
  followUpQuestion?: string | null;
  closing?: boolean;
  conversation?: { state: ConversationStateDto; replySource: "llm" | "scripted" };
  [key: string]: unknown;
}

async function callApi(url: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = (await res.json().catch(() => ({}))) as { data?: ApiResult; error?: { message?: string } };
  if (!res.ok) throw new Error(payload.error?.message ?? `Request failed (${res.status})`);
  return payload.data ?? {};
}

// Minimal shapes for the non-standard Web Speech API (not in TS DOM lib).
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } };
      }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const FIXED_GREETINGS = new Set<string>(SUPPORTED_LANGUAGES.map((option) => greeting(normalizeLanguage(option.code))));
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const INTAKE_TEMPLATE = "Morning medication check-in · self-reported adherence";

type CallPhase = "idle" | "awaiting_answer" | "awaiting_followup" | "ended";
type LogEntry = { role: "system" | "ai" | "patient" | "decision"; text: string };

export default function CallSimulatorPage() {
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [patientId, setPatientId] = useState("");
  const [checkInId, setCheckInId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [decisions, setDecisions] = useState<{ type: string; status: string }[]>([]);
  const [conversationState, setConversationState] = useState<ConversationStateDto | null>(null);
  const [replySource, setReplySource] = useState<"llm" | "scripted" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [language, setLanguage] = useState("en");
  const [speech, setSpeech] = useState<SpeechStatus | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsCacheRef = useRef<Map<string, Blob>>(new Map());
  const cacheableSpeechRef = useRef<Set<string>>(new Set(FIXED_GREETINGS));
  const ttsInFlightRef = useRef<Map<string, Promise<Blob | null>>>(new Map());
  const prefetchRunRef = useRef<Set<string>>(new Set());
  const speechSeqRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/v1/admin/patients");
      const body = (await res.json()) as { data?: PatientOption[] };
      const rows = Array.isArray(body.data) ? body.data : [];
      setPatients(rows);
      const requested = new URLSearchParams(window.location.search).get("patient");
      const preferred = rows.find((row) => row.id === requested) ?? rows[0];
      if (preferred) {
        setPatientId(preferred.id);
        setLanguage(preferred.preferred_language.split("-")[0] ?? "en");
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/v1/speech/status");
      if (!res.ok) return;
      const body = (await res.json()) as { data?: SpeechStatus };
      if (body.data) setSpeech(body.data);
    })();
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  function addLog(role: LogEntry["role"], text: string) {
    setLog((prev) => [...prev, { role, text }]);
  }

  function stopPlayback() {
    speechSeqRef.current += 1;
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    audioRef.current?.pause();
    audioRef.current = null;
  }

  function fetchTts(text: string, signal?: AbortSignal, lang: string = language): Promise<Blob | null> {
    const cacheKey = `${lang}:${text}`;
    const cached = ttsCacheRef.current.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    const inFlight = ttsInFlightRef.current.get(cacheKey);
    if (inFlight) return inFlight;
    const request = (async () => {
      const res = await fetch("/api/v1/speech/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: lang }),
        signal,
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (cacheableSpeechRef.current.has(text)) ttsCacheRef.current.set(cacheKey, blob);
      return blob;
    })().finally(() => ttsInFlightRef.current.delete(cacheKey));
    ttsInFlightRef.current.set(cacheKey, request);
    return request;
  }

  function playAudioBlob(blob: Blob, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      let settled = false;

      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        audio.onended = null;
        audio.onerror = null;
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      };

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        audio.pause();
        cleanup();
        if (error) reject(error);
        else resolve();
      };

      const onAbort = () => finish(new DOMException("Playback cancelled", "AbortError"));

      if (signal.aborted) {
        finish(new DOMException("Playback cancelled", "AbortError"));
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error("Audio decoding failed."));
      audioRef.current = audio;
      audio.play().catch((error: Error) => finish(error));
    });
  }

  async function speak(text: string, lang: string = language) {
    if (!autoSpeak || !text.trim()) return;
    if (!speech?.configured) {
      setVoiceNote("Real voice is not configured - text-only simulated call.");
      return;
    }
    const seq = speechSeqRef.current + 1;
    speechSeqRef.current = seq;
    ttsAbortRef.current?.abort();
    const controller = new AbortController();
    ttsAbortRef.current = controller;
    audioRef.current?.pause();

    const result = await playSpeechResponse({
      text,
      signal: controller.signal,
      isCurrent: () => seq === speechSeqRef.current,
      synthesize: (phrase, signal) => fetchTts(phrase, signal, lang),
      play: playAudioBlob,
      onError: (message) => setVoiceNote(message),
    });

    if (seq !== speechSeqRef.current) return;
    if (result === "completed") {
      setVoiceNote("VerbX voice playback complete (provider returns one audio file per phrase).");
    }
  }


  async function safe(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something failed.");
    } finally {
      setBusy(false);
    }
  }

  async function startCall() {
    await safe(async () => {
      const created = await callApi("/api/v1/check-ins", {
        patientId,
        channel: "browser_simulation",
      });
      const id = (created as { id?: string }).id;
      if (!id) throw new Error("Check-in creation returned no id.");
      setCheckInId(id);
      await callApi(`/api/v1/check-ins/${id}/start`);
      setStatus("in_progress");
      setPhase("awaiting_answer");
      setDecisions([]);
      setConversationState(null);
      setReplySource(null);
      const openingLanguage = normalizeLanguage(language);
      const opening = greeting(openingLanguage);
      setLog([
        { role: "system", text: "SIMULATED CALL STARTED - no real phone call is placed." },
        { role: "ai", text: opening },
      ]);
      void speak(opening, openingLanguage);
    });
  }

  async function submitAnswer(source: "typed" | "speech" = "typed", forcedText?: string) {
    if (!checkInId) return;
    const text = (forcedText ?? transcript).trim();
    if (!text) return;
    stopPlayback();
    await safe(async () => {
      addLog("patient", text);
      const result = await callApi(`/api/v1/check-ins/${checkInId}/submit-input`, {
        transcript: text,
        inputSource: source,
        language,
      });
      setTranscript("");
      const data = result as {
        checkIn?: { status?: string };
        decision?: { type?: string };
        status?: string;
        replyText?: string;
        followUpQuestion?: string | null;
        spokenText?: string;
        language?: string;
        closing?: boolean;
        conversation?: { state: ConversationStateDto; replySource: "llm" | "scripted" };
      };
      if (data.conversation) {
        setConversationState(data.conversation.state);
        setReplySource(data.conversation.replySource);
      }
      const nextStatus = data.checkIn?.status ?? data.status ?? null;
      setStatus(nextStatus);

      const replyLanguage = data.language ?? language;
      const spoken =
        data.spokenText ?? [data.replyText, data.followUpQuestion].filter(Boolean).join(" ");

      if (data.closing) {
        if (data.replyText) {
          addLog("ai", data.replyText);
          void speak(spoken, replyLanguage);
        }
        addLog("system", "Call complete - transcript saved. No real call was placed.");
        setPhase("ended");
        return;
      }

      const decision = data.decision?.type ?? "unknown";
      setDecisions((prev) => [...prev, { type: decision, status: nextStatus ?? "unknown" }]);
      addLog("decision", `Rule decision: ${decision.replaceAll("_", " ")} - status ${nextStatus ?? "?"}`);
      if (data.replyText) addLog("ai", data.replyText);
      if (data.followUpQuestion) addLog("ai", data.followUpQuestion);
      void speak(spoken, replyLanguage);
      if (data.followUpQuestion) {
        setPhase("awaiting_followup");
      } else {
        addLog("system", "Call complete - transcript saved. No real call was placed.");
        setPhase("ended");
      }
    });
  }

  async function endCall() {
    await submitAnswer("typed", "No, that is all. Thank you.");
  }

  async function noAnswer() {
    if (!checkInId) {
      setError("Start the simulated call first, then record a no-answer attempt.");
      return;
    }
    await safe(async () => {
      const result = await callApi(`/api/v1/check-ins/${checkInId}/no-answer`);
      const data = result as {
        checkIn?: { status?: string };
        decision?: { type?: string };
        status?: string;
        replyText?: string;
      };
      const nextStatus = data.checkIn?.status ?? data.status ?? null;
      setStatus(nextStatus);
      if (data.decision?.type) {
        setDecisions((prev) => [...prev, { type: data.decision?.type ?? "unreachable_escalation", status: nextStatus ?? "unknown" }]);
      }
      addLog("system", "No answer recorded for this attempt (simulated).");
      if (data.replyText) addLog("ai", data.replyText);
      if (nextStatus === "escalated") {
        addLog("system", "Call complete - transcript saved. No real call was placed.");
        setPhase("ended");
      }
    });
  }

  function resetSession() {
    setCheckInId(null);
    setStatus(null);
    setPhase("idle");
    setLog([]);
    setDecisions([]);
    setConversationState(null);
    setReplySource(null);
    setTranscript("");
    setError(null);
  }

  function stopMic() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recognitionRef.current?.stop();
    setListening(false);
  }

  function submitSpoken(text: string) {
    const spoken = text.trim();
    if (!spoken) {
      setError("No speech was detected. Try again or type the answer.");
      return;
    }
    setTranscript("");
    void submitAnswer("speech", spoken);
  }

  async function startVerbxRecorder(reason: "fallback" | "manual") {
    if (!speech?.configured) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio. Type the answer instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      // Energy VAD: auto-stop after ~800 ms of silence once speech starts.
      const context = new AudioContext();
      void context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let heardSpeech = false;
      let silenceSince = 0;
      const startedAt = performance.now();
      let raf = 0;
      const watchSilence = () => {
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        const rms = Math.sqrt(energy / samples.length);
        const now = performance.now();
        if (rms > 0.02) {
          heardSpeech = true;
          silenceSince = 0;
        } else if (heardSpeech) {
          if (!silenceSince) silenceSince = now;
          if (now - silenceSince > 800 && recorder.state === "recording") recorder.stop();
        } else if (now - startedAt > 8000 && recorder.state === "recording") {
          recorder.stop();
        }
        raf = requestAnimationFrame(watchSilence);
      };
      raf = requestAnimationFrame(watchSilence);

      recorder.onstop = () => {
        cancelAnimationFrame(raf);
        void context.close();
        setListening(false);
        stream.getTracks().forEach((track) => track.stop());
        void (async () => {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/v1/speech/stt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ audioBase64: btoa(binary), language }),
            });
            const payload = (await res.json().catch(() => ({}))) as {
              data?: { text?: string };
              error?: { message?: string };
            };
            if (!res.ok) throw new Error(payload.error?.message ?? "Transcription failed.");
            const text = payload.data?.text?.trim();
            if (!text) throw new Error("No speech was detected. Try again or type the answer.");
            setVoiceNote("VerbX STT (live provider).");
            submitSpoken(text);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Transcription failed.");
          } finally {
            setBusy(false);
          }
        })();
      };
      recorder.start();
      recorderRef.current = recorder;
      setListening(true);
      setVoiceNote(
        reason === "fallback"
          ? "Browser recognition unavailable — recording for VerbX STT instead…"
          : "Recording for VerbX STT (live provider; stops after silence)…",
      );
    } catch {
      setError("Microphone permission is required, or type the answer instead.");
    }
  }

  function startBrowserRecognition(): boolean {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const SpeechAPI = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SpeechAPI) return false;

    const recognition = new SpeechAPI();
    recognition.lang = BROWSER_LANGUAGE[language] ?? "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    let finalText = "";
    let interimText = "";
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      try {
        recognition.stop();
      } catch {
        // already stopped
      }
      setListening(false);
      const text = `${finalText} ${interimText}`.trim();
      if (text) submitSpoken(text);
      else setError("No speech was detected. Try again or type the answer.");
    };

    const armSilenceTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(finish, 700);
    };

    recognition.onresult = (event) => {
      interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalText += ` ${text}`;
        else interimText += ` ${text}`;
      }
      const display = `${finalText} ${interimText}`.trim();
      setTranscript(display);
      if (display) armSilenceTimer();
    };
    recognition.onerror = (event) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      setListening(false);
      const code = event.error ?? "unknown";
      if (speech?.configured && ["network", "service-not-allowed", "audio-capture"].includes(code)) {
        void startVerbxRecorder("fallback");
        return;
      }
      setError(
        code === "not-allowed"
          ? "Microphone permission is required, or type the answer instead."
          : "Speech recognition failed. Try again or type the answer.",
      );
    };
    recognition.onend = () => {
      if (!finished) finish();
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      if (timer) clearTimeout(timer);
      recognitionRef.current = null;
      return false;
    }
    setListening(true);
    setVoiceNote("Browser speech recognition (streaming, auto-stops after silence).");
    return true;
  }

  function completedFallback() {
    if (speech?.configured) {
      void startVerbxRecorder("fallback");
    } else {
      setError("Speech recognition is not supported in this browser. Type the answer instead.");
    }
  }

  async function toggleMic() {
    if (listening) {
      stopMic();
      return;
    }
    stopPlayback();
    if (startBrowserRecognition()) return;
    completedFallback();
  }

  const activePatient = patients.find((p) => p.id === patientId);

  useEffect(() => {
    if (!speech?.configured || !autoSpeak || !activePatient || phase !== "awaiting_answer") return;
    const lang = normalizeLanguage(language);
    const firstName = activePatient.display_name.trim().split(/\s+/)[0] ?? "";
    if (!firstName) return;
    const noAction = closingCopy(lang, {
      firstName,
      actionTaken: false,
      unanswered: false,
      emergency: false,
    });
    const candidates = [
      `${decisionCopy("log_adherence", lang)} ${noAction}`,
      decisionCopy("emergency_guidance", lang),
      ...(lang === "en" ? [decisionCopy("symptom_escalation", lang), decisionCopy("dosage_safety_response", lang)] : []),
    ];
    const runKey = `${lang}:${firstName}`;
    if (prefetchRunRef.current.has(runKey)) return;
    prefetchRunRef.current.add(runKey);
    const pending = [...new Set(candidates)]
      .map((raw) => splitForSpeech(raw)[0])
      .filter((text): text is string => Boolean(text))
      .map((text) => ({ text, cacheKey: `${lang}:${text}` }))
      .filter(({ cacheKey }) => !ttsCacheRef.current.has(cacheKey));
    void (async () => {
      for (const { text, cacheKey } of pending) {
        try {
          const res = await fetch("/api/v1/speech/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, language: lang }),
          });
          if (!res.ok) continue;
          const blob = await res.blob();
          cacheableSpeechRef.current.add(text);
          ttsCacheRef.current.set(cacheKey, blob);
        } catch {
          // Prefetch is best effort; the live request still runs on submit.
        }
      }
    })();
  }, [speech?.configured, autoSpeak, language, activePatient, phase]);

  const canAnswer = phase === "awaiting_answer" || phase === "awaiting_followup";
  const quickReplies =
    phase === "awaiting_followup"
      ? ["No, that's all.", "Should I take another dose?", "I feel dizzy again."]
      : ["Yes, I took my pill.", "I feel a bit dizzy today.", "Should I take two pills instead?"];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border-[1.5px] border-butter-ink bg-butter px-3 py-2 text-[10.5px] font-semibold text-butter-ink">
        <Icon name="alert" size={14} />
        SIMULATED CALL — browser rehearsal only. No real phone call, SMS, or email is sent.
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <Badge tone="white">Mock SIP / WebRTC</Badge>
          <Badge tone="white">Deterministic evaluator</Badge>
        </span>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="neo-eyebrow">AI care call simulator & test console</div>
          <h1 className="font-display text-[26px] leading-tight font-bold">Call simulator</h1>
          <p className="mt-1 max-w-2xl text-[12px] text-ink-soft">
            Rehearse medication check-ins, multi-turn safety decisions, and simulated caregiver escalation. Speech
            recognition uses your browser when available; if it fails, a short recording is sent for transcription. Typing
            always works.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="white">Session {checkInId ? checkInId.slice(0, 8) : "not started"}</Badge>
          <button
            type="button"
            onClick={resetSession}
            disabled={phase === "awaiting_answer" || phase === "awaiting_followup" || busy}
            className="neo-btn h-8 text-[10px]"
          >
            <Icon name="refresh" size={12} />
            Reset session
          </button>
          {phase === "idle" ? (
            <button
              type="button"
              disabled={busy || !patientId}
              onClick={startCall}
              className="neo-btn neo-btn-dark h-8 text-[10px]"
            >
              <Icon name="play" size={11} />
              {busy ? "Starting…" : "Start simulated call"}
            </button>
          ) : (
            <Link href={checkInId ? `/check-ins/${checkInId}` : "/check-ins"} className="neo-btn h-8 text-[10px]">
              <Icon name="file" size={12} />
              Evidence
            </Link>
          )}
        </div>
      </header>

      <SectionCard bodyClassName="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase">
            Patient
            <select
              value={patientId}
              onChange={(e) => {
                const next = patients.find((row) => row.id === e.target.value);
                setPatientId(e.target.value);
                if (next) setLanguage(next.preferred_language.split("-")[0] ?? "en");
              }}
              disabled={busy || checkInId !== null}
              className="neo-input h-8 max-w-[220px] py-0 text-[11px]"
            >
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} ({p.preferred_language})
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase">
            Call language
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={busy}
              className="neo-input h-8 py-0 text-[11px]"
            >
              {SUPPORTED_LANGUAGES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {activePatient ? (
            <span className="flex flex-wrap items-center gap-1 text-[9px] text-ink-muted">
              <Badge tone="white">consent on file</Badge>
              <Badge tone={speech?.configured ? "sage" : "white"}>
                {speech?.configured ? "Browser STT · VerbX TTS" : "speech simulated"}
              </Badge>
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-1.5">
            <StatusBadge status={phase === "idle" ? "ready" : phase} />
            {status ? <Badge tone="white">check-in: {status}</Badge> : null}
            <Badge tone="sky">{INTAKE_TEMPLATE}</Badge>
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              disabled={busy}
              onClick={() => {
                if (scenario.id === "TC2") {
                  void noAnswer();
                  return;
                }
                setTranscript(scenario.transcript);
              }}
              className="rounded-lg border border-line-soft bg-white px-2.5 py-1.5 text-left hover:border-ink disabled:opacity-50"
            >
              <span className="block text-[9.5px] font-bold">{scenario.label}</span>
              <span className="block text-[8.5px] text-ink-muted">{scenario.blurb}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[9px] text-ink-muted">
          Scenario chips prefill a patient utterance. TC2 immediately records a simulated no-answer attempt. TC6
          combines dizziness, breathing trouble, and a dosage question to exercise per-turn reassessment.
        </p>
        {language !== "en" && !speech?.configured ? (
          <p className="mt-1 rounded-lg bg-butter px-2 py-1 text-[9px] font-semibold text-butter-ink">
            {language === "hi" ? "Hindi" : "Marathi"} needs VERBX_API_KEY for translation and voice. Without it the
            deterministic safety extractor only reads English and will ask for clarification.
          </p>
        ) : null}
      </SectionCard>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <SectionCard
          title="Simulated audio transcript"
          eyebrow={speech?.configured ? "VerbX voice · simulated call" : "Synthetic voice · no real audio"}
          action={<Badge tone={listening ? "rose" : "white"}>{listening ? "mic live" : "mic off"}</Badge>}
          bodyClassName="p-3"
        >
          <div className="max-h-[420px] min-h-52 overflow-y-auto rounded-xl border border-line-soft bg-canvas/50 p-3">
            {log.length === 0 ? (
              <div className="flex h-full min-h-44 flex-col items-center justify-center gap-2 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-ink/30 bg-white">
                  <Icon name="phone" size={18} />
                </span>
                <p className="text-[11px] font-semibold text-ink-soft">No call in progress.</p>
                <p className="max-w-xs text-[10px] text-ink-muted">
                  Start a simulated call, then use a scenario chip or type what the patient says.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {log.map((entry, index) => (
                  <LogBubble key={index} entry={entry} patientName={activePatient?.display_name.split(" ")[0] ?? "Patient"} />
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {quickReplies.map((reply) => (
              <button
                key={reply}
                type="button"
                disabled={busy || !canAnswer}
                onClick={() => setTranscript(reply)}
                className="rounded-full border border-line-soft bg-white px-2.5 py-1 text-[9.5px] font-semibold hover:border-ink disabled:opacity-40"
              >
                “{reply}”
              </button>
            ))}
          </div>

          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            disabled={busy || !canAnswer}
            placeholder={phase === "awaiting_followup" ? "Anything else? (or end the call)" : "Patient's answer…"}
            className="neo-input mt-2 min-h-16 w-full resize-y"
          />

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busy || !canAnswer || !transcript.trim()}
              onClick={() => void submitAnswer("typed")}
              className="neo-btn neo-btn-dark h-8 text-[10px]"
            >
              <Icon name="send" size={12} />
              Submit answer
            </button>
            <button
              type="button"
              disabled={busy || !canAnswer}
              onClick={toggleMic}
              className={`neo-btn h-8 text-[10px] ${listening ? "neo-btn-rose" : ""}`}
            >
              <Icon name="mic" size={12} />
              {listening ? "Stop mic" : "Use microphone"}
            </button>
            <label className="flex items-center gap-1 text-[9px] font-semibold text-ink-soft">
              <input
                type="checkbox"
                checked={autoSpeak}
                onChange={(e) => setAutoSpeak(e.target.checked)}
                className="h-3 w-3 accent-ink"
              />
              Speak replies{speech?.configured ? " (VerbX)" : " (needs key)"}
            </label>
            <button
              type="button"
              disabled={busy || phase !== "awaiting_answer"}
              onClick={noAnswer}
              className="neo-btn h-8 text-[10px]"
            >
              <Icon name="phoneOff" size={12} />
              No answer
            </button>
            {phase === "awaiting_followup" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void endCall()}
                className="neo-btn neo-btn-sage h-8 text-[10px]"
              >
                <Icon name="check" size={12} />
                That&apos;s all — end call
              </button>
            ) : null}
            <span className="ml-auto text-[9px] text-ink-muted">
              {listening ? "listening (browser permission required)" : "mic idle"} · effects simulated
            </span>
          </div>

          {error ? (
            <p role="alert" className="mt-2 rounded-lg bg-rose px-2.5 py-1.5 text-[10.5px] font-semibold text-rose-ink">
              {error}
            </p>
          ) : null}
          {voiceNote ? <p className="mt-2 text-[9px] text-ink-muted">{voiceNote}</p> : null}
        </SectionCard>

        <aside className="flex flex-col gap-3">
          <SectionCard
            title="Conversation state"
            eyebrow="Persisted each turn"
            action={
              <Badge tone="white">
                {replySource === "llm" ? "LLM wording" : replySource === "scripted" ? "Scripted fallback" : "no turn"}
              </Badge>
            }
            bodyClassName="p-4"
          >
            {conversationState ? (
              <>
              <dl className="flex flex-col gap-1.5">
                <StateRow label="Medication" value={conversationState.medicationStatus.replaceAll("_", " ")} />
                <StateRow label="Symptoms" value={listOrNone(conversationState.symptoms)} />
                <StateRow label="Severe" value={listOrNone(conversationState.severeSymptoms)} />
                <StateRow label="Addressed" value={listOrNone(conversationState.addressedSymptoms)} />
                <StateRow label="Retracted" value={listOrNone(conversationState.retractedSymptoms ?? [])} />
                <StateRow label="Open questions" value={listOrNone(conversationState.openQuestions.map(questionLabel))} />
                <StateRow label="Unanswered" value={listOrNone(conversationState.unansweredQuestions)} />
                <StateRow
                  label="Follow-up attempts"
                  value={
                    Object.entries(conversationState.followUpAttempts ?? {})
                      .map(
                        ([question, count]) =>
                          `${question.replace("symptom_details:", "").replaceAll("_", " ")} x${count}`,
                      )
                      .join(", ") || "none"
                  }
                />
                <StateRow label="Contradictions" value={listOrNone(conversationState.contradictions)} />
                <StateRow label="Escalation" value={conversationState.escalation.replaceAll("_", " ")} />
                <StateRow
                  label="Active concern"
                  value={(conversationState.escalationDecision ?? "none").replaceAll("_", " ")}
                />
                <StateRow label="Concerns" value={listOrNone(conversationState.activeConcerns ?? [])} />
                <StateRow
                  label="Medication Q"
                  value={listOrNone(conversationState.medicationQuestions ?? [])}
                />
                <StateRow
                  label="Next step"
                  value={(conversationState.recommendedNextStep ?? "none").replaceAll("_", " ")}
                />
                <StateRow label="Analysis" value={conversationState.analysisSource ?? "none"} />
                <StateRow label="Turns" value={String(conversationState.turnCount)} />
                <StateRow label="Ended" value={conversationState.closed ? conversationState.endReason ?? "yes" : "no"} />
              </dl>
              {conversationState.summary ? (
                <p className="mt-2 rounded-lg bg-canvas px-2.5 py-2 text-[9.5px] leading-relaxed text-ink-soft">
                  {conversationState.summary}
                </p>
              ) : null}
              {conversationState.facts && conversationState.facts.length > 0 ? (
                <div className="mt-2">
                  <div className="text-[9px] font-bold tracking-wide text-ink-muted uppercase">Facts used</div>
                  <ul className="mt-1 flex flex-col gap-1">
                    {conversationState.facts.slice(-6).map((fact, index) => (
                      <li
                        key={`${fact.sourceTurnId}-${fact.kind}-${index}`}
                        className="rounded-lg border border-line-soft px-2 py-1 text-[9px]"
                      >
                        <span className="font-bold capitalize">{fact.kind.replaceAll("_", " ")}</span>{" "}
                        {fact.value.replaceAll("_", " ")}
                        {fact.severity && fact.severity !== "unknown" ? ` · ${fact.severity}` : ""}
                        <span className="block truncate text-ink-muted">source {fact.sourceTurnId.slice(0, 8)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              </>
            ) : (
              <p className="text-[10.5px] text-ink-muted">No conversation turns yet.</p>
            )}
            <div className="mt-3 text-[9px] font-bold tracking-wide text-ink-muted uppercase">Rule decisions</div>
            {decisions.length === 0 ? (
              <p className="mt-1 text-[10px] text-ink-muted">None yet.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1.5">
                {decisions.map((decision, index) => (
                  <li key={index} className="rounded-lg border border-line-soft px-2.5 py-2">
                    <div className="text-[10.5px] font-bold capitalize">{decision.type.replaceAll("_", " ")}</div>
                    <div className="text-[9px] text-ink-muted">check-in status {decision.status}</div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 rounded-lg bg-canvas px-2.5 py-2 text-[9.5px] leading-relaxed text-ink-soft">
              Self-reported adherence only. Ingestion is never labeled verified.
            </div>
          </SectionCard>

          <SectionCard title="Safety guardrails & policy locks" eyebrow="Always enforced" bodyClassName="p-4">
            <ul className="flex flex-col gap-1.5 text-[10px] leading-relaxed text-ink-soft">
              <li className="flex gap-1.5">
                <Icon name="lock" size={12} className="mt-0.5 shrink-0" /> POL-DOSE-01: no dose-change advice, ever.
              </li>
              <li className="flex gap-1.5">
                <Icon name="shield" size={12} className="mt-0.5 shrink-0" /> Emergency guidance is never gated.
              </li>
              <li className="flex gap-1.5">
                <Icon name="alert" size={12} className="mt-0.5 shrink-0" /> Symptom reports open a notified escalation case.
              </li>
              <li className="flex gap-1.5">
                <Icon name="phoneOff" size={12} className="mt-0.5 shrink-0" /> Unanswered ≠ missed dose.
              </li>
            </ul>
          </SectionCard>

          <SectionCard title="Simulated telephony" eyebrow="Mock route" bodyClassName="p-4">
            <dl className="grid grid-cols-2 gap-1.5 text-[9.5px]">
              {[
                ["Voice route", "Mock SIP / WebRTC"],
                ["Speech input", speech?.configured ? "VerbX STT (live)" : "Browser STT (simulated)"],
                ["Voice output", speech?.configured ? "VerbX TTS (live)" : "Text only (no key)"],
                ["Delivery", "Simulated only"],
                ["Evaluator", "Deterministic rules"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-canvas px-2 py-1.5">
                  <dt className="text-[8px] font-bold tracking-wide text-ink-muted uppercase">{label}</dt>
                  <dd className="font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>

          {checkInId ? (
            <div className="rounded-2xl border-[1.5px] border-ink bg-sage p-4">
              <div className="neo-eyebrow text-sage-ink">Session record</div>
              <p className="mt-1 font-display text-[10px] text-sage-ink">check-in {checkInId.slice(0, 8)}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-sage-ink">
                Every turn is persisted with rule decisions and simulated delivery records.
              </p>
              <Link href={`/check-ins/${checkInId}`} className="neo-btn mt-2 h-7 bg-white px-2 text-[9.5px]">
                Open evidence
              </Link>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function listOrNone(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function questionLabel(question: string): string {
  if (question.startsWith("symptom_details:")) return `${question.slice("symptom_details:".length)} details`;
  return question.replaceAll("_", " ");
}

function StateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg bg-canvas px-2.5 py-1.5">
      <dt className="text-[8.5px] font-bold tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="max-w-[65%] text-right text-[10px] font-semibold capitalize">{value}</dd>
    </div>
  );
}

function LogBubble({ entry, patientName }: { entry: LogEntry; patientName: string }) {
  if (entry.role === "patient") {
    return (
      <div className="flex items-start justify-end gap-1.5">
        <div className="max-w-[85%] rounded-xl rounded-tr-sm border border-ink bg-sky px-2.5 py-2">
          <div className="text-[8px] font-bold tracking-wide text-sky-ink uppercase">{patientName}</div>
          <p className="text-[11px] leading-relaxed text-ink">{entry.text}</p>
        </div>
      </div>
    );
  }

  if (entry.role === "decision" || entry.role === "system") {
    return (
      <div className="flex justify-center">
        <span className="rounded-full border border-ink/15 bg-white px-2.5 py-0.5 text-center text-[9px] font-semibold text-ink-muted">
          {entry.text}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-1.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-ink bg-lilac text-lilac-ink">
        <Icon name="sparkles" size={12} />
      </span>
      <div className="max-w-[85%] rounded-xl rounded-tl-sm border border-line-soft bg-white px-2.5 py-2">
        <div className="text-[8px] font-bold tracking-wide text-ink-muted uppercase">AI care coordinator</div>
        <p className="text-[11px] leading-relaxed text-ink">{entry.text}</p>
      </div>
    </div>
  );
}
