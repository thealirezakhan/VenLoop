import { describe, expect, it } from "vitest";
import { resolveSttProvider, sttPromptFor } from "@/modules/providers/speech";

const none = { groqConfigured: false, verbxConfigured: false };

describe("resolveSttProvider", () => {
  it("prefers configured Groq over browser recognition in auto mode", () => {
    expect(
      resolveSttProvider({
        selection: "auto",
        browserSupported: true,
        groqConfigured: true,
        verbxConfigured: true,
      }),
    ).toEqual({ provider: "groq", fallback: false, reason: "selected" });
  });

  it("uses VerbX before the browser when Groq is not configured", () => {
    expect(
      resolveSttProvider({
        selection: "auto",
        browserSupported: true,
        groqConfigured: false,
        verbxConfigured: true,
      }),
    ).toEqual({ provider: "verbx", fallback: false, reason: "selected" });
  });

  it("falls back to the browser in auto mode when no batch provider is configured", () => {
    expect(
      resolveSttProvider({
        selection: "auto",
        browserSupported: true,
        groqConfigured: false,
        verbxConfigured: false,
      }),
    ).toEqual({ provider: "browser", fallback: false, reason: "selected" });
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

  it("uses a domain vocabulary prompt for English only", () => {
    expect(sttPromptFor("en")).toMatch(/medicine/i);
    expect(sttPromptFor("hi")).toBeNull();
    expect(sttPromptFor("mr")).toBeNull();
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
