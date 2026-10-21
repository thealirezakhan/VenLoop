import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { toApiFailure } from "@/lib/server/failures";

type Handler<T> = () => Promise<T>;

/** Wrap a route handler: convert ApiFailure to the standard error envelope. */
export async function handle<T>(handler: Handler<T>): Promise<NextResponse> {
  try {
    const data = await handler();
    return NextResponse.json({ data });
  } catch (err) {
    const failure = toApiFailure(err);
    return apiError(failure.code, failure.message, failure.status);
  }
}
