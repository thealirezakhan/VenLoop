/**
 * Safety guard for LLM-authored text. The model may only phrase an
 * acknowledgement; every decision, question, and escalation stays
 * deterministic. Unsafe text is discarded and the scripted reply is used.
 */

const DOSE_INSTRUCTION =
  /\b(you (should|can|may|need to)|i (would|will|recommend))\b[^.!?]{0,40}\b(increase|decrease|reduce|lower|raise|double|halve|skip|stop|change|adjust)\b[^.!?]{0,30}\b(dose|dosage|medication|medicine|pill|tablet)\b/i;
const EXTRA_DOSE =
  /\b(take|use)\s+(an?\s+)?(extra|another|second|double|two|three|one more)\b|\b(double|halve)\s+(up\s+)?(your\s+)?(dose|dosage|pill|tablet)\b/i;
const STOP_MEDICATION =
  /\b(stop|skip|change|increase|decrease|reduce|double|halve)\b[^.!?]{0,20}\b(taking|take|using|use)\b/i;
const DOSE_NUMBER = /\b\d+(\.\d+)?\s*(mg|mcg|ml|milligrams?|micrograms?)\b/i;
const DIAGNOSIS =
  /\byou (have|may have|might have|probably have|could have|are having|are suffering)\b|\b(might|may|could) be (a |an )?(side effect|reaction|infection|allergy|condition)\b/i;
const EMERGENCY_REFERENCE = /\b(911|emergency services|call an ambulance)\b/i;
const CONTACT_CLAIM =
  /\b(caregiver|family|doctor|contact)\b[^.!?]{0,30}\b(alerted|notified|contacted|reached)\b/i;
const LOCALIZED_DOSE_INSTRUCTION =
  /(खुराक|मात्रा|औषध|दवा)[^.!?]{0,30}(बदल|कम|ज्यादा|दोगुनी|बंद|छोड़|घट|वाढव|बदलाव)/;
const LOCALIZED_CONTACT_CLAIM =
  /(देखभालकर्ता|काळजीवाहक|परिवार|डॉक्टर|संपर्क)[^.!?]{0,30}(सूचित|संपर्क|सतर्क|माहित)/;
const LOCALIZED_DIAGNOSIS = /(आपको|तुम्हाला)[^.!?]{0,20}(बीमारी|रोग|संक्रमण|एलर्जी)[^.!?]{0,10}(है|आहे)/;
const LOCALIZED_EMERGENCY = /(आपातकालीन सेवा|आपत्कालीन सेवा|एम्बुलेंस|रुग्णवाहिका)/;

export interface GuardInput {
  text: string;
  decisionType: string;
  /** True when this decision actually executed a simulated notification. */
  actionTaken: boolean;
  /** Follow-up questions are allowed to contain one question mark. */
  allowQuestion?: boolean;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function checkAgentText(input: GuardInput): GuardResult {
  const text = input.text.trim();
  if (text.length < 10) return { ok: false, reason: "too_short" };
  if (text.length > 420) return { ok: false, reason: "too_long" };
  if (!input.allowQuestion && text.includes("?")) {
    return { ok: false, reason: "model_asked_question" };
  }
  if (DOSE_INSTRUCTION.test(text) || LOCALIZED_DOSE_INSTRUCTION.test(text)) {
    return { ok: false, reason: "dosage_instruction" };
  }
  if (EXTRA_DOSE.test(text)) return { ok: false, reason: "extra_dose" };
  if (STOP_MEDICATION.test(text)) return { ok: false, reason: "medication_instruction" };
  if (DOSE_NUMBER.test(text)) return { ok: false, reason: "dosage_number" };
  if (DIAGNOSIS.test(text) || LOCALIZED_DIAGNOSIS.test(text)) {
    return { ok: false, reason: "diagnosis" };
  }
  if (
    (EMERGENCY_REFERENCE.test(text) || LOCALIZED_EMERGENCY.test(text)) &&
    input.decisionType !== "emergency_guidance"
  ) {
    return { ok: false, reason: "emergency_reference" };
  }
  if ((CONTACT_CLAIM.test(text) || LOCALIZED_CONTACT_CLAIM.test(text)) && !input.actionTaken) {
    return { ok: false, reason: "unbacked_contact_claim" };
  }
  return { ok: true };
}
