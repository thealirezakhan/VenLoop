import { describe, expect, it } from "vitest";
import { llmConfigured } from "@/lib/server/llm";
import { analyzeTurn } from "@/lib/server/conversation-reply";
import { extractSignals } from "@/modules/rules-engine/extract";
import { advanceConversation, emptyConversationState } from "@/modules/conversation/state";

/**
 * Text-only live check. Opt in with RUN_LIVE_LLM=1 so normal test runs and CI
 * never spend provider tokens.
 */
describe.skipIf(!process.env.RUN_LIVE_LLM || !llmConfigured())(
  "live LLM text analysis",
  () => {
    it("extracts several facts from one sentence and keeps the reply advice-free", async () => {
      const utterance =
        "I took the pills but I feel like having a fever. Should I take another pill?";

      const state = emptyConversationState();
      const signals = extractSignals(utterance);
      const result = await analyzeTurn({
        firstName: "Eleanor",
        transcript: utterance,
        normalizedEnglish: utterance,
        language: "en",
        history: [],
        previousState: state,
        signals,
        inputSource: "typed",
        simulatedNotificationSent: false,
      });

      const { analysis } = result;
      expect(result.source).toBe("llm");
      expect(analysis.adherenceStatus).toBe("reported_taken");
      expect(analysis.symptoms.map((symptom) => symptom.code)).toContain("possible_fever");
      expect(analysis.dosageQuestion).toBe(true);
      expect(analysis.replyText).not.toMatch(
        /should|pharmacist|doctor|take another|double|increase|decrease|stop taking/i,
      );

      const next = advanceConversation(state, {
        transcript: utterance,
        signals,
        decision: "dosage_safety_response",
        escalated: false,
        analysis,
        analysisSource: result.source,
        language: "en",
      });

      expect(next.closing).toBe(false);
      expect(next.followUpQuestion).toMatch(/fever/i);
    });
  },
);
