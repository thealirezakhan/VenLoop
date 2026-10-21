/**
 * Provider contracts (PRD 10.1). Mock adapters implement the same shape as
 * future real providers. Nothing here sends real messages.
 */

export interface NotificationInput {
  actionId: string;
  /** Opaque destination reference — resolved by the adapter, never a raw number in domain output. */
  destinationKey: string;
  messageKey: string;
  explanation: string;
  priority: "routine" | "urgent";
}

export interface NotificationResult {
  providerName: string;
  providerMessageId: string;
  status: "simulated" | "accepted" | "failed" | "unknown";
  errorCode?: string;
}

export interface NotificationProvider {
  send(input: NotificationInput): Promise<NotificationResult>;
}

/** Mock sink: records a simulated delivery. Never contacts anyone (PRD 11). */
export const mockNotificationProvider: NotificationProvider = {
  async send(input) {
    return {
      providerName: "mock",
      providerMessageId: `mock_${input.actionId}`,
      status: "simulated",
    };
  },
};
