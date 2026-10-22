import { describe, expect, it } from "vitest";
import {
  playSpeechResponse,
  splitForSpeech,
  type SpeechPlaybackResult,
} from "@/modules/audio/speech-playback";

const RESPONSE =
  "Good morning, Eleanor. I am calling for your medication check-in. Have you taken your medication today? If you are feeling unwell, please tell me what symptoms you are experiencing.";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("speech playback queue", () => {
  it("splits the full response into complete ordered segments without losing text", () => {
    const segments = splitForSpeech(RESPONSE);

    expect(segments.join(" ")).toBe(RESPONSE);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toContain("Good morning, Eleanor.");
    expect(segments[0]).toContain("Have you taken your medication today?");
    expect(segments[1]).toBe(
      "If you are feeling unwell, please tell me what symptoms you are experiencing.",
    );
  });

  it("submits the same segments to TTS that it plays, in order, without overlap", async () => {
    const segments = splitForSpeech(RESPONSE);
    const synthesized: string[] = [];
    const events: string[] = [];
    let active = 0;

    const result = await playSpeechResponse({
      text: RESPONSE,
      signal: new AbortController().signal,
      isCurrent: () => true,
      synthesize: async (text) => {
        await delay(text.includes("medication check-in") ? 40 : 5);
        synthesized.push(text);
        return new Blob([text]);
      },
      play: async (blob) => {
        active += 1;
        expect(active).toBe(1);
        const text = await blob.text();
        events.push(`start:${text}`);
        await delay(10);
        events.push(`end:${text}`);
        active -= 1;
      },
      onError: () => {
        throw new Error("unexpected playback error");
      },
    });

    expect(result).toBe<SpeechPlaybackResult>("completed");
    expect(synthesized).toEqual(segments);
    expect(events).toEqual(segments.flatMap((text) => [`start:${text}`, `end:${text}`]));
  });

  it("waits for audio to finish before starting the next segment", async () => {
    const segments = splitForSpeech(RESPONSE);
    const order: string[] = [];

    await playSpeechResponse({
      text: RESPONSE,
      signal: new AbortController().signal,
      isCurrent: () => true,
      synthesize: async (text) => new Blob([text]),
      play: async (blob) => {
        const text = await blob.text();
        order.push(`start:${text}`);
        await delay(5);
        order.push(`end:${text}`);
      },
      onError: () => undefined,
    });

    expect(order).toEqual(segments.flatMap((text) => [`start:${text}`, `end:${text}`]));
  });

  it("reports a failed segment and does not play later text", async () => {
    const segments = splitForSpeech(RESPONSE);
    const starts: string[] = [];
    const errors: string[] = [];

    const result = await playSpeechResponse({
      text: RESPONSE,
      signal: new AbortController().signal,
      isCurrent: () => true,
      synthesize: async (text) => (text === segments[1] ? null : new Blob([text])),
      play: async (blob) => {
        starts.push(await blob.text());
      },
      onError: (message) => errors.push(message),
    });

    expect(result).toBe("failed");
    expect(starts).toEqual([segments[0]]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/phrase 2 of 2/);
  });

  it("stops the old response on explicit interruption", async () => {
    const controller = new AbortController();
    const starts: string[] = [];
    const errors: string[] = [];
    setTimeout(() => controller.abort(), 5);

    const result = await playSpeechResponse({
      text: RESPONSE,
      signal: controller.signal,
      isCurrent: () => true,
      synthesize: async (text) => new Blob([text]),
      play: async (blob, signal) => {
        starts.push(await blob.text());
        await delay(20);
        if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      },
      onError: (message) => errors.push(message),
    });

    expect(result).toBe("cancelled");
    expect(starts).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("ignores stale turns without reporting an error", async () => {
    let current = true;
    const starts: string[] = [];
    const errors: string[] = [];

    const result = await playSpeechResponse({
      text: RESPONSE,
      signal: new AbortController().signal,
      isCurrent: () => current,
      synthesize: async (text) => new Blob([text]),
      play: async (blob) => {
        starts.push(await blob.text());
        current = false;
      },
      onError: (message) => errors.push(message),
    });

    expect(result).toBe("cancelled");
    expect(starts).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("keeps Hindi and Marathi responses complete and ordered", async () => {
    const responses = [
      "सुप्रभात, एलेनोर। यह आपकी दवा जांच कॉल है। क्या आपने आज अपनी दवा ली?",
      "सुप्रभात, एलेनोर. ही तुमची औषध तपासणी कॉल आहे. तुम्ही आज तुमचे औषध घेतले का?",
    ];

    for (const text of responses) {
      const segments = splitForSpeech(text);
      const played: string[] = [];
      const result = await playSpeechResponse({
        text,
        signal: new AbortController().signal,
        isCurrent: () => true,
        synthesize: async (segment) => new Blob([segment]),
        play: async (blob) => {
          played.push(await blob.text());
        },
        onError: () => {
          throw new Error("unexpected playback error");
        },
      });

      expect(result).toBe("completed");
      expect(played).toEqual(segments);
      expect(played.join(" ")).toBe(text);
    }
  });
});
