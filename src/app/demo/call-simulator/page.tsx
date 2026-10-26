"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CallStage } from "@/components/demo/call-stage";
import { Icon } from "@/components/ui/icon";
import { Badge, PageHeader, SectionCard } from "@/components/ui/kit";
import {
  canSubmitTurn,
  isCallLive,
  type CallLogEntry,
  type CallPhase,
  type MicState,
} from "@/modules/audio/call-state";
import { splitForSpeech } from "@/modules/audio/speech-playback";
import {
  computeRms,
  joinTranscript,
  VoiceActivityDetector,
} from "@/modules/audio/voice-activity";
import { closingCopy, decisionCopy, greeting, normalizeLanguage } from "@/modules/conversation/language";
import { resolveSttProvider, type SttSelection } from "@/modules/providers/speech";

interface PatientOption {
  id: string;
  display_name: string;
  preferred_language: string;
}

type ScenarioKind = "live" | "line" | "no_answer";

const SCENARIOS: {
  id: string;
  label: string;
  blurb: string;
  transcript: string;
  kind: ScenarioKind;
}[] = [
  { id: "live", label: "Live microphone", blurb: "Speak naturally", transcript: "", kind: "live" },
  { id: "TC1", label: "TC1 - Taken", blurb: "Routine happy path", transcript: "Yes, I took my pill.", kind: "line" },
  { id: "TC2", label: "TC2 - No answer", blurb: "Two retries exhausted", transcript: "", kind: "no_answer" },
  { id: "TC3", label: "TC3 - Symptom", blurb: "Nausea follow-up", transcript: "I feel a bit nauseous today.", kind: "line" },
  { id: "TC4", label: "TC4 - Dosage", blurb: "Guard refusal + redirect", transcript: "Should I take two pills instead?", kind: "line" },
  { id: "TC5", label: "TC5 - Emergency", blurb: "911 cascade", transcript: "I cannot breathe properly and my chest hurts.", kind: "line" },
  {
    id: "TC6",
    label: "TC6 - Reassess",
    blurb: "Breathing + dosage in one turn",
    transcript: "I feel dizzy and have trouble breathing. Should I take another dose?",
    kind: "line",
  },
  { id: "free", label: "Free convo", blurb: "Unscripted live turn", transcript: "", kind: "live" },
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

const SUGGESTED_REPLIES = [
  "Yes, I took my medicine this morning.",
  "I feel a bit nauseous today.",
  "Should I take two pills instead?",
  "I cannot breathe properly.",
];

const LEVEL_BARS = 28;
const SILENCE_MS = 2_500;
const RECOGNITION_RESTART_MS = 300;
const BARGE_GRACE_MS = 500;
const BARGE_HOLD_MS = 240;
const BARGE_THRESHOLD = 0.11;

interface SpeechStatus {
  provider: string;
  configured: boolean;
  sttConfigured: boolean;
  voiceConfigured: boolean;
  mode: "live_provider" | "simulated_fallback";
  sttSelection: SttSelection;
  sttProvider: "browser" | "groq" | "verbx";
  ttsProvider: "verbx" | "text";
}

function sttLabel(provider: SpeechStatus["sttProvider"]): string {
  if (provider === "groq") return "Groq Whisper STT";
  if (provider === "verbx") return "VerbX batch STT";
  return "Browser STT";
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
  spokenText?: string;
  language?: string;
  closing?: boolean;
  conversation?: { state: ConversationStateDto; replySource: "llm" | "scripted" };
  [key: string]: unknown;
}

interface TurnRecordResult {
  spoken: string;
  replyLanguage: string;
  endAfter: boolean;
}

interface MicSession {
  stream: MediaStream;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  readLevel: () => number;
  stop: () => void;
}

interface FallbackSession {
  recorder: MediaRecorder;
  chunks: Blob[];
  vad: VoiceActivityDetector;
  heardSpeech: boolean;
  stopping: boolean;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult:
    | ((event: {
        resultIndex: number;
        results: {
          length: number;
          [index: number]: { isFinal: boolean; [index: number]: { transcript: string } };
        };
      }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const INPUT_STATUSES = new Set([
  "in_progress",
  "awaiting_clarification",
  "escalated",
  "awaiting_approval",
]);

async function callApi(url: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    data?: ApiResult;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(payload.error?.message ?? `Request failed (${res.status})`);
  return payload.data ?? {};
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Something failed.";
}

function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone permission was denied. Allow microphone access in your browser, then click Retry microphone.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found. Connect a microphone, then click Retry microphone.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The microphone is busy or unavailable. Close other apps using it, then retry.";
  }
  if (name === "OverconstrainedError") {
    return "The microphone does not support the requested audio settings. Try a different device.";
  }
  return formatError(error);
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function getUserMediaWithTimeout(
  constraints: MediaStreamConstraints,
  timeoutMs: number,
): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      reject(new Error("This browser cannot access a microphone."));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Microphone permission timed out. Allow access and retry."));
    }, timeoutMs);

    navigator.mediaDevices.getUserMedia(constraints).then(
      (stream) => {
        if (settled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(stream);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function requestMicrophoneStream(): Promise<MediaStream> {
  try {
    return await getUserMediaWithTimeout(
      {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      },
      12_000,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "OverconstrainedError") {
      return getUserMediaWithTimeout({ audio: true }, 12_000);
    }
    throw error;
  }
}

export default function CallSimulatorPage() {
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [patientId, setPatientId] = useState("");
  const [checkInId, setCheckInId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [phase, setPhaseState] = useState<CallPhase>("idle");
  const [log, setLog] = useState<CallLogEntry[]>([]);
  const [interim, setInterim] = useState("");
  const [levels, setLevels] = useState<number[]>(() => new Array(LEVEL_BARS).fill(0));
  const [elapsed, setElapsed] = useState(0);
  const [decisions, setDecisions] = useState<{ type: string; status: string }[]>([]);
  const [conversationState, setConversationState] = useState<ConversationStateDto | null>(null);
  const [replySource, setReplySource] = useState<"llm" | "scripted" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [micState, setMicState] = useState<MicState>("off");
  const [micMuted, setMicMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState("en");
  const [demoMode, setDemoMode] = useState<"live" | "turn">("live");
  const [speech, setSpeech] = useState<SpeechStatus | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState("live");
  const [typedText, setTypedText] = useState("");
  const [lastSpoken, setLastSpoken] = useState<{ text: string; lang: string } | null>(null);
  const [latency, setLatency] = useState<{
    replyMs: number;
    firstAudioMs: number | null;
    resumedMs: number;
  } | null>(null);

  const mountedRef = useRef(true);
  const callEpochRef = useRef(0);
  const callActiveRef = useRef(false);
  const startingRef = useRef(false);
  const phaseRef = useRef<CallPhase>("idle");
  const checkInRef = useRef<string | null>(null);
  const statusRef = useRef<string | null>(null);
  const languageRef = useRef("en");
  const demoModeRef = useRef<"live" | "turn">("live");
  const speechRef = useRef<SpeechStatus | null>(null);
  const micMutedRef = useRef(false);
  const speakerOnRef = useRef(true);
  const scenarioRef = useRef("live");
  const startedAtRef = useRef<number | null>(null);
  const endingRef = useRef(false);
  const finalTurnSentRef = useRef(false);
  const submittingRef = useRef(false);
  const submitInFlightRef = useRef<Promise<void> | null>(null);
  const turnSeqRef = useRef(0);
  const endingAfterSpeechRef = useRef(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const micRef = useRef<MicSession | null>(null);
  const levelRafRef = useRef(0);
  const levelHistoryRef = useRef<number[]>(new Array(LEVEL_BARS).fill(0));
  const bargeSinceRef = useRef(0);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  const playbackSamplesRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const playResolveRef = useRef<(() => void) | null>(null);
  const speechStartedAtRef = useRef(0);
  const lastLevelRenderRef = useRef(0);
  const turnStartedAtRef = useRef(0);
  const replyReceivedAtRef = useRef(0);
  const firstAudioAtRef = useRef(0);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recognitionGenRef = useRef(0);
  const recognitionWantedRef = useRef(false);
  const recognitionUnavailableRef = useRef(false);
  const batchUnavailableRef = useRef(false);
  const batchRetryBlockedRef = useRef(false);
  const useFallbackRef = useRef(false);
  const ignoreEndRef = useRef(false);
  const finalTextRef = useRef("");
  const interimTextRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishingUtteranceRef = useRef(false);
  const fallbackRef = useRef<FallbackSession | null>(null);
  const fallbackVadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsControllersRef = useRef<Set<AbortController>>(new Set());
  const ttsCacheRef = useRef<Map<string, Blob>>(new Map());
  const ttsInFlightRef = useRef<Map<string, Promise<Blob | null>>>(new Map());
  const prefetchRunRef = useRef<Set<string>>(new Set());
  const speechSeqRef = useRef(0);
  const lastSpokenRef = useRef<{ text: string; lang: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const cleanupRef = useRef<() => void>(() => {});

  function setPhase(next: CallPhase) {
    phaseRef.current = next;
    if (mountedRef.current) setPhaseState(next);
  }

  function setCheckInSafe(id: string | null) {
    checkInRef.current = id;
    if (mountedRef.current) setCheckInId(id);
  }

  function setStatusSafe(next: string | null) {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }

  function setMicStateSafe(next: MicState) {
    if (mountedRef.current) setMicState(next);
  }

  function setLanguageSafe(next: string) {
    languageRef.current = next;
    if (mountedRef.current) setLanguage(next);
  }

  function setDemoModeSafe(next: "live" | "turn") {
    demoModeRef.current = next;
    if (mountedRef.current) setDemoMode(next);
  }

  function setMicMutedSafe(next: boolean) {
    micMutedRef.current = next;
    if (mountedRef.current) setMicMuted(next);
  }

  function setSpeakerOnSafe(next: boolean) {
    speakerOnRef.current = next;
    if (mountedRef.current) setSpeakerOn(next);
  }

  function selectScenario(id: string) {
    scenarioRef.current = id;
    if (mountedRef.current) setSelectedScenarioId(id);
  }

  function addLog(role: CallLogEntry["role"], text: string) {
    if (!mountedRef.current) return;
    setLog((prev) => [...prev, { role, text }]);
  }

  useEffect(() => {
    mountedRef.current = true;
    cleanupRef.current = () => {
      callEpochRef.current += 1;
      callActiveRef.current = false;
      stopRecognitionInternal();
      stopFallbackInternal();
      stopPlaybackInternal();
      stopMicrophoneInternal();
      closeAudioContext();
    };
    return () => {
      mountedRef.current = false;
      cleanupRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    speechRef.current = speech;
  }, [speech]);

  useEffect(() => {
    const recover = () => {
      if (
        callActiveRef.current &&
        phaseRef.current === "listening" &&
        !micMutedRef.current &&
        !recognitionRef.current &&
        !fallbackRef.current &&
        micRef.current
      ) {
        void startListening(callEpochRef.current);
      }
    };
    const id = setInterval(recover, 4_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") recover();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v1/admin/patients");
        if (!res.ok) throw new Error("Could not load patients.");
        const body = (await res.json()) as { data?: PatientOption[] };
        const rows = Array.isArray(body.data) ? body.data : [];
        if (!mountedRef.current) return;
        setPatients(rows);
        const requested = new URLSearchParams(window.location.search).get("patient");
        const preferred = rows.find((row) => row.id === requested) ?? rows[0];
        if (preferred) {
          setPatientId(preferred.id);
          setLanguageSafe(preferred.preferred_language.split("-")[0] ?? "en");
        } else {
          setError("No patients are available for the call simulator.");
        }
      } catch (e) {
        if (mountedRef.current) setError(formatError(e));
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v1/speech/status");
        if (!res.ok) return;
        const body = (await res.json()) as { data?: SpeechStatus };
        if (body.data && mountedRef.current) setSpeech(body.data);
      } catch {
        // Voice status is optional; the call still works with browser STT.
      }
    })();
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [log, interim]);

  useEffect(() => {
    if (phase === "idle" || phase === "ended") return;
    const update = () => {
      const startedAt = startedAtRef.current;
      if (startedAt) setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    };
    update();
    const id = setInterval(update, 1_000);
    timerRef.current = id;
    return () => {
      clearInterval(id);
      if (timerRef.current === id) timerRef.current = null;
    };
  }, [phase]);

  useEffect(() => {
    if (!speech?.configured || !speakerOn) return;
    const activePatient = patients.find((row) => row.id === patientId);
    const firstName = activePatient?.display_name.trim().split(/\s+/)[0] ?? "";
    if (!firstName) return;
    const lang = normalizeLanguage(language);
    const noAction = closingCopy(lang, {
      firstName,
      actionTaken: false,
      unanswered: false,
      emergency: false,
    });
    const candidates = [
      greeting(lang),
      `${decisionCopy("log_adherence", lang)} ${noAction}`,
      decisionCopy("emergency_guidance", lang),
      ...(lang === "en"
        ? [decisionCopy("symptom_escalation", lang), decisionCopy("dosage_safety_response", lang)]
        : []),
    ];
    const runKey = `${lang}:${firstName}`;
    if (prefetchRunRef.current.has(runKey)) return;
    prefetchRunRef.current.add(runKey);
    const pending = [...new Set(candidates)]
      .map((raw) => splitForSpeech(raw)[0])
      .filter((text): text is string => Boolean(text));
    // Warm the first sentence of fixed safety copy before the call starts, so
    // greeting/first-reply latency does not include TTS cold synthesis.
    void Promise.all(pending.map((text) => fetchSpeechBlob(text, lang)));
  }, [speech?.configured, speakerOn, language, patients, patientId]);


  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function readBrowserLanguage(): string {
    return BROWSER_LANGUAGE[normalizeLanguage(languageRef.current)] ?? "en-US";
  }

  async function ensureAudioContext(): Promise<AudioContext> {
    const existing = audioContextRef.current;
    if (existing && existing.state !== "closed") {
      if (existing.state === "suspended") await existing.resume();
      return existing;
    }
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) throw new Error("This browser cannot play call audio.");
    const context = new Ctor();
    audioContextRef.current = context;
    return context;
  }

  function closeAudioContext() {
    const context = audioContextRef.current;
    audioContextRef.current = null;
    playbackAnalyserRef.current = null;
    playbackSamplesRef.current = null;
    mediaSourceRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => {});
    }
  }

  function stopMicrophoneInternal() {
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = 0;
    }
    const session = micRef.current;
    micRef.current = null;
    if (session) {
      try {
        session.stop();
      } catch {
        // Tracks may already be stopped by the browser.
      }
    }
    levelsZero();
    setMicStateSafe("off");
  }

  function levelsZero() {
    levelHistoryRef.current = new Array(LEVEL_BARS).fill(0);
    if (mountedRef.current) setLevels(new Array(LEVEL_BARS).fill(0));
  }

  async function ensureMicrophone(epoch: number): Promise<MicSession> {
    if (micRef.current) return micRef.current;
    const stream = await requestMicrophoneStream();
    if (epoch !== callEpochRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("Call ended before the microphone was ready.");
    }
    const context = await ensureAudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const session: MicSession = {
      stream,
      analyser,
      samples,
      readLevel: () => {
        analyser.getFloatTimeDomainData(samples);
        return computeRms(samples);
      },
      stop: () => {
        try {
          source.disconnect();
          analyser.disconnect();
        } catch {
          // Already disconnected.
        }
        stream.getTracks().forEach((track) => track.stop());
      },
    };
    micRef.current = session;
    stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (!callActiveRef.current || epoch !== callEpochRef.current) return;
        stopRecognitionInternal();
        stopFallbackInternal();
        stopMicrophoneInternal();
        setMicStateSafe("error");
        setMicError("The microphone disconnected. Reconnect it, then retry.");
        if (isCallLive(phaseRef.current)) {
          setPhase("text_fallback");
          setVoiceNote("Microphone lost. Type the patient's reply below.");
        }
      });
    });
    return session;
  }

  function startLevelLoop(epoch: number) {
    if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
    const tick = () => {
      if (epoch !== callEpochRef.current || !callActiveRef.current) {
        levelRafRef.current = 0;
        return;
      }
      const mic = micRef.current;
      const micLevel = mic && !micMutedRef.current ? mic.readLevel() : 0;
      let playbackLevel = 0;
      const analyser = playbackAnalyserRef.current;
      const audio = audioRef.current;
      if (analyser && audio && !audio.paused) {
        let samples = playbackSamplesRef.current;
        if (!samples || samples.length !== analyser.fftSize) {
          samples = new Float32Array(analyser.fftSize);
          playbackSamplesRef.current = samples;
        }
        analyser.getFloatTimeDomainData(samples);
        playbackLevel = computeRms(samples);
      }
      const level = Math.max(micLevel, playbackLevel);
      const history = levelHistoryRef.current;
      history.push(level);
      if (history.length > LEVEL_BARS) history.splice(0, history.length - LEVEL_BARS);
      const now = performance.now();
      if (mountedRef.current && now - lastLevelRenderRef.current >= 45) {
        lastLevelRenderRef.current = now;
        setLevels([...history]);
      }

      if (
        micLevel > BARGE_THRESHOLD &&
        phaseRef.current === "speaking" &&
        speakerOnRef.current &&
        now - speechStartedAtRef.current > BARGE_GRACE_MS
      ) {
        if (!bargeSinceRef.current) bargeSinceRef.current = now;
        if (now - bargeSinceRef.current >= BARGE_HOLD_MS) {
          handleBargeIn();
        }
      } else {
        bargeSinceRef.current = 0;
      }

      levelRafRef.current = requestAnimationFrame(tick);
    };
    levelRafRef.current = requestAnimationFrame(tick);
  }

  function stopPlaybackInternal() {
    speechSeqRef.current += 1;
    for (const controller of ttsControllersRef.current) controller.abort();
    ttsControllersRef.current.clear();
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    const resolve = playResolveRef.current;
    playResolveRef.current = null;
    resolve?.();
    bargeSinceRef.current = 0;
  }

  function handleBargeIn() {
    bargeSinceRef.current = 0;
    if (!callActiveRef.current || phaseRef.current !== "speaking") return;
    stopPlaybackInternal();
    setVoiceNote("Playback paused when the patient started speaking. Use Replay last reply if needed.");
    addLog("system", "Barge-in detected - AI playback stopped.");
    if (endingAfterSpeechRef.current) {
      endingAfterSpeechRef.current = false;
      void finishCall();
      return;
    }
    void startListening(callEpochRef.current);
  }

  async function fetchSpeechBlob(text: string, lang: string): Promise<Blob | null> {
    const key = `${lang}:${text}`;
    const cached = ttsCacheRef.current.get(key);
    if (cached) return cached;
    const pending = ttsInFlightRef.current.get(key);
    if (pending) return pending;
    const promise = (async () => {
      const controller = new AbortController();
      ttsControllersRef.current.add(controller);
      try {
        const res = await fetch("/api/v1/speech/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language: lang }),
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const blob = await res.blob();
        if (!blob.size) return null;
        ttsCacheRef.current.set(key, blob);
        if (ttsCacheRef.current.size > 60) {
          const oldest = ttsCacheRef.current.keys().next().value;
          if (oldest) ttsCacheRef.current.delete(oldest);
        }
        return blob;
      } catch {
        return null;
      } finally {
        ttsControllersRef.current.delete(controller);
        ttsInFlightRef.current.delete(key);
      }
    })();
    ttsInFlightRef.current.set(key, promise);
    return promise;
  }

  function playBlob(audio: HTMLAudioElement, blob: Blob): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const finish = () => {
        audio.onended = null;
        audio.onerror = null;
        URL.revokeObjectURL(url);
        if (playResolveRef.current === finish) playResolveRef.current = null;
        resolve();
      };
      playResolveRef.current = finish;
      audio.onended = finish;
      audio.onerror = finish;
      audio.src = url;
      void audio.play().catch(finish);
    });
  }

  async function playSpeech(text: string, lang: string, epoch: number): Promise<boolean> {
    if (!speakerOnRef.current || !text.trim()) return false;
    const chunks = splitForSpeech(text);
    if (chunks.length === 0) return false;
    const audio = audioRef.current;
    if (!audio) return false;
    const seq = speechSeqRef.current + 1;
    speechSeqRef.current = seq;
    // Start every sentence request at once so later chunks are ready before
    // the current one finishes playing.
    const requests = chunks.map((chunk) => fetchSpeechBlob(chunk, lang));
    try {
      const context = await ensureAudioContext();
      if (seq !== speechSeqRef.current || epoch !== callEpochRef.current) return false;
      if (!mediaSourceRef.current) {
        const source = context.createMediaElementSource(audio);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        analyser.connect(context.destination);
        mediaSourceRef.current = source;
        playbackAnalyserRef.current = analyser;
      }
      let played = false;
      let failed = 0;
      for (let index = 0; index < chunks.length; index += 1) {
        if (seq !== speechSeqRef.current || epoch !== callEpochRef.current) return played;
        const blob = await requests[index];
        if (seq !== speechSeqRef.current || epoch !== callEpochRef.current) return played;
        if (!blob) {
          failed += 1;
          continue;
        }
        speechStartedAtRef.current = performance.now();
        if (!firstAudioAtRef.current) firstAudioAtRef.current = speechStartedAtRef.current;
        played = true;
        await playBlob(audio, blob);
        if (seq !== speechSeqRef.current || epoch !== callEpochRef.current) return played;
      }
      if (!played && failed > 0) {
        setVoiceNote("Voice audio is unavailable. The reply is shown in the transcript; check the speech provider status.");
      }
      return played;
    } catch {
      return false;
    }
  }

  async function replayLastReply() {
    const last = lastSpokenRef.current;
    if (!last || !callActiveRef.current) return;
    if (phaseRef.current === "speaking" || phaseRef.current === "processing") return;
    setPhase("speaking");
    stopRecognitionInternal();
    stopFallbackInternal();
    const played = await playSpeech(last.text, last.lang, callEpochRef.current);
    if ((phaseRef.current as CallPhase) !== "speaking") return;
    if (played || !callActiveRef.current) {
      setPhase("listening");
      if (callActiveRef.current) startListening(callEpochRef.current);
    } else {
      setPhase("listening");
      if (callActiveRef.current) startListening(callEpochRef.current);
      setVoiceNote("No audio came back from the speech service. The transcript still shows the reply.");
    }
  }

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  function clearRecognitionRestart() {
    if (recognitionRestartTimerRef.current) {
      clearTimeout(recognitionRestartTimerRef.current);
      recognitionRestartTimerRef.current = null;
    }
  }

  function stopRecognitionInternal() {
    recognitionWantedRef.current = false;
    recognitionGenRef.current += 1;
    clearSilenceTimer();
    clearRecognitionRestart();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    finalTextRef.current = "";
    interimTextRef.current = "";
    if (mountedRef.current) setInterim("");
    if (recognition) {
      ignoreEndRef.current = true;
      try {
        if (recognition.abort) recognition.abort();
        else recognition.stop();
      } catch {
        // Already stopped.
      }
    }
  }

  function stopFallbackInternal() {
    if (fallbackVadTimerRef.current) {
      clearInterval(fallbackVadTimerRef.current);
      fallbackVadTimerRef.current = null;
    }
    const session = fallbackRef.current;
    fallbackRef.current = null;
    if (session) {
      session.stopping = true;
      // Detach callbacks so an intentional stop cannot restart capture later.
      session.recorder.ondataavailable = null;
      session.recorder.onstop = null;
      if (session.recorder.state !== "inactive") {
        try {
          session.recorder.stop();
        } catch {
          // Already stopped.
        }
      }
    }
  }

  function scheduleRecognitionRestart(epoch: number) {
    clearRecognitionRestart();
    recognitionRestartTimerRef.current = setTimeout(() => {
      recognitionRestartTimerRef.current = null;
      if (
        recognitionWantedRef.current &&
        callActiveRef.current &&
        epoch === callEpochRef.current &&
        phaseRef.current === "listening" &&
        !micMutedRef.current
      ) {
        if (useFallbackRef.current || recognitionUnavailableRef.current) {
          if (
            speechRef.current?.sttConfigured &&
            !batchUnavailableRef.current &&
            !batchRetryBlockedRef.current
          ) {
            void startFallbackCapture(epoch, true);
          } else {
            setPhase("text_fallback");
          }
        } else {
          startRecognition(epoch);
        }
      }
    }, RECOGNITION_RESTART_MS);
  }

  function finishBrowserUtterance() {
    if (finishingUtteranceRef.current) return;
    const text = joinTranscript(finalTextRef.current, interimTextRef.current);
    finalTextRef.current = "";
    interimTextRef.current = "";
    if (mountedRef.current) setInterim("");
    clearSilenceTimer();
    recognitionWantedRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      ignoreEndRef.current = true;
      try {
        if (recognition.abort) recognition.abort();
        else recognition.stop();
      } catch {
        // Already stopped.
      }
    }
    if (!text) {
      if (callActiveRef.current && phaseRef.current === "listening") {
        startRecognition(callEpochRef.current);
      }
      return;
    }
    finishingUtteranceRef.current = true;
    void handleUtterance(text, "voice").finally(() => {
      finishingUtteranceRef.current = false;
    });
  }

  function startRecognition(epoch: number) {
    if (
      !callActiveRef.current ||
      epoch !== callEpochRef.current ||
      phaseRef.current !== "listening" ||
      micMutedRef.current
    ) {
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      useFallbackRef.current = true;
      if (
        speechRef.current?.sttConfigured &&
        !batchUnavailableRef.current &&
        !batchRetryBlockedRef.current
      ) {
        setVoiceNote("This browser has no built-in speech recognition, so the configured speech-to-text service is used.");
        void startFallbackCapture(epoch, false);
      } else {
        setPhase("text_fallback");
        setVoiceNote("No microphone speech-to-text is available. Type the patient's reply.");
      }
      return;
    }
    const previous = recognitionRef.current;
    recognitionRef.current = null;
    if (previous) {
      ignoreEndRef.current = true;
      try {
        if (previous.abort) previous.abort();
        else previous.stop();
      } catch {
        // Already ended.
      }
    }
    const gen = recognitionGenRef.current + 1;
    recognitionGenRef.current = gen;
    // A stale onend from the previous instance must not suppress this one.
    ignoreEndRef.current = false;
    const recognition = new Ctor();
    recognitionRef.current = recognition;
    const isCurrent = () =>
      gen === recognitionGenRef.current &&
      recognitionRef.current === recognition &&
      epoch === callEpochRef.current;
    recognition.onstart = () => {
      if (!isCurrent()) return;
      if (mountedRef.current) setMicStateSafe("ready");
    };
    recognition.onresult = (event) => {
      if (!isCurrent() || phaseRef.current !== "listening") return;
      let interimPart = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript ?? "";
        if (result?.isFinal) {
          finalTextRef.current = joinTranscript(finalTextRef.current, transcript);
        } else {
          interimPart = `${interimPart} ${transcript}`.trim();
        }
      }
      interimTextRef.current = interimPart;
      const combined = joinTranscript(finalTextRef.current, interimPart);
      if (mountedRef.current) setInterim(combined);
      if (combined) {
        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;
          finishBrowserUtterance();
        }, SILENCE_MS);
      }
    };
    recognition.onerror = (event) => {
      if (!isCurrent()) return;
      const code = event.error ?? "";
      if (code === "no-speech" || code === "aborted") return;
      if (
        code === "not-allowed" ||
        code === "service-not-allowed" ||
        code === "audio-capture" ||
        code === "network" ||
        code === "not-supported"
      ) {
        recognitionUnavailableRef.current = true;
        useFallbackRef.current = true;
        setMicError(
          speechRef.current?.sttConfigured &&
            !batchUnavailableRef.current &&
            !batchRetryBlockedRef.current
            ? "Browser speech recognition is unavailable. The configured speech service is used and a turn may take longer."
            : "Browser speech recognition is unavailable. Type the patient's reply.",
        );
      }
    };
    recognition.onend = () => {
      if (!isCurrent()) return;
      if (ignoreEndRef.current) {
        ignoreEndRef.current = false;
        return;
      }
      if (!recognitionWantedRef.current) return;
      if (interimTextRef.current) {
        finalTextRef.current = joinTranscript(finalTextRef.current, interimTextRef.current);
        interimTextRef.current = "";
        if (mountedRef.current) setInterim(finalTextRef.current);
      }
      scheduleRecognitionRestart(epoch);
    };
    recognition.lang = readBrowserLanguage();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionWantedRef.current = true;
    try {
      recognition.start();
    } catch {
      scheduleRecognitionRestart(epoch);
    }
  }

  async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = typeof reader.result === "string" ? reader.result : "";
        resolve(value.slice(value.indexOf(",") + 1));
      };
      reader.onerror = () => reject(reader.error ?? new Error("Could not read the recording."));
      reader.readAsDataURL(blob);
    });
  }

  async function transcribeFallback(blob: Blob, epoch: number) {
    setPhase("processing");
    setMicStateSafe("off");
    try {
      const audioBase64 = await blobToBase64(blob);
      const res = await fetch("/api/v1/speech/stt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64,
          language: normalizeLanguage(languageRef.current),
          audioMimeType: blob.type || undefined,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { text?: string; provider?: string };
        error?: { code?: string; message?: string };
      };
      if (!res.ok) {
        if (speechRef.current?.sttProvider === "groq") {
          batchRetryBlockedRef.current = true;
          setVoiceNote(
            `${body.error?.message ?? "Groq speech-to-text failed."} Press Retry microphone to try voice again; typing still works.`,
          );
          setPhase("text_fallback");
          setMicStateSafe("ready");
          return;
        }
        throw new Error(body.error?.message ?? "Speech-to-text failed.");
      }
      const text = body.data?.text?.trim();
      if (!text) throw new Error("No speech was transcribed. Try again or type the answer.");
      if (!callActiveRef.current || epoch !== callEpochRef.current) return;
      await handleUtterance(text, "voice");
    } catch (e) {
      if (!mountedRef.current || epoch !== callEpochRef.current) return;
      if (speechRef.current?.sttProvider === "groq") {
        batchRetryBlockedRef.current = true;
        setVoiceNote(
          `${formatError(e)} Press Retry microphone to try voice again; typing still works.`,
        );
        setPhase("text_fallback");
        setMicStateSafe("ready");
        return;
      }
      if (
        speechRef.current?.sttProvider === "verbx" &&
        !batchUnavailableRef.current &&
        getSpeechRecognitionCtor()
      ) {
        batchUnavailableRef.current = true;
        recognitionUnavailableRef.current = false;
        useFallbackRef.current = false;
        setVoiceNote(
          "Configured speech-to-text is unavailable, so browser speech recognition is used for the rest of this call.",
        );
        setPhase("listening");
        setMicStateSafe("ready");
        startRecognition(epoch);
        return;
      }
      setVoiceNote(formatError(e));
      setPhase("text_fallback");
      setMicStateSafe("ready");
    }
  }

  function finishFallbackUtterance(epoch: number) {
    const session = fallbackRef.current;
    if (!session || session.stopping) return;
    session.stopping = true;
    if (fallbackVadTimerRef.current) {
      clearInterval(fallbackVadTimerRef.current);
      fallbackVadTimerRef.current = null;
    }
    if (session.recorder.state !== "inactive") {
      try {
        session.recorder.stop();
      } catch {
        fallbackRef.current = null;
        if (callActiveRef.current) startListening(epoch);
      }
    } else {
      fallbackRef.current = null;
      if (callActiveRef.current) startListening(epoch);
    }
  }

  async function startFallbackCapture(epoch: number, force: boolean) {
    if (
      !callActiveRef.current ||
      epoch !== callEpochRef.current ||
      phaseRef.current !== "listening" ||
      micMutedRef.current
    ) {
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setPhase("text_fallback");
      setMicError("This browser cannot record audio. Type the patient's reply below.");
      return;
    }
    const existing = fallbackRef.current;
    if (existing && !force && existing.recorder.state === "recording") return;
    if (existing) stopFallbackInternal();
    let mic: MicSession;
    try {
      mic = await ensureMicrophone(epoch);
    } catch (e) {
      failMicrophone(e, epoch);
      return;
    }
    if (!callActiveRef.current || epoch !== callEpochRef.current || phaseRef.current !== "listening") {
      return;
    }
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(mic.stream, mimeType ? { mimeType } : undefined);
    } catch {
      setPhase("text_fallback");
      setMicError("Audio recording could not start in this browser. Type the patient's reply below.");
      return;
    }
    const session: FallbackSession = {
      recorder,
      chunks: [],
      vad: new VoiceActivityDetector({
        endSilenceMs: SILENCE_MS,
        speechThreshold: 0.025,
        minSpeechMs: 220,
        maxSpeechMs: 30_000,
      }),
      heardSpeech: false,
      stopping: false,
    };
    fallbackRef.current = session;
    session.vad.reset(performance.now());
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) session.chunks.push(event.data);
    };
    recorder.onstop = () => {
      const wasCurrent = fallbackRef.current === session && epoch === callEpochRef.current;
      if (fallbackRef.current === session) fallbackRef.current = null;
      if (fallbackVadTimerRef.current) {
        clearInterval(fallbackVadTimerRef.current);
        fallbackVadTimerRef.current = null;
      }
      if (!wasCurrent) return;
      if (session.stopping && !session.heardSpeech) {
        if (callActiveRef.current && phaseRef.current === "listening") {
          setTimeout(() => startFallbackCapture(callEpochRef.current, true), 250);
        }
        return;
      }
      if (!session.heardSpeech || session.chunks.length === 0) {
        if (callActiveRef.current && phaseRef.current === "listening") {
          setTimeout(() => startFallbackCapture(callEpochRef.current, true), 250);
        }
        return;
      }
      const blob = new Blob(session.chunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size < 800) {
        if (callActiveRef.current && phaseRef.current === "listening") {
          setTimeout(() => startFallbackCapture(callEpochRef.current, true), 250);
        }
        return;
      }
      void transcribeFallback(blob, epoch);
    };
    try {
      recorder.start(250);
    } catch {
      fallbackRef.current = null;
      setPhase("text_fallback");
      setMicError("Audio recording could not start in this browser. Type the patient's reply below.");
      return;
    }
    setMicStateSafe("ready");
    fallbackVadTimerRef.current = setInterval(() => {
      if (
        !callActiveRef.current ||
        epoch !== callEpochRef.current ||
        fallbackRef.current !== session
      ) {
        if (fallbackVadTimerRef.current) {
          clearInterval(fallbackVadTimerRef.current);
          fallbackVadTimerRef.current = null;
        }
        return;
      }
      const currentMic = micRef.current;
      if (!currentMic || phaseRef.current !== "listening") return;
      const event = session.vad.update(currentMic.readLevel(), performance.now());
      if (event === "speech_start") {
        session.heardSpeech = true;
      } else if (event === "speech_end" || event === "max_duration") {
        finishFallbackUtterance(epoch);
      } else if (event === "no_speech") {
        session.stopping = true;
        if (session.recorder.state !== "inactive") {
          try {
            session.recorder.stop();
          } catch {
            // Already stopped.
          }
        }
      }
    }, 120);
  }

  async function startListening(epoch: number) {
    if (!callActiveRef.current || epoch !== callEpochRef.current) return;
    setPhase("listening");
    if (micMutedRef.current) {
      setMicStateSafe("ready");
      setVoiceNote("Microphone is muted. Unmute it to answer by voice, or type below.");
      return;
    }
    if (batchRetryBlockedRef.current) {
      setPhase("text_fallback");
      setMicStateSafe("ready");
      return;
    }
    try {
      await ensureMicrophone(epoch);
    } catch (e) {
      failMicrophone(e, epoch);
      return;
    }
    if (!callActiveRef.current || epoch !== callEpochRef.current || phaseRef.current !== "listening") {
      return;
    }
    setMicStateSafe("ready");
    if (!levelRafRef.current) startLevelLoop(epoch);
    const status = speechRef.current;
    const batchAvailable =
      Boolean(status?.sttConfigured) &&
      !batchUnavailableRef.current &&
      !batchRetryBlockedRef.current;
    const batchProvider =
      status?.sttProvider === "groq" || status?.sttProvider === "verbx"
        ? status.sttProvider
        : null;
    const resolved = resolveSttProvider({
      selection: status?.sttSelection ?? "auto",
      browserSupported: Boolean(getSpeechRecognitionCtor()),
      groqConfigured: batchAvailable && batchProvider === "groq",
      verbxConfigured: batchAvailable && batchProvider === "verbx",
    });
    let provider = resolved.provider;
    if (
      (useFallbackRef.current || recognitionUnavailableRef.current) &&
      provider === "browser"
    ) {
      provider = batchAvailable && batchProvider ? batchProvider : "text";
    }
    if (provider === "groq" || provider === "verbx") {
      setVoiceNote(
        resolved.fallback
          ? "Browser recognition is unavailable. The configured batch speech-to-text service is used; a turn may take longer."
          : `Audio is sent to ${sttLabel(provider)} after 2.5 s of silence.`,
      );
      void startFallbackCapture(epoch, false);
      return;
    }
    if (provider === "browser") {
      if (resolved.fallback) {
        setVoiceNote(
          resolved.reason === "groq_unavailable"
            ? "Groq speech-to-text is not configured. Browser recognition is used instead."
            : "Configured speech-to-text is unavailable. Browser recognition is used instead.",
        );
      }
      startRecognition(epoch);
      return;
    }
    setPhase("text_fallback");
    setVoiceNote("No microphone speech-to-text is available. Type the patient's reply.");
  }

  function failMicrophone(error: unknown, epoch: number) {
    if (!mountedRef.current || epoch !== callEpochRef.current) return;
    const name = error instanceof DOMException ? error.name : "";
    const denied = name === "NotAllowedError" || name === "SecurityError";
    const missing = name === "NotFoundError" || name === "DevicesNotFoundError";
    setMicStateSafe(denied ? "denied" : "error");
    setMicError(micErrorMessage(error));
    stopRecognitionInternal();
    stopFallbackInternal();
    if (isCallLive(phaseRef.current)) {
      setPhase("text_fallback");
      setVoiceNote(
        denied || missing
          ? "Voice capture is unavailable. Type the patient's reply to continue the simulated call."
          : "Microphone capture failed. Retry the microphone or type the reply.",
      );
    }
  }

  function recordTurnData(data: ApiResult): TurnRecordResult {
    if (data.conversation) {
      setConversationState(data.conversation.state);
      setReplySource(data.conversation.replySource);
    }
    const nextStatus = data.checkIn?.status ?? data.status ?? null;
    setStatusSafe(nextStatus);
    const decision = data.decision?.type ?? data.decisionType;
    if (decision) {
      setDecisions((prev) => [...prev, { type: decision, status: nextStatus ?? "unknown" }]);
      addLog(
        "decision",
        `Rule decision: ${decision.replaceAll("_", " ")} - status ${nextStatus ?? "?"}`,
      );
    }
    if (data.replyText) addLog("ai", data.replyText);
    if (data.followUpQuestion) addLog("ai", data.followUpQuestion);
    const replyLanguage = data.language ?? languageRef.current;
    const spoken =
      data.spokenText ?? [data.replyText, data.followUpQuestion].filter(Boolean).join(" ");
    if (spoken) {
      const last = { text: spoken, lang: replyLanguage };
      lastSpokenRef.current = last;
      if (mountedRef.current) setLastSpoken(last);
    }
    return {
      spoken,
      replyLanguage,
      endAfter: Boolean(data.closing),
    };
  }

  async function deliverReply(record: TurnRecordResult, epoch: number): Promise<boolean> {
    if (!record.spoken.trim()) return false;
    setPhase("speaking");
    stopRecognitionInternal();
    stopFallbackInternal();
    const played = await playSpeech(record.spoken, record.replyLanguage, epoch);
    if (!played && record.spoken) {
      await sleep(Math.min(4_500, 900 + record.spoken.length * 16));
    }
    return played;
  }

  async function handleUtterance(text: string, source: "voice" | "typed") {
    const clean = text.trim();
    if (!clean || !callActiveRef.current || !checkInRef.current) return;
    if (submittingRef.current) return;
    const epoch = callEpochRef.current;
    const id = checkInRef.current;
    const turn = turnSeqRef.current + 1;
    turnSeqRef.current = turn;
    submittingRef.current = true;
    turnStartedAtRef.current = performance.now();
    replyReceivedAtRef.current = 0;
    firstAudioAtRef.current = 0;
    setError(null);
    setBusy(true);
    addLog("patient", clean);
    stopRecognitionInternal();
    stopFallbackInternal();
    stopPlaybackInternal();
    setPhase("processing");
    setMicStateSafe("off");
    if (mountedRef.current) setInterim("");

    const task = (async () => {
      try {
        const data = await callApi(`/api/v1/check-ins/${id}/submit-input`, {
          transcript: clean,
          inputSource: source === "voice" ? "speech" : "typed",
          language: languageRef.current,
        });
        if (!callActiveRef.current || epoch !== callEpochRef.current) return;
        if (turnSeqRef.current !== turn) return;
        replyReceivedAtRef.current = performance.now();
        const record = recordTurnData(data);
        submittingRef.current = false;
        submitInFlightRef.current = null;
        if (mountedRef.current) setBusy(false);
        if (endingRef.current) return;
        await deliverReply(record, epoch);
        if (!callActiveRef.current || epoch !== callEpochRef.current) return;
        if (turnSeqRef.current !== turn) return;
        if (record.endAfter) {
          finishCall();
        } else if (demoModeRef.current === "turn") {
          setPhase("text_fallback");
        } else if (phaseRef.current === "speaking" || phaseRef.current === "processing") {
          void startListening(epoch);
          const startedAt = turnStartedAtRef.current;
          if (startedAt > 0) {
            setLatency({
              replyMs: Math.round(replyReceivedAtRef.current - startedAt),
              firstAudioMs: firstAudioAtRef.current
                ? Math.round(firstAudioAtRef.current - startedAt)
                : null,
              resumedMs: Math.round(performance.now() - startedAt),
            });
          }
        }
      } catch (e) {
        if (!mountedRef.current || epoch !== callEpochRef.current) return;
        if (turnSeqRef.current !== turn) return;
        setError(formatError(e));
        setVoiceNote("The turn could not be processed. Retry the call or type a shorter reply.");
        if (callActiveRef.current) {
          setPhase("text_fallback");
          setMicStateSafe("ready");
        }
      } finally {
        if (turnSeqRef.current === turn) {
          submittingRef.current = false;
          submitInFlightRef.current = null;
          if (mountedRef.current) setBusy(false);
        }
      }
    })();
    submitInFlightRef.current = task;
    await task;
  }

  async function submitTyped(value?: string) {
    const text = (value ?? typedText).trim();
    if (!text) return;
    if (!isCallLive(phaseRef.current) || !canSubmitTurn(phaseRef.current) || submittingRef.current) {
      return;
    }
    setTypedText("");
    await handleUtterance(text, "typed");
  }

  async function runNoAnswerScenario(epoch: number) {
    if (!callActiveRef.current || !checkInRef.current) return;
    stopRecognitionInternal();
    stopFallbackInternal();
    stopPlaybackInternal();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (!callActiveRef.current || epoch !== callEpochRef.current) return;
      setPhase("processing");
      setMicStateSafe("off");
      try {
        const data = await callApi(`/api/v1/check-ins/${checkInRef.current}/no-answer`);
        if (!callActiveRef.current || epoch !== callEpochRef.current) return;
        addLog("system", `No answer recorded for attempt ${attempt} (simulated).`);
        const record = recordTurnData(data);
        await deliverReply(record, epoch);
        if (!callActiveRef.current || epoch !== callEpochRef.current) return;
        if (attempt === 2) {
          finishCall();
          return;
        }
        await sleep(800);
      } catch (e) {
        if (!mountedRef.current || epoch !== callEpochRef.current) return;
        setError(formatError(e));
        setPhase("text_fallback");
        return;
      }
    }
  }

  async function startCall() {
    if (startingRef.current || isCallLive(phaseRef.current)) return;
    if (!patientId) {
      setError("Select a patient before starting the simulated call.");
      return;
    }
    startingRef.current = true;
    setBusy(true);
    setError(null);
    setMicError(null);
    setVoiceNote(null);
    cleanupRef.current();
    const epoch = callEpochRef.current;
    callActiveRef.current = true;
    endingRef.current = false;
    finalTurnSentRef.current = false;
    submittingRef.current = false;
    submitInFlightRef.current = null;
    endingAfterSpeechRef.current = false;
    batchRetryBlockedRef.current = false;
    batchUnavailableRef.current = false;
    setLog([]);
    setInterim("");
    setDecisions([]);
    setConversationState(null);
    setReplySource(null);
    setElapsed(0);
    setLastSpoken(null);
    lastSpokenRef.current = null;
    setMicMutedSafe(false);
    setCheckInSafe(null);
    setStatusSafe(null);
    const turnMode = demoModeRef.current === "turn";
    setPhase(turnMode ? "connecting" : "requesting_mic");
    setMicStateSafe(turnMode ? "off" : "requesting");

    let micFailed = false;
    if (!turnMode) {
      try {
        await ensureMicrophone(epoch);
        if (epoch !== callEpochRef.current) return;
        setMicStateSafe("ready");
      } catch (e) {
        micFailed = true;
        failMicrophone(e, epoch);
      }
    }

    try {
      const created = await callApi("/api/v1/check-ins", {
        patientId,
        channel: "browser_simulation",
      });
      const id = (created as { id?: string }).id;
      if (!id) throw new Error("Check-in creation returned no id.");
      if (!callActiveRef.current || epoch !== callEpochRef.current) return;
      await callApi(`/api/v1/check-ins/${id}/start`);
      if (!callActiveRef.current || epoch !== callEpochRef.current) return;
      setCheckInSafe(id);
      setStatusSafe("in_progress");
        startedAtRef.current = Date.now();
      addLog("system", "SIMULATED CALL STARTED - browser rehearsal only; no real phone call is placed.");
      const openingLanguage = normalizeLanguage(languageRef.current);
      const opening = greeting(openingLanguage);
      addLog("ai", opening);
      const last = { text: opening, lang: openingLanguage };
      lastSpokenRef.current = last;
      setLastSpoken(last);
      setPhase("speaking");
      const played = await playSpeech(opening, openingLanguage, epoch);
      if (!callActiveRef.current || epoch !== callEpochRef.current) return;
      if (!played && speechRef.current && !speechRef.current.configured) {
        setVoiceNote("Real voice is not configured. The simulated call continues with transcript text.");
      }
      if (phaseRef.current !== "speaking") {
        return;
      }
      if (turnMode) {
        setPhase("text_fallback");
        return;
      }
      const scenario = SCENARIOS.find((item) => item.id === scenarioRef.current) ?? SCENARIOS[0];
      if (scenario.kind === "no_answer") {
        await runNoAnswerScenario(epoch);
        return;
      }
      if (scenario.kind === "line" && scenario.transcript) {
        await handleUtterance(scenario.transcript, "typed");
        return;
      }
      if (micFailed) {
        setPhase("text_fallback");
        setMicStateSafe("ready");
        return;
      }
      void startListening(epoch);
    } catch (e) {
      if (!mountedRef.current) return;
      callActiveRef.current = false;
      setError(formatError(e));
      setPhase("error");
      stopRecognitionInternal();
      stopFallbackInternal();
      stopPlaybackInternal();
      stopMicrophoneInternal();
    } finally {
      startingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  function finishCall() {
    if (phaseRef.current === "ended") return;
    callActiveRef.current = false;
    endingRef.current = true;
    stopRecognitionInternal();
    stopFallbackInternal();
    stopPlaybackInternal();
    stopMicrophoneInternal();
    endingAfterSpeechRef.current = false;
    setMicStateSafe("off");
    setPhase("ended");
    addLog("system", "Call complete - transcript and decisions saved as evidence. No real call was placed.");
    setBusy(false);
  }

  async function endCall() {
    if (endingRef.current) return;
    if (phaseRef.current === "idle") return;
    if (phaseRef.current === "error") {
      finishCall();
      return;
    }
    endingRef.current = true;
    stopRecognitionInternal();
    stopFallbackInternal();
    stopPlaybackInternal();
    setBusy(true);
    try {
      if (submitInFlightRef.current) await submitInFlightRef.current;
      const id = checkInRef.current;
      const currentStatus = statusRef.current;
      if (id && currentStatus && INPUT_STATUSES.has(currentStatus) && !finalTurnSentRef.current) {
        finalTurnSentRef.current = true;
        const data = await callApi(`/api/v1/check-ins/${id}/submit-input`, {
          transcript: "No, that is all. Thank you.",
          inputSource: "typed",
          language: languageRef.current,
        });
        const record = recordTurnData(data);
        if (record.spoken) {
          await deliverReply(record, callEpochRef.current);
        }
      }
    } catch (e) {
      if (mountedRef.current) setError(formatError(e));
    } finally {
      finishCall();
    }
  }

  function resetSession() {
    cleanupRef.current();
    endingRef.current = false;
    finalTurnSentRef.current = false;
    submittingRef.current = false;
    submitInFlightRef.current = null;
    startingRef.current = false;
    setCheckInSafe(null);
    setStatusSafe(null);
    setPhase("idle");
    setLog([]);
    setInterim("");
    setLevels(new Array(LEVEL_BARS).fill(0));
    setElapsed(0);
    startedAtRef.current = null;
    setDecisions([]);
    setConversationState(null);
    setReplySource(null);
    setError(null);
    setMicError(null);
    setVoiceNote(null);
    setMicStateSafe("off");
    setBusy(false);
    setTypedText("");
    setLastSpoken(null);
    lastSpokenRef.current = null;
    setMicMutedSafe(false);
  }

  function toggleMic() {
    if (!isCallLive(phaseRef.current)) return;
    if (micMutedRef.current) {
      setMicMutedSafe(false);
      setMicError(null);
      setVoiceNote(null);
      if (phaseRef.current === "listening" || phaseRef.current === "text_fallback") {
        void startListening(callEpochRef.current);
      }
      return;
    }
    setMicMutedSafe(true);
    stopRecognitionInternal();
    stopFallbackInternal();
    setVoiceNote("Microphone muted. Unmute to answer by voice, or type below.");
  }

  function toggleSpeaker() {
    const next = !speakerOnRef.current;
    setSpeakerOnSafe(next);
    if (!next) {
      stopPlaybackInternal();
      setVoiceNote("AI playback is muted. The transcript still shows every reply.");
    } else {
      setVoiceNote(null);
    }
  }

  function retryMicrophone() {
    if (!isCallLive(phaseRef.current)) return;
    recognitionUnavailableRef.current = false;
    useFallbackRef.current = false;
    batchUnavailableRef.current = false;
    batchRetryBlockedRef.current = false;
    setMicError(null);
    setVoiceNote(null);
    stopRecognitionInternal();
    stopFallbackInternal();
    void startListening(callEpochRef.current);
  }

  function chooseScenario(id: string) {
    if (isCallLive(phaseRef.current)) {
      setError("End the current call before changing the rehearsal scenario.");
      return;
    }
    setError(null);
    selectScenario(id);
    const scenario = SCENARIOS.find((item) => item.id === id);
    if (demoModeRef.current === "turn") {
      if (scenario?.kind === "line" && scenario.transcript) setTypedText(scenario.transcript);
      setVoiceNote("Turn-based mode: review the suggested reply, then press Submit answer.");
    } else if (scenario?.kind === "line" || scenario?.kind === "no_answer") {
      setVoiceNote("This scenario sends a scripted patient line automatically after the greeting.");
    } else {
      setVoiceNote(null);
    }
  }

  const activePatient = patients.find((row) => row.id === patientId);
  const selectedScenario = SCENARIOS.find((item) => item.id === selectedScenarioId) ?? SCENARIOS[0];

  const languageLabel =
    SUPPORTED_LANGUAGES.find((option) => option.code === normalizeLanguage(language))?.label ??
    "English (en-US)";

  useEffect(() => {
    if (!isCallLive(phase)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !endingRef.current) {
        event.preventDefault();
        void endCall();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
      <audio ref={audioRef} preload="auto" className="hidden" aria-hidden="true" />
      <PageHeader
        eyebrow="Clinical simulation"
        title="Call simulator"
        subtitle="A call-first medication check-in rehearsal. Speak naturally: the turn is sent when you pause. No real phone call, SMS, or email is sent, and no dosage advice is given."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={speech?.configured || speech?.sttConfigured ? "sage" : "sand"}>
              <Icon name="activity" size={11} />
              {`${sttLabel(speech?.sttProvider ?? "browser")} + ${speech?.ttsProvider === "verbx" ? "VerbX TTS" : "text voice"}`}
            </Badge>
            <Link href={checkInId ? `/check-ins/${checkInId}` : "/check-ins"} className="neo-btn h-8 text-[10px]">
              <Icon name="file" size={12} />
              Evidence
            </Link>
          </div>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <CallStage
            patientName={activePatient?.display_name ?? "Select a patient"}
            languageLabel={languageLabel}
            phase={phase}
            micState={micState}
            micMuted={micMuted}
            speakerOn={speakerOn}
            voiceConfigured={speech?.configured ?? false}
            elapsedSeconds={elapsed}
            levels={levels}
            log={log}
            interim={interim}
            error={error}
            micError={micError}
            voiceNote={voiceNote}
            scenarioLabel={`${selectedScenario.label} - ${selectedScenario.blurb}.`}
            canStart={Boolean(patientId) && !isCallLive(phase)}
            checkInId={checkInId}
            onStart={() => void startCall()}
            onToggleMic={toggleMic}
            onRetryMic={retryMicrophone}
            onToggleSpeaker={toggleSpeaker}
            onEndCall={() => void endCall()}
            onRetryVoice={() => void replayLastReply()}
            canRetryVoice={
              Boolean(lastSpoken) &&
              (phase === "listening" || phase === "text_fallback") &&
              !busy
            }
            onTypedSubmit={(text) => void submitTyped(text)}
            typedText={typedText}
            onTypedTextChange={setTypedText}
          />

          {demoMode === "turn" ? (
            <SectionCard className="mt-4" eyebrow="Turn-based demo" title="Reply as the patient">
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_REPLIES.map((reply) => (
                  <button
                    key={reply}
                    type="button"
                    onClick={() => setTypedText(reply)}
                    className="rounded-lg border border-line-soft bg-white px-2 py-1.5 text-left text-[10px] text-ink hover:border-ink/40"
                  >
                    {reply}
                  </button>
                ))}
              </div>
              <form
                className="mt-3 flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitTyped();
                }}
              >
                <textarea
                  value={typedText}
                  onChange={(event) => setTypedText(event.target.value)}
                  aria-label="Turn-based patient reply"
                  placeholder="Type what the patient says, then submit."
                  rows={3}
                  className="neo-input min-h-20 w-full resize-y text-[11px]"
                />
                <button
                  type="submit"
                  disabled={!typedText.trim() || !isCallLive(phase) || !canSubmitTurn(phase)}
                  className="neo-btn h-9 self-start px-3 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name="send" size={12} />
                  Submit answer
                </button>
              </form>
              <p className="mt-2 text-[9px] leading-relaxed text-ink-muted">
                Turn-based mode keeps the microphone off. Each submit sends one patient turn through the same safety
                rules and complete spoken reply.
              </p>
            </SectionCard>
          ) : null}

          <SectionCard
            className="mt-4"
            eyebrow="Evidence trail"
            title="Full call transcript"
            action={<Badge tone="white">{log.length} entries</Badge>}
            bodyClassName="p-0"
          >
            <ol className="max-h-[300px] overflow-y-auto">
              {log.length === 0 ? (
                <li className="px-4 py-6 text-center text-[11.5px] text-ink-soft">
                  Start the simulated call to record the opening and each patient turn.
                </li>
              ) : (
                log.map((entry, index) => (
                  <li
                    key={`${index}-${entry.role}-${entry.text.slice(0, 12)}`}
                    className="grid grid-cols-[86px_minmax(0,1fr)] gap-2 border-b border-line-soft px-4 py-2 last:border-0"
                  >
                    <span className="text-[8.5px] font-bold tracking-wide text-ink-muted uppercase">
                      {entry.role === "ai"
                        ? "AI caller"
                        : entry.role === "patient"
                          ? activePatient?.display_name.split(" ")[0] ?? "Patient"
                          : entry.role === "decision"
                            ? "Rule engine"
                            : "System"}
                    </span>
                    <span className="text-[11.5px] leading-relaxed text-ink">{entry.text}</span>
                  </li>
                ))
              )}
            </ol>
          </SectionCard>
        </div>

        <aside className="flex flex-col gap-4">
          <SectionCard
            eyebrow="Session"
            title="Patient and scenario"
            action={
              phase === "ended" ? (
                <button type="button" onClick={resetSession} className="text-[9.5px] font-semibold text-ink-soft underline">
                  Reset
                </button>
              ) : null
            }
          >
            <div className="mb-3" role="group" aria-label="Demo mode">
              <span className="text-[9px] font-bold tracking-wide text-ink-muted uppercase">Demo mode</span>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setDemoModeSafe("live")}
                  disabled={isCallLive(phase)}
                  aria-pressed={demoMode === "live"}
                  className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                    demoMode === "live"
                      ? "border-ink bg-ink text-white"
                      : "border-line-soft bg-white text-ink hover:border-ink/40"
                  }`}
                >
                  Live Call
                </button>
                <button
                  type="button"
                  onClick={() => setDemoModeSafe("turn")}
                  disabled={isCallLive(phase)}
                  aria-pressed={demoMode === "turn"}
                  className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                    demoMode === "turn"
                      ? "border-ink bg-ink text-white"
                      : "border-line-soft bg-white text-ink hover:border-ink/40"
                  }`}
                >
                  Turn-Based Demo
                </button>
              </div>
              <p className="mt-1 text-[9px] leading-relaxed text-ink-muted">
                {demoMode === "live"
                  ? "Continuous microphone. A turn is sent after 2.5 s of silence."
                  : "Microphone off. Type or pick a reply, then submit manually."}
              </p>
            </div>
            {status ? (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-line-soft bg-white px-2.5 py-1.5">
                <span className="text-[9px] font-bold tracking-wide text-ink-muted uppercase">Check-in</span>
                <Badge tone={status === "escalated" ? "rose" : "white"}>
                  {status.replaceAll("_", " ")}
                </Badge>
              </div>
            ) : null}
            <label className="block">
              <span className="text-[9px] font-bold tracking-wide text-ink-muted uppercase">Patient</span>
              <select
                value={patientId}
                onChange={(event) => {
                  const id = event.target.value;
                  setPatientId(id);
                  const next = patients.find((row) => row.id === id);
                  if (next) setLanguageSafe(next.preferred_language.split("-")[0] ?? "en");
                }}
                disabled={isCallLive(phase)}
                className="neo-input mt-1 h-9 w-full text-[11px] disabled:opacity-60"
              >
                {patients.length === 0 ? <option value="">Loading patients...</option> : null}
                {patients.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block">
              <span className="text-[9px] font-bold tracking-wide text-ink-muted uppercase">Spoken language</span>
              <select
                value={normalizeLanguage(language)}
                onChange={(event) => setLanguageSafe(event.target.value)}
                disabled={isCallLive(phase)}
                className="neo-input mt-1 h-9 w-full text-[11px] disabled:opacity-60"
              >
                {SUPPORTED_LANGUAGES.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-4">
              <span className="text-[9px] font-bold tracking-wide text-ink-muted uppercase">Rehearsal scenario</span>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {SCENARIOS.map((scenario) => {
                  const selected = selectedScenarioId === scenario.id;
                  return (
                    <button
                      key={scenario.id}
                      type="button"
                      onClick={() => chooseScenario(scenario.id)}
                      disabled={isCallLive(phase)}
                      aria-pressed={selected}
                      className={`rounded-lg border px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? "border-ink bg-ink text-white"
                          : "border-line-soft bg-white text-ink hover:border-ink/40"
                      }`}
                    >
                      <span className="block text-[9.5px] font-bold">{scenario.label}</span>
                      <span className={`block text-[8.5px] leading-tight ${selected ? "text-white/60" : "text-ink-muted"}`}>
                        {scenario.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </SectionCard>

          <SectionCard eyebrow="Safety rules" title="Latest decisions" tone="sand">
            {decisions.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-ink-soft">
                Decisions appear here after the first patient turn. The rule engine, not the caller, decides escalation.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {decisions.slice(-5).map((decision, index) => (
                  <li key={`${decision.type}-${index}`} className="flex items-center justify-between gap-2">
                    <span className="text-[10.5px] font-semibold text-ink">
                      {decision.type.replaceAll("_", " ")}
                    </span>
                    <Badge tone={decision.status === "escalated" ? "rose" : "white"}>{decision.status.replaceAll("_", " ")}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {conversationState ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line-soft pt-3 text-[10px]">
                <div>
                  <dt className="text-[8px] font-bold tracking-wide text-ink-muted uppercase">Medication</dt>
                  <dd className="font-semibold text-ink">{conversationState.medicationStatus.replaceAll("_", " ")}</dd>
                </div>
                <div>
                  <dt className="text-[8px] font-bold tracking-wide text-ink-muted uppercase">Escalation</dt>
                  <dd className="font-semibold text-ink">{conversationState.escalation.replaceAll("_", " ")}</dd>
                </div>
                <div>
                  <dt className="text-[8px] font-bold tracking-wide text-ink-muted uppercase">Symptoms</dt>
                  <dd className="font-semibold text-ink">
                    {conversationState.symptoms.length > 0
                      ? conversationState.symptoms.join(", ").replaceAll("_", " ")
                      : "none reported"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[8px] font-bold tracking-wide text-ink-muted uppercase">Reply source</dt>
                  <dd className="font-semibold text-ink">{replySource ?? "n/a"}</dd>
                </div>
                {conversationState.openQuestions.length > 0 ? (
                  <div className="col-span-2">
                    <dt className="text-[8px] font-bold tracking-wide text-ink-muted uppercase">Open questions</dt>
                    <dd className="font-semibold text-ink">{conversationState.openQuestions.join(", ")}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </SectionCard>

          <SectionCard eyebrow="How it works" title="Voice path" tone="white">
            <ul className="flex flex-col gap-2 text-[10.5px] leading-relaxed text-ink-soft">
              <li className="flex gap-2">
                <Icon name="mic" size={12} />
                <span>Continuous listening with 2.5 s silence detection. The first syllable may be missed during playback.</span>
              </li>
              <li className="flex gap-2">
                <Icon name="activity" size={12} />
                <span>
                  {speech && (speech.sttConfigured || speech.configured)
                    ? `Active speech: ${sttLabel(speech.sttProvider)} and ${speech.ttsProvider === "verbx" ? "VerbX TTS" : "text-only playback"}. Selection: ${speech.sttSelection}. Failures are shown above; the app never silently swaps provider mid-turn.`
                    : "No live speech provider is configured. Browser live STT or typed turns are used; voice playback is text-only."}
                </span>
              </li>
              {latency ? (
                <li className="flex gap-2">
                  <Icon name="clock" size={12} />
                  <span>
                    Last turn: reply {latency.replyMs} ms, first audio{" "}
                    {latency.firstAudioMs === null ? "unavailable" : `${latency.firstAudioMs} ms`}
                    , listening resumed {latency.resumedMs} ms.
                  </span>
                </li>
              ) : null}
              <li className="flex gap-2">
                <Icon name="alert" size={12} />
                <span>No dosage advice, no real calls, no real notifications. All data is synthetic.</span>
              </li>
            </ul>
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}
