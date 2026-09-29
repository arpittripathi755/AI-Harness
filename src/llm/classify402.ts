/**
 * classify402 — Classify an OpenRouter 402 Payment Required response into
 * one of three distinct categories so the caller can handle each correctly.
 *
 * Classes:
 *   max_tokens_unaffordable  — "can only afford N tokens"; retry with lower max_tokens
 *   in_flight_budget         — "in-flight budget exhausted"; wait Retry-After, then retry
 *   insufficient_credits     — anything else; no retry, direct the user to add credits
 */

export type Error402Class =
  | "max_tokens_unaffordable"
  | "in_flight_budget"
  | "insufficient_credits";

export interface Classified402 {
  /** Which bucket this 402 falls into. */
  kind: Error402Class;
  /**
   * Parsed affordable token count for `max_tokens_unaffordable` class.
   * Undefined for other classes.
   */
  affordableTokens?: number;
  /**
   * Retry-After seconds parsed from the response headers for `in_flight_budget` class.
   * Defaults to 20 if header absent.
   */
  retryAfterSeconds?: number;
  /** Human-readable error message (with API key redacted). */
  message: string;
}

const MAX_IN_FLIGHT_WAIT_S = 130;
const DEFAULT_IN_FLIGHT_WAIT_S = 20;

/**
 * Classify a 402 response body + headers.
 *
 * @param rawBody   Response body text (may be partial / truncated; up to 500 chars is enough).
 * @param headers   The response headers map (case-insensitive via .get()).
 * @param apiKey    Caller's API key used ONLY for redaction — never logged.
 */
export function classify402(
  rawBody: string,
  headers: { get(name: string): string | null },
  apiKey: string,
): Classified402 {
  // Redact the API key from everything we expose
  const safeBody = rawBody.replace(apiKey, "[REDACTED]");

  // Try to parse error message from JSON body
  let errMsg = "";
  let metadata: any = null;
  try {
    const parsed = JSON.parse(rawBody);
    errMsg = parsed?.error?.message ?? "";
    metadata = parsed?.error?.metadata ?? null;
  } catch {
    errMsg = safeBody;
  }
  const safeErrMsg = errMsg.replace(apiKey, "[REDACTED]");

  // ── Class 1: max_tokens_unaffordable ──────────────────────────────────────
  // OpenRouter sends: "can only afford N tokens"
  const affordMatch = errMsg.match(/can only afford (\d+)/i);
  if (affordMatch) {
    return {
      kind: "max_tokens_unaffordable",
      affordableTokens: parseInt(affordMatch[1], 10),
      message: safeErrMsg,
    };
  }

  // ── Class 2: in_flight_budget ─────────────────────────────────────────────
  // metadata.reason === "in_flight_budget_exhausted"  OR  message contains "in-flight"
  const isInFlight =
    metadata?.reason === "in_flight_budget_exhausted" ||
    metadata?.limit_source === "openrouter_in_flight_budget" ||
    errMsg.toLowerCase().includes("in-flight") ||
    errMsg.toLowerCase().includes("in_flight") ||
    safeBody.includes("in_flight_budget_exhausted");

  if (isInFlight) {
    const retryAfterHeader = headers.get("retry-after") ?? headers.get("Retry-After");
    let retryAfterSeconds = DEFAULT_IN_FLIGHT_WAIT_S;
    if (retryAfterHeader) {
      const secs = Number(retryAfterHeader);
      if (Number.isFinite(secs) && secs >= 0) {
        retryAfterSeconds = Math.min(MAX_IN_FLIGHT_WAIT_S, Math.max(1, secs));
      }
    }
    return {
      kind: "in_flight_budget",
      retryAfterSeconds,
      message: safeErrMsg || "OpenRouter in-flight budget exhausted",
    };
  }

  // ── Class 3: insufficient_credits ────────────────────────────────────────
  return {
    kind: "insufficient_credits",
    message: safeErrMsg || safeBody || "Payment Required",
  };
}
