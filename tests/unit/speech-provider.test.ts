import { describe, expect, it } from "vitest";
import { resolveSttProvider } from "@/modules/providers/speech";

const none = { groqConfigured: false, verbxConfigured: false };

describe("resolveSttProvider", () => {
  it("prefers live browser recognition in auto mode", () => {
    expect(
      resolveSttProvider({
        selection: "auto",
        browserSupported: true,
        groqConfigured: true,
        verbxConfigured: true,
      }),
    ).toEqual({ provider: "browser", fallback: false, reason: "selected" });
  });

  it("uses Groq before VerbX when the browser has no recognizer", () => {
    expect(
      resolveSttProvider({
        selection: "auto",
        browserSupported: false,
        groqConfigured: true,
        verbxConfigured: true,
      }),
    ).toEqual({ provider: "groq", fallback: false, reason: "browser_unavailable" });
  });

  it("uses VerbX when it is the only configured batch provider", () => {
    expect(
      resolveSttProvider({
        selection: "auto",
        browserSupported: false,
        groqConfigured: false,
        verbxConfigured: true,
      }),
    ).toEqual({ provider: "verbx", fallback: false, reason: "browser_unavailable" });
  });

  it("honours an explicit Groq selection", () => {
    expect(
      resolveSttProvider({
        selection: "groq",
        browserSupported: true,
        groqConfigured: true,
        verbxConfigured: true,
      }),
    ).toEqual({ provider: "groq", fallback: false, reason: "selected" });
  });

  it("reports an unavailable Groq selection instead of silently using VerbX", () => {
    expect(
      resolveSttProvider({
        selection: "groq",
        browserSupported: true,
        groqConfigured: false,
        verbxConfigured: true,
      }),
    ).toEqual({ provider: "browser", fallback: true, reason: "groq_unavailable" });
  });

  it("honours an explicit VerbX selection and reports browser fallback", () => {
    expect(
      resolveSttProvider({
        selection: "verbx",
        browserSupported: true,
        ...none,
      }),
    ).toEqual({ provider: "browser", fallback: true, reason: "verbx_unavailable" });
  });

  it("returns typed text mode when no voice provider is available", () => {
    expect(
      resolveSttProvider({
        selection: "browser",
        browserSupported: false,
        ...none,
      }),
    ).toEqual({ provider: "text", fallback: true, reason: "none_available" });
  });
});
