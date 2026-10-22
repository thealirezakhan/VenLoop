# Voice latency and microphone notes

Measured 22 Oct 2026 against the local app with live VerbX TTS/translation and
Groq configured. Numbers are wall-clock and synthetic demo data only.

## Microphone root cause

VerbX `POST /v1/stt` currently returns HTTP 200 with:

```json
{ "text": "", "degraded": true, "degraded_reason": "provider_outage", "served_by_tier": "refuse" }
```

The adapter correctly rejects the empty transcript, so the simulator's
VerbX-only microphone path could never produce text. TTS and translation are
unaffected.

Fix in `src/app/demo/call-simulator/page.tsx`:

- Browser speech recognition is now the primary microphone path. It streams
  interim results and auto-submits 700 ms after the last result.
- If the browser API is missing or fails with `network` / `service-not-allowed`
  / `audio-capture`, the simulator falls back to VerbX batch STT.
- The VerbX recorder has an energy VAD: it stops after 800 ms of silence once
  speech starts (8 s timeout if no speech) instead of requiring a manual stop.
- Starting the mic stops any playing reply (barge-in) and cancels pending TTS.

The badge now says “Browser STT · VerbX TTS” so the UI does not claim a working
VerbX STT path.

## Latency changes

| Change | Effect |
|---|---|
| Deterministic fast path in `analyzeTurn` | Safety-relevant turns (adherence, symptoms, dosage, emergency, closing) no longer wait ~2 s for a Groq summary that cannot override the rules. |
| Phrase-chunked TTS | Reply is split at sentence boundaries (max 140 chars); playback starts on the first chunk while the next chunk downloads. |
| Greeting cache | Fixed greeting audio is reused per language in memory. |
| Warm safety copy | Once “Speak replies” is enabled, the first phrase of fixed adherence, symptom, dosage, and emergency replies is pre-synthesised in the background. Only deterministic scripted copy is cached. |
| Barge-in | Mic start or a new submit aborts pending TTS and pauses current audio. |

Warm-up costs 4 TTS calls for English (adherence, symptom, dosage, emergency)
and 2 for Hindi/Marathi (adherence, emergency) when the call starts and the
speaker is enabled. If the provider rate-limits or fails, the live request still
runs.

## Measurements (English routine turn)

| Stage | Before | After, no warm-up | After, warm |
|---|---:|---:|---:|
| Submit / rules / persist | 2,534 ms | 668 ms | 384–855 ms |
| First TTS audio | 3,907 ms (full reply) | 1,454 ms (first phrase) | cached |
| First audible response | **6,441 ms** | **2,122 ms** | **977–1,274 ms** |

Warm browser runs, adherence turn:

| Language | Submit | First audible |
|---|---:|---:|
| English | 384–855 ms | **977–1,274 ms** |
| Hindi | 1,746 ms | **2,096 ms** |
| Marathi | 1,039 ms | **1,393 ms** |

The 800–1,200 ms target is met for warm English turns. Hindi and Marathi remain
above it in some runs because VerbX translation takes roughly 0.6–2.2 s; that
work happens before the reply exists, so TTS caching cannot hide it. Provider
variance also produced 2.8 s English outliers on cold runs.

Baseline used the old full-clip playback path and LLM call. Hindi/Marathi
baseline runs used romanised input, which the live translator misread and sent
through the LLM fallback (5.9–9.7 s); they are not directly comparable.

## Remaining bottleneck

- Non-English translation latency, not TTS, is now the limit for Hindi and
  Marathi.
- VerbX TTS still costs ~1.1–1.5 s per short phrase when not cached, with
  occasional 3–5 s responses.
- `options.stream: true` returns HTTP 200 with an empty body for mp3/wav/ogg/pcm,
  so provider-side streaming is not usable.
- Prewarm adds provider calls. If the 30/min TTS limit is exhausted, playback
  falls back to the live request and misses the target.

No latency numbers are fabricated; the browser runs show real provider variance.

## Verification

- `pnpm lint`, `pnpm typecheck`: pass
- `pnpm test`: 91 passed / 11 files
- `pnpm test:e2e`: 9 passed
- `pnpm build`: pass, 35 static pages
