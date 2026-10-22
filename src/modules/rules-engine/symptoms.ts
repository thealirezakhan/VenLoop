export interface SymptomDefinition {
  code: string;
  detection: RegExp;
  primary: RegExp;
}

export const SYMPTOM_DEFINITIONS: readonly SymptomDefinition[] = [
  {
    code: "dizziness",
    detection: /\b(dizz(y|iness)|light-?headed|woozy)\b/i,
    primary: /\b(dizz(y|iness)|light-?headed|woozy)\b/i,
  },
  {
    code: "nausea_or_vomiting",
    detection:
      /\b(nausea|nauseous|nauseated|queasy|vomm?it(?:t?ing|ted|s)?|throw(?:ing)? up|puk(?:e|ing)|sick to my stomach|upset stomach|stomach (?:is )?upset)\b/i,
    primary: /\b(nausea|nauseous|nauseated|queasy|sick to my stomach|upset stomach|stomach (?:is )?upset)\b/i,
  },
  {
    code: "possible_fever",
    detection: /\b(fever|feverish|high temperature|temperature|chills)\b/i,
    primary: /\b(fever|feverish|high temperature|temperature|chills)\b/i,
  },
  {
    code: "chest_pain",
    detection: /\bchest (pain|pressure|tightness)\b/i,
    primary: /\bchest (pain|pressure|tightness)\b/i,
  },
  {
    code: "shortness_of_breath",
    detection: /\b(short(ness)? of breath|can'?t breathe|breathless)\b/i,
    primary: /\b(short(ness)? of breath|can'?t breathe|breathless)\b/i,
  },
  {
    code: "blurred_vision",
    detection: /\b(blurred vision|blurry vision|blurry)\b/i,
    primary: /\b(blurred vision|blurry vision|blurry)\b/i,
  },
  {
    code: "fainting",
    detection: /\b(fainted|fainting|passed out|black(ed)? out)\b/i,
    primary: /\b(fainted|fainting|passed out|black(ed)? out)\b/i,
  },
  {
    code: "headache",
    detection: /\b(headache|head hurts)\b/i,
    primary: /\b(headache|head hurts)\b/i,
  },
  {
    code: "unsteadiness",
    detection: /\b(fell|falling|unsteady|unsteadiness)\b/i,
    primary: /\b(fell|falling|unsteady|unsteadiness)\b/i,
  },
];

const VOMITING_PATTERN = /\b(vomm?it(?:t?ing|ted)|throw(?:ing)? up|puk(?:e|ing))\b/i;
const SEVERE_PATTERN = /\b(severe|unbearable|intense|much worse|worsening|can'?t stand|cannot stand)\b/i;
const NEGATED_SEVERE_PATTERN =
  /\b(no|not|none|never|without|feel like|feels like)\b[^.!?]{0,30}\b(severe|worse|vomm?it(?:t?ing|ted)|throwing up|chest pain|trouble breathing)\b/i;
const RETRACTION_CONTEXT =
  /\b(no longer|not anymore|anymore|has passed|have passed|had passed|went away|is gone|are gone|stopped|resolved|cleared up|no more)\b/i;

const SYMPTOM_ALIASES: Record<string, string> = {
  nausea: "nausea_or_vomiting",
  nauseous: "nausea_or_vomiting",
  nauseated: "nausea_or_vomiting",
  queasy: "nausea_or_vomiting",
  vomiting: "nausea_or_vomiting",
  vomitting: "nausea_or_vomiting",
  vomited: "nausea_or_vomiting",
  vomitted: "nausea_or_vomiting",
  nausea_vomiting: "nausea_or_vomiting",
  nausea_and_vomiting: "nausea_or_vomiting",
  fever: "possible_fever",
  feverish: "possible_fever",
  chills: "possible_fever",
  light_headed: "dizziness",
  lightheaded: "dizziness",
  dizzy: "dizziness",
  chest: "chest_pain",
  breath: "shortness_of_breath",
  breathing: "shortness_of_breath",
  breathless: "shortness_of_breath",
  blurry: "blurred_vision",
  faint: "fainting",
  fainted: "fainting",
  passed_out: "fainting",
  head_hurts: "headache",
  unsteady: "unsteadiness",
  fell: "unsteadiness",
};

export function canonicalSymptomCode(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^symptom_details:/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return null;
  if (SYMPTOM_DEFINITIONS.some((definition) => definition.code === normalized)) {
    return normalized;
  }
  return SYMPTOM_ALIASES[normalized] ?? null;
}

export function isKnownSymptom(value: string): boolean {
  return canonicalSymptomCode(value) !== null;
}

export function detectSymptoms(text: string): string[] {
  return SYMPTOM_DEFINITIONS.filter((definition) => definition.detection.test(text)).map(
    (definition) => definition.code,
  );
}

export function symptomMentioned(text: string, symptom: string): boolean {
  const definition = SYMPTOM_DEFINITIONS.find((item) => item.code === symptom);
  return definition ? definition.detection.test(text) : false;
}

export function removeNegatedSymptoms(text: string): string {
  let result = text;
  for (const definition of SYMPTOM_DEFINITIONS) {
    const pattern = new RegExp(
      `\\b(?:no|not|never|without|denies|denied)\\b[^.!?]{0,30}?\\b(?:${definition.detection.source})\\b`,
      "gi",
    );
    result = result.replace(pattern, " ");
  }
  return result;
}

export function symptomRetracted(text: string, symptom: string): boolean {
  const definition = SYMPTOM_DEFINITIONS.find((item) => item.code === symptom);
  if (!definition || !definition.primary.test(text)) return false;

  const clauses = text.split(/[.!?;,]/);
  for (const clause of clauses) {
    if (!definition.primary.test(clause)) continue;
    if (RETRACTION_CONTEXT.test(clause)) return true;
    const before = new RegExp(
      `\\b(?:no|not|never|without|denies|denied)\\b[^.!?]{0,30}?\\b(?:${definition.primary.source})`,
      "i",
    );
    if (before.test(clause)) return true;
  }
  return false;
}

export function isVomitingReport(text: string): boolean {
  return VOMITING_PATTERN.test(text) && !NEGATED_SEVERE_PATTERN.test(text);
}

export function isSevereSymptomReport(text: string): boolean {
  if (NEGATED_SEVERE_PATTERN.test(text)) return false;
  return SEVERE_PATTERN.test(text) || VOMITING_PATTERN.test(text);
}
