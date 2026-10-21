export type FailureCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "CONSENT_INVALID"
  | "RATE_LIMITED"
  | "INTERNAL";

export class ApiFailure extends Error {
  constructor(
    public readonly code: FailureCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

export function failureBody(failure: ApiFailure, requestId = crypto.randomUUID()) {
  return { error: { code: failure.code, message: failure.message, requestId } };
}

export function toApiFailure(err: unknown): ApiFailure {
  if (err instanceof ApiFailure) return err;
  console.error("unhandled service error", err instanceof Error ? err.message : err);
  return new ApiFailure("INTERNAL", "Unexpected server error.", 500);
}
