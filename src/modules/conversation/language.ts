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
      "Good morning! This is your VenLoop medication check-in. Have you taken your medication?",
    ackTaken: "Thank you for confirming. I have recorded that you took your medication.",
    ackNotTaken:
      "Thank you for telling me. I have recorded that you have not taken your medication yet. Please follow your care plan, and contact your doctor or pharmacist if you are unsure what to do.",
    clarify: "Sorry, I did not quite understand.",
    clarifyQuestion: "Could you tell me again whether you have taken your medication or not?",
    dosage:
      "I cannot advise you to change your dose. Please contact your doctor or pharmacist before making any change. We have noted your question for your caregiver.",
    symptom:
      "I am sorry you are feeling unwell. Please sit or lie down somewhere safe. We cannot give medical advice, but we have noted this for your caregiver to follow up.",
    severeSymptom:
      "Thank you for telling me. Please contact your doctor or care team today about these symptoms. We have noted this for your caregiver to follow up.",
    emergency:
      "This may be an emergency. Please contact your local emergency services now, or ask someone nearby to help you. We are alerting your contacts straight away.",
    unreachable: "We could not reach you just now. We will try once more.",
    unresolved: "We were not able to confirm your medication today. Your caregiver will follow up.",
    followUpSymptom: (name) =>
      `When did the ${name} start, and is it mild or severe — for example, are you vomiting, or having chest pain or trouble breathing?`,
    followUpGeneric:
      "When did that start, and is it mild or severe — for example, are you vomiting, or having chest pain or trouble breathing?",
    followUpDosage: "Is there anything else about how you are feeling that your caregiver should know?",
    dosageSafetyCheck:
      "Before we finish, are you having any symptoms right now, such as dizziness, nausea, or trouble breathing?",
    alreadyEnded: "This simulated call has already ended. Thank you.",
    closingNoAction: (name) =>
      `Thank you for speaking with me, ${name}. Your check-in is recorded. Please take care. Goodbye.`,
    closingWithAction: (name) =>
      `Thank you for speaking with me, ${name}. We have recorded your concerns and arranged follow-up for your caregiver. Please take care. Goodbye.`,
    closingUnanswered: (name) =>
      `Thank you for speaking with me, ${name}. We have recorded the concerns you shared, and your caregiver will follow up on the details you did not answer. Please take care. Goodbye.`,
    incomplete: "Thank you. I have noted that for your caregiver.",
  },
  hi: {
    greeting: "सुप्रभात! यह आपकी VenLoop दवा जाँच है। क्या आपने अपनी दवा ली है?",
    ackTaken: "पुष्टि करने के लिए धन्यवाद। मैंने दर्ज कर लिया है कि आपने अपनी दवा ली है।",
    ackNotTaken:
      "बताने के लिए धन्यवाद। मैंने दर्ज कर लिया है कि आपने अभी अपनी दवा नहीं ली है। कृपया अपनी देखभाल योजना का पालन करें, और अगर आपको समझ न आए तो अपने डॉक्टर या फार्मासिस्ट से बात करें।",
    clarify: "क्षमा करें, मैं ठीक से समझ नहीं पाया।",
    clarifyQuestion: "क्या आप फिर से बता सकते हैं कि आपने अपनी दवा ली है या नहीं?",
    dosage:
      "मैं आपको दवा की खुराक बदलने की सलाह नहीं दे सकता। कोई भी बदलाव करने से पहले कृपया अपने डॉक्टर या फार्मासिस्ट से बात करें। हमने आपका सवाल आपके देखभालकर्ता के लिए दर्ज कर लिया है।",
    symptom:
      "मुझे खेद है कि आप अस्वस्थ महसूस कर रहे हैं। कृपया किसी सुरक्षित जगह पर बैठें या लेटें। हम चिकित्सकीय सलाह नहीं दे सकते, लेकिन हमने इसे आपके देखभालकर्ता के फॉलो-अप के लिए दर्ज कर लिया है।",
    severeSymptom:
      "बताने के लिए धन्यवाद। कृपया आज ही इन लक्षणों के बारे में अपने डॉक्टर या देखभाल टीम से संपर्क करें। हमने इसे आपके देखभालकर्ता के फॉलो-अप के लिए दर्ज कर लिया है।",
    emergency:
      "यह आपातकाल हो सकता है। कृपया अभी अपनी स्थानीय आपातकालीन सेवा से संपर्क करें, या पास किसी से मदद मांगें। हम तुरंत आपके संपर्कों को सूचित कर रहे हैं।",
    unreachable: "हम अभी आपसे संपर्क नहीं कर सके। हम एक बार और प्रयास करेंगे।",
    unresolved:
      "हम आज आपकी दवा की पुष्टि नहीं कर सके। आपका देखभालकर्ता आगे संपर्क करेगा।",
    followUpSymptom: (name) =>
      `${name} कब शुरू हुई, और यह हल्की है या गंभीर — जैसे कि आप उल्टी कर रहे हैं, या सीने में दर्द या सांस लेने में तकलीफ है?`,
    followUpGeneric:
      "यह कब शुरू हुआ, और यह हल्का है या गंभीर — जैसे कि आप उल्टी कर रहे हैं, या सीने में दर्द या सांस लेने में तकलीफ है?",
    followUpDosage: "क्या आपकी सेहत के बारे में कुछ और है जो आपके देखभालकर्ता को पता होना चाहिए?",
    dosageSafetyCheck:
      "समाप्त करने से पहले, क्या आपको अभी कोई लक्षण है, जैसे चक्कर, मतली, या सांस लेने में तकलीफ?",
    alreadyEnded: "यह सिम्युलेटेड कॉल पहले ही समाप्त हो चुकी है। धन्यवाद।",
    closingNoAction: (name) =>
      `मेरे साथ बात करने के लिए धन्यवाद, ${name}। आपकी जाँच दर्ज हो गई है। अपना ख्याल रखें। नमस्ते।`,
    closingWithAction: (name) =>
      `मेरे साथ बात करने के लिए धन्यवाद, ${name}। हमने आपकी चिंताएँ दर्ज कर ली हैं और आपके देखभालकर्ता के लिए फॉलो-अप की व्यवस्था की है। अपना ख्याल रखें। नमस्ते।`,
    closingUnanswered: (name) =>
      `मेरे साथ बात करने के लिए धन्यवाद, ${name}। हमने आपकी बताई चिंताएँ दर्ज कर ली हैं, और जिन विवरणों का जवाब नहीं मिला उनके लिए आपका देखभालकर्ता आगे संपर्क करेगा। अपना ख्याल रखें। नमस्ते।`,
    incomplete: "धन्यवाद। मैंने इसे आपके देखभालकर्ता के लिए दर्ज कर लिया है।",
  },
  mr: {
    greeting: "सुप्रभात! ही तुमची VenLoop औषध तपासणी आहे. तुम्ही तुमची औषध घेतली आहे का?",
    ackTaken: "पुष्टी केल्याबद्दल धन्यवाद. तुम्ही तुमची औषध घेतली हे मी नोंदवले आहे.",
    ackNotTaken:
      "सांगितल्याबद्दल धन्यवाद. तुम्ही अजून तुमची औषध घेतली नाही हे मी नोंदवले आहे. कृपया तुमच्या काळजी योजनेचे पालन करा, आणि शंका असल्यास तुमच्या डॉक्टरांशी किंवा फार्मासिस्टशी बोला.",
    clarify: "क्षमस्व, मला नीट समजले नाही.",
    clarifyQuestion: "तुम्ही तुमची औषध घेतली आहे की नाही, ते पुन्हा सांगू शकता का?",
    dosage:
      "मी तुम्हाला औषधाची मात्रा बदलण्याचा सल्ला देऊ शकत नाही. कोणताही बदल करण्यापूर्वी कृपया तुमच्या डॉक्टरांशी किंवा फार्मासिस्टशी बोला. आम्ही तुमचा प्रश्न तुमच्या काळजीवाहकासाठी नोंदवला आहे.",
    symptom:
      "तुम्हाला बरे वाटत नसल्याबद्दल मला वाईट वाटते. कृपया सुरक्षित जागी बसा किंवा झोपा. आम्ही वैद्यकीय सल्ला देऊ शकत नाही, पण तुमच्या काळजीवाहकासाठी हे पाठपुराव्यासाठी नोंदवले आहे.",
    severeSymptom:
      "सांगितल्याबद्दल धन्यवाद. कृपया आजच या लक्षणांबद्दल तुमच्या डॉक्टरांशी किंवा काळजी पथकाशी संपर्क साधा. आम्ही हे तुमच्या काळजीवाहकासाठी पाठपुराव्यासाठी नोंदवले आहे.",
    emergency:
      "ही आपत्कालीन परिस्थिती असू शकते. कृपया आत्ताच तुमच्या स्थानिक आपत्कालीन सेवेशी संपर्क साधा किंवा जवळच्या कोणाकडून मदत मागा. आम्ही तुमच्या संपर्कांना लगेच सूचित करत आहोत.",
    unreachable: "आम्ही आत्ता तुमच्याशी संपर्क साधू शकलो नाही. आम्ही आणखी एकदा प्रयत्न करू.",
    unresolved:
      "आम्ही आज तुमच्या औषधाची पुष्टी करू शकलो नाही. तुमचे काळजीवाहक पुढे संपर्क साधतील.",
    followUpSymptom: (name) =>
      `${name} कधी सुरू झाली, आणि ती सौम्य आहे की गंभीर — उदाहरणार्थ, तुम्ही उलटी करत आहात का, किंवा छातीत दुखत आहे किंवा श्वास घेण्यास त्रास होत आहे का?`,
    followUpGeneric:
      "हे कधी सुरू झाले, आणि ते सौम्य आहे की गंभीर — उदाहरणार्थ, तुम्ही उलटी करत आहात का, किंवा छातीत दुखत आहे किंवा श्वास घेण्यास त्रास होत आहे का?",
    followUpDosage: "तुमच्या प्रकृतीबद्दल अजून काही आहे का जे तुमच्या काळजीवाहकाला माहीत असावे?",
    dosageSafetyCheck:
      "संपवण्यापूर्वी, तुम्हाला आत्ता काही लक्षणे आहेत का, जसे चक्कर, मळमळ, किंवा श्वास घेण्यास त्रास?",
    alreadyEnded: "हा सिम्युलेटेड कॉल आधीच संपला आहे. धन्यवाद.",
    closingNoAction: (name) =>
      `माझ्याशी बोलल्याबद्दल धन्यवाद, ${name}. तुमची तपासणी नोंदवली आहे. काळजी घ्या. नमस्कार.`,
    closingWithAction: (name) =>
      `माझ्याशी बोलल्याबद्दल धन्यवाद, ${name}. आम्ही तुमच्या चिंता नोंदवल्या आहेत आणि तुमच्या काळजीवाहकासाठी पाठपुरावा ठेवला आहे. काळजी घ्या. नमस्कार.`,
    closingUnanswered: (name) =>
      `माझ्याशी बोलल्याबद्दल धन्यवाद, ${name}. तुम्ही सांगितलेल्या चिंता आम्ही नोंदवल्या आहेत, आणि ज्यांची उत्तरे मिळाली नाहीत त्या तपशीलांसाठी तुमचे काळजीवाहक पुढे संपर्क साधतील. काळजी घ्या. नमस्कार.`,
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
