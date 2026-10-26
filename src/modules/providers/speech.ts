export type SttProviderId = "browser" | "groq" | "verbx" | "text";
export type SttSelection = "auto" | "browser" | "groq" | "verbx";

export interface SttResolution {
  provider: SttProviderId;
  fallback: boolean;
  reason:
    | "selected"
    | "browser_unavailable"
    | "groq_unavailable"
    | "verbx_unavailable"
    | "none_available";
}

/**
 * One place decides the active STT provider. `auto` prefers a configured batch
 * provider (Groq, then VerbX) because it transcribes the recorded turn with a
 * full acoustic model; the browser recognizer is only the fallback when no
 * batch provider is available.
 *
 * An explicit selection never switches to a different remote provider. It may
 * fall back to the browser (with `fallback: true`) or typed text.
 */
export function resolveSttProvider(input: {
  selection: SttSelection;
  browserSupported: boolean;
  groqConfigured: boolean;
  verbxConfigured: boolean;
}): SttResolution {
  const { selection, browserSupported, groqConfigured, verbxConfigured } = input;

  if (selection === "groq") {
    if (groqConfigured) return { provider: "groq", fallback: false, reason: "selected" };
    if (browserSupported) {
      return { provider: "browser", fallback: true, reason: "groq_unavailable" };
    }
    return { provider: "text", fallback: true, reason: "none_available" };
  }

  if (selection === "verbx") {
    if (verbxConfigured) return { provider: "verbx", fallback: false, reason: "selected" };
    if (browserSupported) {
      return { provider: "browser", fallback: true, reason: "verbx_unavailable" };
    }
    return { provider: "text", fallback: true, reason: "none_available" };
  }

  if (selection === "browser") {
    if (browserSupported) return { provider: "browser", fallback: false, reason: "selected" };
    if (groqConfigured) {
      return { provider: "groq", fallback: true, reason: "browser_unavailable" };
    }
    if (verbxConfigured) {
      return { provider: "verbx", fallback: true, reason: "browser_unavailable" };
    }
    return { provider: "text", fallback: true, reason: "none_available" };
  }

  if (groqConfigured) return { provider: "groq", fallback: false, reason: "selected" };
  if (verbxConfigured) return { provider: "verbx", fallback: false, reason: "selected" };
  if (browserSupported) return { provider: "browser", fallback: false, reason: "selected" };
  return { provider: "text", fallback: true, reason: "none_available" };
}

/**
 * Vocabulary hint for Whisper. English only: a prompt in the wrong language
 * biases transcription away from what the patient actually said.
 */
export function sttPromptFor(language: string): string | null {
  if (language !== "en") return null;
  return "Medication check-in for an older adult. Words: medicine, medication, tablet, pill, dose, taken, not taken, fever, feverish, dizziness, nausea, caregiver.";
}
