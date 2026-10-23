export type CallPhase =
  | "idle"
  | "requesting_mic"
  | "connecting"
  | "listening"
  | "processing"
  | "speaking"
  | "text_fallback"
  | "ended"
  | "error";

export type MicState = "off" | "requesting" | "ready" | "denied" | "error";

export type CallLogRole = "system" | "ai" | "patient" | "decision";

export interface CallLogEntry {
  role: CallLogRole;
  text: string;
}

export function isCallLive(phase: CallPhase): boolean {
  return phase !== "idle" && phase !== "ended" && phase !== "error";
}

export function canSubmitTurn(phase: CallPhase): boolean {
  return phase === "listening" || phase === "text_fallback" || phase === "speaking";
}

export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function phaseLabel(phase: CallPhase, micMuted: boolean, speakerOn: boolean): string {
  switch (phase) {
    case "idle":
      return "Ready to call";
    case "requesting_mic":
      return "Microphone permission";
    case "connecting":
      return "Connecting";
    case "listening":
      return micMuted ? "Microphone muted" : "Listening";
    case "processing":
      return "Processing reply";
    case "speaking":
      return speakerOn ? "AI speaking" : "Reply muted";
    case "text_fallback":
      return "Text fallback";
    case "ended":
      return "Call ended";
    case "error":
      return "Needs attention";
  }
}

export function phaseDetail(phase: CallPhase): string {
  switch (phase) {
    case "idle":
      return "Start a simulated medication check-in. No real call is placed.";
    case "requesting_mic":
      return "Allow microphone access so the patient can answer naturally.";
    case "connecting":
      return "Creating the check-in and preparing the first sentence.";
    case "listening":
      return "Speak naturally. The turn is sent when you pause.";
    case "processing":
      return "The patient turn is being analysed and safety rules are being applied.";
    case "speaking":
      return "Microphone capture is paused during playback to prevent echo.";
    case "text_fallback":
      return "Microphone or speech recognition is unavailable. Type a reply below.";
    case "ended":
      return "Capture is stopped. The transcript and decisions are saved as evidence.";
    case "error":
      return "The call could not continue. Read the message and retry.";
  }
}
