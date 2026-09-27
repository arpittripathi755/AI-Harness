/**
 * A `fetch` wrapper that transparently retries transient failures — most
 * importantly HTTP 429 (rate limit) — with exponential backoff that honors the
 * server's `Retry-After` header. This lets the agent's many small requests ride
 * out short-lived rate limits instead of failing the whole turn.
 */

export interface RetryOptions {
  retries?: number;
  signal?: AbortSignal;
  /** Called before each backoff wait so the UI can show a "retrying" status. */
  onRetry?: (waitMs: number, attempt: number) => void;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_BACKOFF_MS = 30_000;

let globalRequestCount = 0;

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  { retries = 5, signal, onRetry }: RetryOptions = {},
): Promise<Response> {
  const reqId = ++globalRequestCount;
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const startTime = Date.now();
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal });
      const durationMs = Date.now() - startTime;
      if (process.env.DEBUG_LLM === "1") {
        console.debug(
          `[LLM Req #${reqId}] ${new Date().toISOString()} attempt=${attempt} status=${response.status} duration=${durationMs}ms`,
        );
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      if (process.env.DEBUG_LLM === "1") {
        console.debug(
          `[LLM Req #${reqId} Error] ${new Date().toISOString()} attempt=${attempt} duration=${durationMs}ms:`,
          err instanceof Error ? err.message : String(err),
        );
      }
      // Network-level error: retry unless aborted or out of attempts.
      if (signal?.aborted || attempt >= retries) {
        throw err;
      }
      const wait = backoffMs(attempt);
      onRetry?.(wait, attempt + 1);
      await sleep(wait, signal);
      attempt++;
      continue;
    }

    if (!RETRYABLE_STATUS.has(response.status) || attempt >= retries) {
      if (response.status === 429 && attempt >= retries) {
        throw new Error(
          `Persistent rate limit (HTTP 429) exceeded after ${retries} retries. Please check API quota.`,
        );
      }
      return response;
    }

    // Retryable status: wait (respecting Retry-After) and try again.
    const wait = retryAfterMs(response) ?? backoffMs(attempt);
    try {
      await response.body?.cancel();
    } catch {
      /* ignore */
    }
    onRetry?.(wait, attempt + 1);
    await sleep(wait, signal);
    attempt++;
  }
}

function backoffMs(attempt: number): number {
  if (process.env.NODE_ENV === "test" || process.env.FAST_RETRY === "1") {
    return 1;
  }
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
  return base + Math.floor(Math.random() * 400); // jitter to avoid thundering herd
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.min(60_000, Math.max(0, seconds * 1000));
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", onAbort);
    }
  });
}
