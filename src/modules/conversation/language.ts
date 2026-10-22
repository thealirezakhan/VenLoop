import type { DecisionType } from "@/modules/rules-engine/types";

export const SUPPORTED_LANGUAGES = ["en", "hi", "mr"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function normalizeLanguage(value: string | null | undefined): SupportedLanguage {
  const base = (value ?? "en").trim().toLowerCase().split(/[-_]/)[0];
  return base === "hi" || base === "mr" ? base : "en";
}

export function languageName(language: SupportedLanguage): string {
  if (language === "hi") return "Hindi";
  if (language === "mr") return "Marathi";
  return "English";
}

export function usesDevanagari(language: SupportedLanguage): boolean {
  return language !== "en";
}

type Copy = {
  greeting: string;
  ackTaken: string;
  ackNotTaken: string;
  clarify: string;
  clarifyQuestion: string;
  dosage: string;
  symptom: string;
  severeSymptom: string;
  emergency: string;
  unreachable: string;
  unresolved: string;
  followUpSymptom: (name: string) => string;
  followUpGeneric: string;
  followUpDosage: string;
  dosageSafetyCheck: string;
  alreadyEnded: string;
  closingNoAction: (name: string) => string;
  closingWithAction: (name: string) => string;
  closingUnanswered: (name: string) => string;
  incomplete: string;
};

const SYMPTOM_NAMES: Record<SupportedLanguage, Record<string, string>> = {
  en: {
    nausea_or_vomiting: "nausea",
    possible_fever: "fever",
    dizziness: "dizziness",
    headache: "headache",
    chest_pain: "chest pain",
    shortness_of_breath: "shortness of breath",
    unsteadiness: "unsteadiness",
    fainting: "fainting",
    blurred_vision: "blurred vision",
  },
  hi: {
    nausea_or_vomiting: "मतली",
    possible_fever: "बुखार",
    dizziness: "चक्कर",
    headache: "सिरदर्द",
    chest_pain: "सीने में दर्द",
    shortness_of_breath: "सांस लेने में तकलीफ",
    unsteadiness: "असंतुलन",
    fainting: "बेहोशी",
    blurred_vision: "धुंधला दिखना",
  },
  mr: {
    nausea_or_vomiting: "मळमळ",
    possible_fever: "ताप",
    dizziness: "चक्कर",
    headache: "डोकेदुखी",
    chest_pain: "छातीत दुखणे",
    shortness_of_breath: "श्वास घेण्यास त्रास",
    unsteadiness: "असंतुलन",
    fainting: "बेशुद्धी",
    blurred_vision: "अस्पष्ट दिसणे",
  },
};

export function symptomName(symptom: string, language: SupportedLanguage): string {
  return SYMPTOM_NAMES[language][symptom] ?? symptom.replaceAll("_", " ");
}

const COPY: Record<SupportedLanguage, Copy> = {
  en: {
    greeting:
      "Good morning. This is VenLoop. It is time for your medication check-in. Have you taken your medicine yet?",
    ackTaken: "Thank you. I have recorded that you took your medicine.",
    ackNotTaken:
      "Thank you for telling me. I have recorded that you have not taken it yet, and I will let your caregiver know.",
    clarify: "I am sorry, I did not catch that.",
    clarifyQuestion: "Could you tell me again whether you have taken your medicine yet?",
    dosage:
      "I am not able to advise on changing your dose. I have noted your question and I will let your caregiver know.",
    symptom:
      "I am sorry you are not feeling well. I have noted that, and I will let your caregiver know.",
    severeSymptom:
      "Thank you for telling me. I have noted how you are feeling, and I am letting your caregiver know now.",
    emergency:
      "This may be an emergency. Please call your local emergency services now, or ask someone nearby for help. I am alerting your caregiver.",
    unreachable: "I am sorry we could not reach you. I will try once more.",
    unresolved: "We could not confirm your medicine today. I will let your caregiver know.",
    followUpSymptom: (name) => `When did the ${name} start, and is it mild or severe?`,
    followUpGeneric: "When did that start, and is it mild or severe?",
    followUpDosage: "Is there anything else you would like me to pass on to your caregiver?",
    dosageSafetyCheck:
      "Before we finish, are you having any symptoms right now, such as dizziness, nausea, or trouble breathing?",
    alreadyEnded: "This simulated call has already ended. Thank you.",
    closingNoAction: (name) =>
      `Thank you for talking with me, ${name}. Your check-in is recorded. Take care. Goodbye.`,
    closingWithAction: (name) =>
      `Thank you for talking with me, ${name}. We have recorded your concerns and passed them to your caregiver. Take care. Goodbye.`,
    closingUnanswered: (name) =>
      `Thank you for talking with me, ${name}. We have recorded the concerns you shared, and your caregiver will follow up. Take care. Goodbye.`,
    incomplete: "Thank you. I have noted that for your caregiver.",
  },
  hi: {
    greeting: "सुप्रभात। यह VenLoop है। आपकी दवा की जाँच का समय है। क्या आपने अपनी दवा ली है?",
    ackTaken: "धन्यवाद। मैंने दर्ज कर लिया है कि आपने अपनी दवा ली है।",
    ackNotTaken:
      "बताने के लिए धन्यवाद। मैंने दर्ज कर लिया है कि आपने अभी दवा नहीं ली है, और मैं आपके देखभालकर्ता को बता दूँगा।",
    clarify: "क्षमा करें, मैं समझ नहीं पाया।",
    clarifyQuestion: "क्या आप फिर से बता सकते हैं कि आपने अपनी दवा ली है या नहीं?",
    dosage:
      "मैं दवा की खुराक बदलने की सलाह नहीं दे सकता। मैंने आपका सवाल दर्ज कर लिया है और आपके देखभालकर्ता को बता दूँगा।",
    symptom:
      "मुझे खेद है कि आप अस्वस्थ महसूस कर रहे हैं। मैंने यह दर्ज कर लिया है और आपके देखभालकर्ता को बता दूँगा।",
    severeSymptom:
      "बताने के लिए धन्यवाद। मैंने दर्ज कर लिया है कि आप कैसा महसूस कर रहे हैं, और मैं अभी आपके देखभालकर्ता को बता रहा हूँ।",
    emergency:
      "यह आपातकाल हो सकता है। कृपया अभी अपनी स्थानीय आपातकालीन सेवा को कॉल करें, या पास किसी से मदद माँगें। मैं आपके देखभालकर्ता को सूचित कर रहा हूँ।",
    unreachable: "क्षमा करें, हम आपसे संपर्क नहीं कर सके। मैं एक बार और प्रयास करूँगा।",
    unresolved: "हम आज आपकी दवा की पुष्टि नहीं कर सके। मैं आपके देखभालकर्ता को बता दूँगा।",
    followUpSymptom: (name) => `${name} कब शुरू हुआ, और यह हल्का है या गंभीर?`,
    followUpGeneric: "यह कब शुरू हुआ, और यह हल्का है या गंभीर?",
    followUpDosage: "क्या कुछ और है जो आप अपने देखभालकर्ता तक पहुँचाना चाहेंगे?",
    dosageSafetyCheck:
      "समाप्त करने से पहले, क्या आपको अभी कोई लक्षण है, जैसे चक्कर, मतली, या सांस लेने में तकलीफ?",
    alreadyEnded: "यह सिम्युलेटेड कॉल पहले ही समाप्त हो चुकी है। धन्यवाद।",
    closingNoAction: (name) =>
      `मेरे साथ बात करने के लिए धन्यवाद, ${name}। आपकी जाँच दर्ज हो गई है। अपना ख्याल रखें। नमस्ते।`,
    closingWithAction: (name) =>
      `मेरे साथ बात करने के लिए धन्यवाद, ${name}। हमने आपकी चिंताएँ दर्ज कर ली हैं और आपके देखभालकर्ता तक पहुँचा दी हैं। अपना ख्याल रखें। नमस्ते।`,
    closingUnanswered: (name) =>
      `मेरे साथ बात करने के लिए धन्यवाद, ${name}। हमने आपकी बताई चिंताएँ दर्ज कर ली हैं, और आपका देखभालकर्ता आगे संपर्क करेगा। अपना ख्याल रखें। नमस्ते।`,
    incomplete: "धन्यवाद। मैंने यह आपके देखभालकर्ता के लिए दर्ज कर लिया है।",
  },
  mr: {
    greeting: "सुप्रभात. हे VenLoop आहे. तुमच्या औषधाच्या तपासणीची वेळ झाली आहे. तुम्ही तुमचे औषध घेतले आहे का?",
    ackTaken: "धन्यवाद. तुम्ही तुमचे औषध घेतले हे मी नोंदवले आहे.",
    ackNotTaken:
      "सांगितल्याबद्दल धन्यवाद. तुम्ही अजून औषध घेतले नाही हे मी नोंदवले आहे, आणि मी तुमच्या काळजीवाहकाला सांगेन.",
    clarify: "क्षमस्व, मला समजले नाही.",
    clarifyQuestion: "तुम्ही तुमचे औषध घेतले आहे की नाही, ते पुन्हा सांगू शकता का?",
    dosage:
      "मी औषधाची मात्रा बदलण्याचा सल्ला देऊ शकत नाही. मी तुमचा प्रश्न नोंदवला आहे आणि तुमच्या काळजीवाहकाला सांगेन.",
    symptom:
      "तुम्हाला बरे वाटत नसल्याबद्दल मला वाईट वाटते. मी हे नोंदवले आहे आणि तुमच्या काळजीवाहकाला सांगेन.",
    severeSymptom:
      "सांगितल्याबद्दल धन्यवाद. तुम्हाला कसे वाटत आहे ते मी नोंदवले आहे, आणि मी आत्ता तुमच्या काळजीवाहकाला सांगत आहे.",
    emergency:
      "ही आपत्कालीन परिस्थिती असू शकते. कृपया आत्ताच तुमच्या स्थानिक आपत्कालीन सेवेला कॉल करा, किंवा जवळच्या कोणाकडून मदत मागा. मी तुमच्या काळजीवाहकाला सूचित करत आहे.",
    unreachable: "क्षमस्व, आम्ही तुमच्याशी संपर्क साधू शकलो नाही. मी आणखी एकदा प्रयत्न करेन.",
    unresolved: "आम्ही आज तुमच्या औषधाची पुष्टी करू शकलो नाही. मी तुमच्या काळजीवाहकाला सांगेन.",
    followUpSymptom: (name) => `${name} कधी सुरू झाला, आणि तो सौम्य आहे की गंभीर?`,
    followUpGeneric: "हे कधी सुरू झाले, आणि ते सौम्य आहे की गंभीर?",
    followUpDosage: "तुमच्या काळजीवाहकाला सांगण्यासारखे अजून काही आहे का?",
    dosageSafetyCheck:
      "संपवण्यापूर्वी, तुम्हाला आत्ता काही लक्षणे आहेत का, जसे चक्कर, मळमळ, किंवा श्वास घेण्यास त्रास?",
    alreadyEnded: "हा सिम्युलेटेड कॉल आधीच संपला आहे. धन्यवाद.",
    closingNoAction: (name) =>
      `माझ्याशी बोलल्याबद्दल धन्यवाद, ${name}. तुमची तपासणी नोंदवली आहे. काळजी घ्या. नमस्कार.`,
    closingWithAction: (name) =>
      `माझ्याशी बोलल्याबद्दल धन्यवाद, ${name}. आम्ही तुमच्या चिंता नोंदवल्या आहेत आणि तुमच्या काळजीवाहकापर्यंत पोहोचवल्या आहेत. काळजी घ्या. नमस्कार.`,
    closingUnanswered: (name) =>
      `माझ्याशी बोलल्याबद्दल धन्यवाद, ${name}. तुम्ही सांगितलेल्या चिंता आम्ही नोंदवल्या आहेत, आणि तुमचे काळजीवाहक पुढे संपर्क साधतील. काळजी घ्या. नमस्कार.`,
    incomplete: "धन्यवाद. मी हे तुमच्या काळजीवाहकासाठी नोंदवले आहे.",
  },
};

export function greeting(language: SupportedLanguage): string {
  return COPY[language].greeting;
}

export function decisionCopy(
  decisionType: DecisionType,
  language: SupportedLanguage,
  options: { severe?: boolean; followUp?: boolean; firstName?: string } = {},
): string {
  const copy = COPY[language];
  if (options.followUp) {
    if (decisionType === "emergency_guidance") return copy.emergency;
    if (decisionType === "symptom_escalation") {
      return options.severe ? copy.severeSymptom : copy.incomplete;
    }
    return copy.incomplete;
  }
  switch (decisionType) {
    case "log_adherence":
      return copy.ackTaken;
    case "clarification_required":
      return copy.clarify;
    case "dosage_safety_response":
      return copy.dosage;
    case "symptom_escalation":
      return options.severe ? copy.severeSymptom : copy.symptom;
    case "emergency_guidance":
      return copy.emergency;
    case "unreachable_escalation":
      return copy.unreachable;
    case "unresolved":
      return copy.unresolved;
    default:
      return copy.incomplete;
  }
}

export function clarificationQuestion(language: SupportedLanguage): string {
  return COPY[language].clarifyQuestion;
}

export function symptomFollowUp(symptom: string | null, language: SupportedLanguage): string {
  const copy = COPY[language];
  return symptom ? copy.followUpSymptom(symptomName(symptom, language)) : copy.followUpGeneric;
}

export function genericFollowUp(language: SupportedLanguage): string {
  return COPY[language].followUpGeneric;
}

export function dosageSafetyCheck(language: SupportedLanguage): string {
  return COPY[language].dosageSafetyCheck;
}

export function alreadyEnded(language: SupportedLanguage): string {
  return COPY[language].alreadyEnded;
}

export function closingCopy(
  language: SupportedLanguage,
  options: { firstName: string; actionTaken: boolean; unanswered: boolean; emergency: boolean },
): string {
  const copy = COPY[language];
  if (options.emergency) return copy.emergency;
  if (options.unanswered) return copy.closingUnanswered(options.firstName);
  return options.actionTaken
    ? copy.closingWithAction(options.firstName)
    : copy.closingNoAction(options.firstName);
}

export function notTakenCopy(language: SupportedLanguage): string {
  return COPY[language].ackNotTaken;
}
