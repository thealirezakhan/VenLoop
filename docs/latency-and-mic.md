# Voice latency and microphone notes

Provider measurements were taken 22 Oct 2026 against the local app with live
VerbX TTS/translation and Groq configured. The call-first UI was measured
separately; no numbers here are fabricated.

## Provider capabilities

- `POST /v1/stt` is batch-only. It accepts `audioBase64` (through
  `/api/v1/speech/stt`) and returns one final transcript. It does not stream
  partial results, so the simulator cannot get interim hypotheses from VerbX.
- `POST /v1/tts` returns one audio file per request. `options.stream: true`
  returns HTTP 200 with an empty body for mp3/wav/ogg/pcm, so provider-side
  streaming is not usable.
- An observed VerbX STT failure returns HTTP 200 with
  `{ "text": "", "degraded": true, "degraded_reason": "provider_outage", "served_by_tier": "refuse" }`.
  The adapter correctly rejects the empty transcript. TTS and translation are
  unaffected.

## Microphone path

1. When VerbX is configured, live audio is captured with `MediaRecorder`
   (WebM/Opus when supported), encoded as base64, and posted to
   `/api/v1/speech/stt`, which calls the documented batch `POST /v1/stt` with
   the normalized locale (`en`, `hi`, `mr`). A turn is sent after 2.5 s of
   silence; resumed speech resets the silence window.
2. If VerbX is not configured, or the provider fails, browser
   `SpeechRecognition` is used. Its silence timer is also 2.5 s and is reset by
   each result; partial results never finalize a turn by themselves.
3. If the browser API is missing or fails with `network`, `not-supported`,
   `service-not-allowed`, `not-allowed`, or `audio-capture`, the simulator
   returns to the recorded batch path.
4. The typed fallback is always available and exercises the same turn logic.
   Turn-Based Demo keeps the microphone off and submits only on the button.

The call is half-duplex: microphone capture is paused while TTS plays to prevent
echo. Starting the mic or submitting typed text during playback stops the
current reply (barge-in), but the first syllable of a reply may be missed. This
is a deliberate trade-off, not a claimed full-duplex system.

Timing constants:

| Setting | Value |
|---|---:|
| Silence before a turn is finalized (VerbX or browser) | 2500 ms |
| Silence before recorded VAD stops the utterance | 2500 ms |
| Recognition restart after `end` | 300 ms |
| Barge-in RMS threshold | 0.11 |
| Barge-in hold before stopping playback | 240 ms |
| Barge-in grace after playback starts | 500 ms |
| Microphone permission timeout | 12 s |
| Fallback VAD speech threshold | 0.025 |
| Fallback VAD minimum speech | 220 ms |

## Latency measurements

Measured 22 Oct 2026 on the previous demo page; the backend path is unchanged.

| Change | Effect |
|---|---|
| Deterministic fast path in `analyzeTurn` | Safety-relevant turns (adherence, symptoms, dosage, emergency, closing) no longer wait ~2 s for a Groq summary that cannot override the rules. |
| Phrase-chunked TTS | Reply is split at sentence boundaries (max 140 chars); playback starts on the first chunk while the next chunk downloads. |
| Greeting cache | Fixed greeting audio is reused per language in memory. |
| Warm safety copy | Once "Speak replies" is enabled, the first phrase of fixed adherence, symptom, dosage, and emergency replies is pre-synthesised in the background. Only deterministic scripted copy is cached. |
| Barge-in | Mic start or a new submit aborts pending TTS and pauses current audio. |

Warm-up costs 4 TTS calls for English (adherence, symptom, dosage, emergency)
and 2 for Hindi/Marathi (adherence, emergency) when the call starts and the
speaker is enabled. If the provider rate-limits or fails, the live request still
runs.

English routine turn:

| Stage | Before | After, no warm-up | After, warm |
|---|---:|---:|---:|
| Submit / rules / persist | 2,534 ms | 668 ms | 384 to 855 ms |
| First TTS audio | 3,907 ms (full reply) | 1,454 ms (first phrase) | cached |
| First audible response | **6,441 ms** | **2,122 ms** | **977 to 1,274 ms** |

Warm browser runs, adherence turn:

| Language | Submit | First audible |
|---|---:|---:|
| English | 384 to 855 ms | **977 to 1,274 ms** |
| Hindi | 1,746 ms | **2,096 ms** |
| Marathi | 1,039 ms | **1,393 ms** |

The 800 to 1,200 ms target is met for warm English turns. Hindi and Marathi
remain above it in some runs because VerbX translation takes roughly 0.6 to
2.2 s; that work happens before the reply exists, so TTS caching cannot hide it.
Provider variance also produced 2.8 s English outliers on cold runs.

The baseline used the old full-clip playback path and an LLM call. Hindi/Marathi
baseline runs used romanised input, which the live translator misread and sent
through the LLM fallback (5.9 to 9.7 s); they are not directly comparable.

## Remaining bottlenecks

- Non-English translation latency, not TTS, is the limit for Hindi and Marathi.
- VerbX TTS still costs ~1.1 to 1.5 s per short phrase when not cached, with
  occasional 3 to 5 s responses.
- VerbX STT is batch-only, so no live captions or partial turns come from the
  provider.
- Prewarm adds provider calls. If the 30/min TTS limit is exhausted, playback
  falls back to the live request and misses the target.
- Browser speech recognition availability varies. When it is unavailable the
  MediaRecorder fallback adds one upload/STT round trip per turn.

## Verification

Current:

- `pnpm lint`, `pnpm typecheck`: pass
- `pnpm exec vitest run tests/unit/voice-activity.test.ts tests/unit/call-state.test.ts`: 12 passed
- Focused call-simulator E2E (label, turn-based manual submit, nausea, emergency): 4 passed

Live provider check on 23 Oct 2026 used TTS-generated MP3 and WAV audio against
`POST /v1/stt` with locale `en` and `en-US`. The provider returned either HTTP
503 or HTTP 200 with empty text and `degraded_reason: "provider_outage"`, so
real VerbX transcription is still not verified. The app now falls back to
browser recognition after that failure.

Limitation: Playwright runs without microphone permission, so automated tests
cover the permission-failure, manual turn-based, and typed-fallback paths. Real
acoustic mic input and full-duplex conversation were not verified in this
environment.
