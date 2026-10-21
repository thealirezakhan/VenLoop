# Safety Policy (summary of PRD 9)

Versioned in the rules engine (`rule_set_version`). Pure function, no I/O.

1. **Adherence**: only explicit statements map to `reported_taken` / `reported_not_taken`. Ambiguity → clarification, then `unresolved`. Never guess.
2. **No answer**: unreachable only after configured attempts (default 2). Never implies missed medication.
3. **Symptoms**: extract and escalate per policy; respond with general guidance to contact a professional; no diagnosis, no medication changes.
4. **Dosage questions**: always blocked. Response: VenLoop cannot advise on dose changes; contact doctor or pharmacist. Independent of language/wording.
5. **Consent**: required before any real external contact. Revoked/expired consent stops the action and is recorded.
6. **Approvals**: per action type policy; rejection is a first-class recorded outcome; stale approvals cannot execute.
7. **Verification**: independent DB read-back; failures stay visible; timeout → `unknown`, not success.
