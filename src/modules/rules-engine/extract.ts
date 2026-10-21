import type { AdherenceStatus } from "./types";

export interface ExtractedSignals {
  adherenceStatus: AdherenceStatus;
  symptoms: string[];
  dosageQuestion: boolean;
  needsClarification: boolean;
  /** Red-flag phrases that take the emergency pathway (doc: severity combinations). */
  emergency: boolean;
}

const SYMPTOM_PATTERNS: readonly [RegExp, string][] = [
  [/\b(dizz(y|iness)|light-?headed|woozy)\b/i, "dizziness"],
  [
    /\b(nausea|nauseous|queasy|vomit(ing|ed)?|feel like vomiting|throwing up|sick to my stomach|upset stomach|stomach (is )?upset)\b/i,
    "nausea_or_vomiting",
  ],
  [/\b(fever|feverish|high temperature|temperature|chills)\b/i, "possible_fever"],
  [/\bchest (pain|pressure|tightness)\b/i, "chest_pain"],
  [/\b(short(ness)? of breath|can'?t breathe|breathless)\b/i, "shortness_of_breath"],
  [/\bblurred vision\b/i, "blurred_vision"],
  [/\b(fainted|fainting|passed out|black(ed)? out)\b/i, "fainting"],
  [/\b(headache|head hurts)\b/i, "headache"],
  [/\b(fell|falling|unsteady)\b/i, "unsteadiness"],
];

/** Denied symptoms are removed before matching; a denial in one clause must not hide another. */
const NEGATED_SYMPTOM =
  /\b(no|not|never|without|denies|denied)\b[^.!?]{0,30}\b(fever|nausea|nauseous|vomit(ing)?|dizz(y|iness)|headache|chest pain|shortness of breath)\b/gi;

const DOSAGE_PATTERNS: RegExp[] = [
  /\bdouble (the |my )?(dose|doses|tablets?|pills?)\b/i,
  /\b(twice|2x) (the |my )?(dose|doses|tablets?|pills?)\b/i,
  /\b(chang(e|ing)|increas(e|ing)|reduc(e|ing)|skip|stop|double)\b.*\b(dose|doses|dosage)\b/i,
  /\b(dose|dosage)\b.*\b(chang(e|ing)|increas(e|ing)|reduc(e|ing)|skip|stop|double)\b/i,
  /\b(take|taking|should i take)\b.*\b(more|extra|less|fewer)\b.*\b(tablets?|pills?|medicine|medication|dose)\b/i,
  /\bhalf (a |an )?(dose|tablet|pill)\b/i,
  /\b(another|one more|an extra)\s+(dose|doses|tablet|pill)\b/i,
  /\bshould i (take|use|have)\b.*\b(another|extra|more|second|double|skip|stop)\b/i,
  /\bcan i (take|use|have)\b.*\b(another|extra|more|second|double)\b/i,
  /\b(do|did|will) i (need to )?(take|redo|repeat)\b.*\b(another|extra|more|second|again)\b/i,
  /\b(took|take)\s+(two|2|three|3|an extra|another)\b.*\b(tablets?|pills?|dose)?\b/i,
  /\b(stop|continue|change)\b.*\b(taking\s+)?(this|my|the)\s+(medicine|medication|drug|tablet|pill)\b/i,
];

/** Red-flag phrases: emergency pathway wins over routine symptom handling. */
const EMERGENCY_PATTERNS: RegExp[] = [
  /\b(cannot|can'?t|can not|hard(ly)? to|struggl(e|ing) to)\s+breathe\b/i,
  /\b(trouble|difficulty|problem|issues?)\s+(with\s+)?breath(ing)?\b/i,
  /\b(hard|difficult)\s+(to\s+)?breath(e|ing)\b/i,
  /\bbreathing\s+(is|feels)\s+(hard|difficult)\b/i,
  /\bcan'?t (catch my breath|get (my )?breath)\b/i,
  /\bchest (pain|pressure|tightness)\b/i,
  /\b(faint(ed|ing)?|passed out|black(ed)? out|unconscious)\b/i,
  /\bcannot speak|can'?t speak|difficulty (speaking|talking)|slurred speech\b/i,
  /\bsudden (weakness|numbness|drooping)\b/i,
  /\ballergi(c|e|cal)\s*(reaction|swelling)\b/i,
  /\bsuspect(ed|s)? (an? )?overdose|took (too many|an overdose)\b/i,
  /\bhelp me\b/i,
];

/** Explicit denials only: "not sure, but trouble breathing" stays an emergency. */
const NEGATED_EMERGENCY =
  /\b(do not|don'?t|does not|doesn'?t|have no|has no|with no|without|denies|denied)\b[^.!?]{0,40}\b(chest pain|trouble breathing|difficulty breathing|shortness of breath|faint(ed|ing)?|overdose)\b|\bno\s+(chest pain|trouble breathing|difficulty breathing|shortness of breath|fainting?|overdose)\b/gi;

const NOT_TAKEN_PATTERNS: RegExp[] = [
  /\b(didn'?t|did not|haven'?t|have not|never)\b.*\b(take|took|taken|swallow(ed)?)\b/i,
  /\b(forgot|missed|skipped)\b.*\b(my )?(dose|doses|tablets?|pills?|medicine|medication)\b/i,
  /\bno\b.*\b(took|taken)\b/i,
  /\b(not taken|didn't take|did not take)\b/i,
];

const TAKEN_PATTERNS: RegExp[] = [
  /\b(took|taken|swallowed|had)\b.*\b(my )?(morning )?(dose|doses|tablets?|pills?|medicine|medication)\b/i,
  /\byes\b.*\b(took|taken)\b/i,
  /\b(took|taken)\b.*\byes\b/i,
  /\byes,? (i |we )?(took|have)\b/i,
  /\b(took|taken|swallowed)\s+(it|them|mine)\b/i,
];

const AMBIGUOUS_PATTERNS: RegExp[] = [
  /\b(maybe|probably|perhaps|not sure|unsure|can'?t remember|cannot remember|don'?t remember|i think so|sort of|kind of)\b/i,
  /\bsometime earlier\b/i,
  /\bi guess\b/i,
];

/**
 * Deterministic keyword extraction for the demo (English fixtures).
 * No LLM. Anything unclear stays `unknown` + needsClarification (PRD 9.4).
 * Multilingual extraction is out of MVP scope — untranslated input degrades
 * to clarification, never to a guessed adherence conclusion.
 */
export function extractSignals(transcript: string): ExtractedSignals {
  const text = transcript.trim();
  const symptomText = text.replace(NEGATED_SYMPTOM, " ");
  const symptoms = SYMPTOM_PATTERNS.filter(([re]) => re.test(symptomText)).map(([, label]) => label);
  const dosageQuestion = DOSAGE_PATTERNS.some((re) => re.test(text));
  // Remove explicitly denied red-flag phrases, then test whatever remains so
  // "no chest pain, but I can't breathe" still wins.
  const emergencyText = text.replace(NEGATED_EMERGENCY, " ");
  const emergency = EMERGENCY_PATTERNS.some((re) => re.test(emergencyText));

  let adherenceStatus: AdherenceStatus = "unknown";
  let needsClarification = false;

  if (NOT_TAKEN_PATTERNS.some((re) => re.test(text))) {
    adherenceStatus = "reported_not_taken";
  } else if (TAKEN_PATTERNS.some((re) => re.test(text))) {
    adherenceStatus = "reported_taken";
  } else if (AMBIGUOUS_PATTERNS.some((re) => re.test(text)) || text.length === 0) {
    needsClarification = true;
  } else {
    needsClarification = true;
  }

  return { adherenceStatus, symptoms, dosageQuestion, needsClarification, emergency };
}
