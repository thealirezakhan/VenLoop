#!/usr/bin/env node
/**
 * Build telephone-like noisy variants of the synthetic STT fixtures:
 * 16 kHz mono, 12 dB SNR white noise, 300-3400 Hz band limit.
 * Deterministic output so benchmark numbers are repeatable.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const source = process.argv[2] ?? "tests/fixtures/stt";
const target = process.argv[3] ?? join(source, "noisy");
mkdirSync(target, { recursive: true });

function parseWav(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF") throw new Error("not a WAV");
  let offset = 12;
  let fmt = null;
  let samples = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      samples = buffer.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !samples || fmt.bits !== 16 || fmt.channels !== 1) {
    throw new Error("expected 16-bit mono PCM");
  }
  return { fmt, samples };
}

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function toNoisyWav(sourceBuffer, seed) {
  const { fmt, samples } = parseWav(sourceBuffer);
  const input = new Int16Array(samples.buffer, samples.byteOffset, samples.length / 2);
  const output = new Int16Array(input.length);
  const random = rng(seed);

  const alphaLow = 1 - Math.exp((-2 * Math.PI * 3400) / fmt.sampleRate);
  const alphaHigh = 1 - Math.exp((-2 * Math.PI * 300) / fmt.sampleRate);
  let low = 0;
  let high = 0;
  let signalEnergy = 0;
  for (const value of input) signalEnergy += value * value;
  const signalRms = Math.sqrt(signalEnergy / input.length) || 1;
  const noiseRms = signalRms / Math.pow(10, 12 / 20);

  for (let i = 0; i < input.length; i += 1) {
    low += alphaLow * (input[i] - low);
    high += alphaHigh * (low - high);
    const bandLimited = low - high;
    const noise = (random() * 2 - 1) * noiseRms * Math.sqrt(3);
    output[i] = Math.max(-32768, Math.min(32767, Math.round(bandLimited + noise)));
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + output.byteLength, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(fmt.sampleRate, 24);
  header.writeUInt32LE(fmt.sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(output.byteLength, 40);
  return Buffer.concat([header, Buffer.from(output.buffer)]);
}

const files = readdirSync(source).filter((name) => name.endsWith(".wav"));
for (const [index, file] of files.entries()) {
  const output = toNoisyWav(readFileSync(join(source, file)), index + 1);
  writeFileSync(join(target, file), output);
}

const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
writeFileSync(join(target, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${files.length} noisy clips to ${target}`);

