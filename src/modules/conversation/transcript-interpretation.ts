import { extractSignals, type ExtractedSignals } from "@/modules/rules-engine/extract";
import { normalizeLanguage } from "./language";

/**
 * Conservative interpretation of an STT transcript before decision-making.
 *
 * This layer NEVER rewrites a safety-critical statement. It preserves the raw
 * transcript, exposes uncertainty/temporal/confusion signals, and returns
 * correction candidates that require explicit confirmation. When adherence is
 * locked, the caller must not let an LLM or keyword matcher guess a status.
 */

export type TemporalScope = "current" | "previous_day" | "unclear";

export type CorrectionKind =
  | "temporal_scope"
  | "uncertainty"
  | "mixed_language"
  | "stt_confusion";

export interface CorrectionCandidate {
  kind: CorrectionKind;
  proposedValue: string;
  reason: string;
  requiresConfirmation: true;
}

export interface InterpretedSignals extends ExtractedSignals {
  adherenceLocked: boolean;
  uncertainty: boolean;
  previousDayReference: boolean;
  mixedLanguage: boolean;
  temporalScope: TemporalScope;
}

export interface TranscriptInterpretation {
  rawTranscript: string;
  normalizedTranscript: string;
  correctedTranscript: string;
  language: string;
  interpretedSignals: InterpretedSignals;
  correctionCandidates: CorrectionCandidate[];
  correctionStatus: "none" | "requires_confirmation";
  correctionReason: string | null;
}

const UNCERTAINTY_PATTERNS: RegExp[] = [
  /\b(maybe|probably|perhaps|possibly|not sure|unsure|uncertain|not certain)\b/i,
  /\b(can'?t|cannot|don'?t|do not) remember\b/i,
  /\b(no idea|don'?t know|do not know|don'?t think|do not think)\b/i,
  /\bi think\b/i,
  /\bi guess\b/i,
  /\b(might|may)\s+(have|'?ve)\b/i,
  /\b(sort|kind)\s+of\b/i,
  /\b(pata nahi|yaad nahi|shayad|lagta hai|ho sakta hai)\b/i,
  /\b(mahiti|mahit|athavt|athavat) nahi\b/i,
  /\bkadachit\b/i,
  /(पता नहीं|याद नहीं|शायद|लगता है|हो सकता है|माहिती नाही|माहित नाही|कदाचित)/u,
];

const PREVIOUS_DAY_PATTERN = /\b(yesterday|last night|last evening)\b/i;

const CURRENT_DAY_PATTERN =
  /\b(today|this morning|tonight|just now|right now|earlier today|a few minutes ago)\b/i;

const AMBIGUOUS_HINDI_DAY = /\bkal\b|(कल)/iu;

const CURRENT_DAY_TRANSLITERATED = /\b(aaj|abhi|ata)\b/i;
const CURRENT_DAY_DEVANAGARI = /(आज|अभी|आत्ता)/u;

const ADHERENCE_CUE =
  /\b(medicine|medication|meds?|pills?|tablets?|dose|doses|prescription|took|taken|take|taking|swallow(ed)?|dawa|davai|dawai|goli|golya|liya|khaya|khalli|ghetla|ghetli|ghyayla)\b|(दवा|गोली|औषध|घेतले|घेतली|खाल्ली|लिया)/iu;

const ROMANIZED_MARKER =
  /\b(pata nahi|yaad nahi|shayad|lagta hai|ho sakta hai|mahiti nahi|mahit nahi|athavt nahi|athavat nahi|kadachit|vatte|watte|aaj|abhi|kal)\b/i;

const ENGLISH_MARKER =
  /\b(i|i'm|my|me|took|taken|take|medicine|medication|pill|tablet|dose|not|no|maybe|think|have|did|do|today|yesterday)\b/i;

const DEVANAGARI = /[\u0900-\u097F]/;
const LATIN = /[a-z]/i;

function hasUncertainty(text: string): boolean {
  return UNCERTAINTY_PATTERNS.some((re) => re.test(text));
}

function isMixedLanguage(raw: string): boolean {
  const hasDevanagari = DEVANAGARI.test(raw);
  const hasLatin = LATIN.test(raw);
  if (hasDevanagari && hasLatin) return true;
  return ROMANIZED_MARKER.test(raw) && ENGLISH_MARKER.test(raw);
}

function temporalScopeOf(raw: string): {
  scope: TemporalScope;
  previousDayReference: boolean;
} {
  const previous = PREVIOUS_DAY_PATTERN.test(raw);
  const current =
    CURRENT_DAY_PATTERN.test(raw) ||
    CURRENT_DAY_TRANSLITERATED.test(raw) ||
    CURRENT_DAY_DEVANAGARI.test(raw);
  const ambiguousKal = AMBIGUOUS_HINDI_DAY.test(raw);

  if (previous && current) return { scope: "unclear", previousDayReference: true };
  if (previous) return { scope: "previous_day", previousDayReference: true };
  if (current) return { scope: "current", previousDayReference: ambiguousKal };
  if (ambiguousKal) return { scope: "unclear", previousDayReference: true };
  return { scope: "current", previousDayReference: false };
}

export function interpretTranscript(input: {
  rawTranscript: string;
  normalizedTranscript: string;
  language: string;
}): TranscriptInterpretation {
  const raw = input.rawTranscript;
  const normalized = input.normalizedTranscript;
  const combined = `${raw}\n${normalized}`;
  const extracted = extractSignals(normalized);
  const uncertainty = hasUncertainty(combined);
  const mixedLanguage = isMixedLanguage(raw);
  const { scope, previousDayReference } = temporalScopeOf(combined);
  const adherenceCue = ADHERENCE_CUE.test(combined);

  const candidates: CorrectionCandidate[] = [];

  if (uncertainty && adherenceCue) {
    candidates.push({
      kind: "uncertainty",
      proposedValue: "adherence:unknown",
      reason:
        "The speaker is not certain whether the medicine was taken. Do not record taken or not taken.",
      requiresConfirmation: true,
    });
  }

  if (previousDayReference && adherenceCue) {
    candidates.push({
      kind: "temporal_scope",
      proposedValue: "clarify_temporal_scope",
      reason:
        scope === "unclear"
          ? "\"Kal\" can mean yesterday or tomorrow. Confirm which day this refers to."
          : "The statement refers to a previous day. Confirm the current dose instead of marking today.",
      requiresConfirmation: true,
    });
  }

  if (mixedLanguage && uncertainty && adherenceCue) {
    candidates.push({
      kind: "mixed_language",
      proposedValue: "language:clarify_original",
      reason:
        "The utterance mixes languages and contains uncertainty. Confirm the original wording before recording adherence.",
      requiresConfirmation: true,
    });
  }

  if (/\b(took|take|taken)\s+(my|the|a)\s+meditation\b/i.test(combined)) {
    candidates.push({
      kind: "stt_confusion",
      proposedValue: "text:medication",
      reason:
        "The transcript says \"meditation\", which may be a speech-recognition error for \"medication\". It is not changed automatically.",
      requiresConfirmation: true,
    });
  }

  const adherenceLocked =
    adherenceCue && (uncertainty || previousDayReference || scope === "unclear" || candidates.length > 0);

  const interpretedSignals: InterpretedSignals = {
    ...extracted,
    adherenceStatus: adherenceLocked ? "unknown" : extracted.adherenceStatus,
    needsClarification: adherenceLocked ? true : extracted.needsClarification,
    adherenceLocked,
    uncertainty,
    previousDayReference,
    mixedLanguage,
    temporalScope: scope,
  };

  return {
    rawTranscript: raw,
    normalizedTranscript: normalized,
    correctedTranscript: normalized,
    language: normalizeLanguage(input.language),
    interpretedSignals,
    correctionCandidates: candidates,
    correctionStatus: candidates.length > 0 ? "requires_confirmation" : "none",
    correctionReason:
      candidates.length > 0
        ? candidates.map((item) => item.reason).join(" ")
        : null,
  };
}
