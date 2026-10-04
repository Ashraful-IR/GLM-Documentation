import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * Consistent API envelope (§30):
 *   success: { success: true,  data: ... }
 *   failure: { success: false, error: { code, message } }
 */

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ success: true, data }, init);
}

export function fail(code: string, message: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

/** Normalizes any thrown error into the error envelope. Never leaks internals. */
export function handleError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return fail(err.code, err.message, err.status);
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const message = first ? `${first.path.join(".")}: ${first.message}` : "Invalid input";
    // The document payload cap is a size problem, not a validation problem —
    // surface it as 413 so clients can message it distinctly.
    if (err.issues.some((i) => i.message.startsWith("Document is too large"))) {
      return fail("DOCUMENT_TOO_LARGE", message, 413);
    }
    return fail("VALIDATION_ERROR", message, 422);
  }
  if (err instanceof Error) {
    console.error("[api] unhandled error:", err);
    return fail("INTERNAL_ERROR", "Something went wrong", 500);
  }
  return fail("INTERNAL_ERROR", "Something went wrong", 500);
}
