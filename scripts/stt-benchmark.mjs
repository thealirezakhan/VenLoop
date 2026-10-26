#!/usr/bin/env node
/**
 * Groq Whisper STT benchmark: WER, CER and latency against a local manifest.
 *
 * Usage:
 *   node --env-file=.env.local scripts/stt-benchmark.mjs [--dir tests/fixtures/stt]
 *        [--model whisper-large-v3-turbo] [--no-prompt] [--language en]
 *
 * Manifest format: [{ "file": "sample.wav", "text": "reference sentence" }]
 * Audio never leaves the machine except to the configured Groq endpoint.
 * Results are synthetic-audio measurements, not human microphone accuracy.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const dir = resolve(option("--dir", "tests/fixtures/stt"));
const manifestPath = join(dir, "manifest.json");
const model = option("--model", process.env.GROQ_STT_MODEL ?? "whisper-large-v3-turbo");
const language = option("--language", "en");
const apiKey = process.env.GROQ_API_KEY;
const comparePrompt = !flag("--no-prompt");

if (!apiKey) {
  console.error("GROQ_API_KEY is not set. Run with: node --env-file=.env.local scripts/stt-benchmark.mjs");
  process.exit(2);
}
if (!existsSync(manifestPath)) {
  console.error(`No manifest at ${manifestPath}. Add real or synthetic audio first.`);
  process.exit(2);
}

const entries = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
if (!Array.isArray(entries) || entries.length === 0) {
  console.error("Manifest is empty.");
  process.exit(2);
}

const PROMPT =
  "Medication check-in for an older adult. Words: medicine, medication, tablet, pill, dose, taken, not taken, fever, feverish, dizziness, nausea, caregiver.";

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(a, b, unit) {
  const left = unit === "word" ? a.split(" ") : [...a];
  const right = unit === "word" ? b.split(" ") : [...b];
  if (left.length === 0) return right.length;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function score(reference, hypothesis) {
  const ref = normalize(reference);
  const hyp = normalize(hypothesis);
  const refWords = ref ? ref.split(" ").length : 0;
  const refChars = ref.replace(/\s/g, "").length || 1;
  return {
    wer: editDistance(ref, hyp, "word") / Math.max(1, refWords),
    cer: editDistance(ref.replace(/\s/g, ""), hyp.replace(/\s/g, ""), "char") / refChars,
  };
}

async function transcribe(file, usePrompt) {
  const bytes = readFileSync(join(dir, file));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/wav" }), file);
  form.append("model", model);
  form.append("language", language);
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (usePrompt) form.append("prompt", PROMPT);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const startedAt = performance.now();
    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    if (response.status === 429 && attempt < 3) {
      const waitSeconds = Number.parseInt(response.headers.get("retry-after") ?? "62", 10);
      await new Promise((resolve) => setTimeout(resolve, (waitSeconds + 1) * 1000));
      continue;
    }
    if (!response.ok) {
      throw new Error(`${file}: HTTP ${response.status} ${await response.text()}`);
    }
    const body = await response.json();
    return { text: String(body.text ?? "").trim(), latencyMs };
  }
  throw new Error(`${file}: rate limited`);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

async function run(usePrompt) {
  const rows = [];
  for (const entry of entries) {
    const result = await transcribe(entry.file, usePrompt);
    rows.push({
      ...entry,
      hypothesis: result.text,
      latencyMs: result.latencyMs,
      ...score(entry.text, result.text),
    });
  }
  return {
    label: usePrompt ? "prompt" : "no prompt",
    rows,
    wer: rows.reduce((sum, row) => sum + row.wer, 0) / rows.length,
    cer: rows.reduce((sum, row) => sum + row.cer, 0) / rows.length,
    p50Ms: median(rows.map((row) => row.latencyMs)),
  };
}

function printRun(run) {
  console.log(`\n=== ${run.label} (${model}) ===`);
  for (const row of run.rows) {
    console.log(
      `${row.file.padEnd(32)} WER ${(row.wer * 100).toFixed(1).padStart(5)}%  ` +
        `CER ${(row.cer * 100).toFixed(1).padStart(5)}%  ${String(row.latencyMs).padStart(5)} ms`,
    );
    console.log(`  ref: ${row.text}`);
    console.log(`  hyp: ${row.hypothesis}`);
  }
  console.log(
    `mean WER ${(run.wer * 100).toFixed(1)}% | mean CER ${(run.cer * 100).toFixed(1)}% | ` +
      `p50 latency ${run.p50Ms} ms | ${run.rows.length} clips`,
  );
}

const runs = [];
runs.push(await run(false));
if (comparePrompt) runs.push(await run(true));
runs.forEach(printRun);
console.log("\nSynthetic TTS clips: treat as a regression benchmark, not human microphone accuracy.");
