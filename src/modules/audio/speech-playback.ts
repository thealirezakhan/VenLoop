export const CHUNK_CHARS = 140;

export function splitForSpeech(text: string): string[] {
  const sentences = text.match(/[^.!?।॥]+[.!?।॥]*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (current && current.length + piece.length + 1 > CHUNK_CHARS) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks.flatMap((chunk) => {
    if (chunk.length <= CHUNK_CHARS) return [chunk];
    const words = chunk.split(/\s+/);
    const parts: string[] = [];
    let line = "";
    for (const word of words) {
      if (line && line.length + word.length + 1 > CHUNK_CHARS) {
        parts.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) parts.push(line);
    return parts;
  });
}

export type SpeechPlaybackResult = "completed" | "cancelled" | "failed";

export interface SpeechPlaybackOptions {
  text: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
  synthesize: (text: string, signal: AbortSignal) => Promise<Blob | null>;
  play: (blob: Blob, signal: AbortSignal) => Promise<void>;
  onError: (message: string) => void;
}

/**
 * Plays one response as an ordered queue. Synthesis may run one segment ahead,
 * but playback is strictly serial: the next segment starts only after the
 * previous audio has ended. A stale turn or abort stops the queue without
 * reporting an error.
 */
export async function playSpeechResponse(
  options: SpeechPlaybackOptions,
): Promise<SpeechPlaybackResult> {
  const segments = splitForSpeech(options.text);
  if (segments.length === 0) return "completed";

  const current = () => options.isCurrent() && !options.signal.aborted;
  let pending: Promise<Blob | null> = options.synthesize(segments[0], options.signal);

  try {
    for (let index = 0; index < segments.length; index += 1) {
      const blob = await pending;
      if (!current()) return "cancelled";
      if (!blob || blob.size === 0) {
        options.onError(
          `Voice playback stopped at phrase ${index + 1} of ${segments.length}. The full reply is still shown as text.`,
        );
        return "failed";
      }

      pending =
        index + 1 < segments.length
          ? options.synthesize(segments[index + 1], options.signal).catch(() => null)
          : Promise.resolve(null);

      try {
        await options.play(blob, options.signal);
      } catch {
        if (!current()) return "cancelled";
        options.onError(
          `Voice playback failed at phrase ${index + 1} of ${segments.length}. The full reply is still shown as text.`,
        );
        return "failed";
      }
      if (!current()) return "cancelled";
    }
    return "completed";
  } catch {
    if (!current()) return "cancelled";
    options.onError("Voice playback unavailable - continuing with text.");
    return "failed";
  }
}
