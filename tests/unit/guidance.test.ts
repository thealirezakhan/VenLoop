import { describe, expect, it } from "vitest";
import { rankGuidance, type GuidanceSnippet } from "@/modules/conversation/guidance";

const rows: GuidanceSnippet[] = [
  {
    medicationName: "Lisinopril",
    title: "Lightheadedness and missed doses",
    guidance: "Stand up slowly if you feel lightheaded. Ask your pharmacist about a missed dose.",
    sourceLabel: "Approved synthetic demo guidance",
  },
  {
    medicationName: "General",
    title: "Nausea or feeling unwell during a check-in",
    guidance: "Nausea can have many causes. Sit somewhere safe and tell your caregiver.",
    sourceLabel: "Approved synthetic demo guidance",
  },
  {
    medicationName: "Furosemide",
    title: "Urination and dizziness",
    guidance: "Tell your caregiver if you feel dizzy or very thirsty.",
    sourceLabel: "Approved synthetic demo guidance",
  },
];

describe("approved guidance retrieval", () => {
  it("ranks the nausea guidance first for a nausea utterance", () => {
    const result = rankGuidance(rows, "I feel a bit nauseous today", ["Furosemide"]);
    expect(result[0]?.title).toMatch(/nausea/i);
  });

  it("prefers guidance for the patient's own medication on generic queries", () => {
    const result = rankGuidance(rows, "I have a question about my medicine", ["Lisinopril"]);
    expect(result[0]?.medicationName).toBe("Lisinopril");
  });

  it("returns nothing when there is no match", () => {
    expect(rankGuidance(rows, "hello", [])).toEqual([]);
  });
});
