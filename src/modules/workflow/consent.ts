export type ConsentStatus = "granted" | "denied" | "revoked" | "expired";

export interface ConsentSnapshot {
  status: ConsentStatus;
  /** ISO timestamp or null for no expiry. */
  expiresAt: string | null;
}

/**
 * Consent must be granted and unexpired before any real external contact
 * (PRD 9.5). Synthetic demo consent never authorizes real calls — that is a
 * scope check at the integration layer, not here.
 */
export function isConsentValid(consent: ConsentSnapshot | null, now: Date): boolean {
  if (!consent) return false;
  if (consent.status !== "granted") return false;
  if (consent.expiresAt === null) return true;
  const expiry = Date.parse(consent.expiresAt);
  if (Number.isNaN(expiry)) return false;
  return expiry > now.getTime();
}
