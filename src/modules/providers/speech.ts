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
 * One place decides the active STT provider. `auto` prefers the browser's live
 * recognizer because it starts before silence detection; a configured batch
 * provider is the fallback when the browser has no recognizer.
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

  if (browserSupported) return { provider: "browser", fallback: false, reason: "selected" };
  if (groqConfigured) {
    return { provider: "groq", fallback: false, reason: "browser_unavailable" };
  }
  if (verbxConfigured) {
    return { provider: "verbx", fallback: false, reason: "browser_unavailable" };
  }
  return { provider: "text", fallback: true, reason: "none_available" };
}
