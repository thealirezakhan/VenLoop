import { NextResponse } from "next/server";

/**
 * Consistent API error envelope (PRD 12). Never include stack traces or internals.
 */
export function apiError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: { code, message, requestId: crypto.randomUUID() } },
    { status },
  );
}

export function apiData<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}
