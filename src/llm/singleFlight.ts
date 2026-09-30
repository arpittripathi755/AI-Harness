/**
 * Single-flight gate for LLM requests.
 *
 * Only ONE LLM HTTP request may be in-flight at a time per process.
 * Every call to `withGate(fn)` queues behind any already-running call.
 * The gate is released in a `finally` block so errors and aborts never
 * leave the gate locked.
 *
 * Debug tracing (start/end timestamps and queue-wait time) is emitted when
 * the DEBUG_TOKEN_BUDGET environment variable is set to "1".
 */

let _activePromise: Promise<unknown> | null = null;
let _gateSeq = 0;

const DEBUG = () => process.env.DEBUG_TOKEN_BUDGET === "1";

/**
 * Acquire the single-flight gate, run `fn`, and release it.
 * Concurrent callers queue behind the current holder.
 */
export async function withGate<T>(fn: () => Promise<T>): Promise<T> {
  const seq = ++_gateSeq;
  const waitStart = Date.now();

  // Wait for any in-flight request to finish first
  while (_activePromise !== null) {
    try {
      await _activePromise;
    } catch {
      // Swallow — we only care that the gate is released, not the result
    }
  }

  const waitMs = Date.now() - waitStart;
  if (DEBUG() && waitMs > 5) {
    console.debug(
      `[Gate #${seq}] acquired after ${waitMs}ms wait — ${new Date().toISOString()}`,
    );
  }

  const startTime = Date.now();
  let resolve!: () => void;

  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  _activePromise = promise;

  try {
    const result = await fn();
    if (DEBUG()) {
      console.debug(
        `[Gate #${seq}] released after ${Date.now() - startTime}ms — ${new Date().toISOString()}`,
      );
    }
    return result;
  } catch (err) {
    if (DEBUG()) {
      console.debug(
        `[Gate #${seq}] released (error) after ${Date.now() - startTime}ms — ${new Date().toISOString()}`,
      );
    }
    throw err;
  } finally {
    _activePromise = null;
    resolve();
  }
}

/** Reset the gate (for tests only). */
export function _resetGateForTest(): void {
  _activePromise = null;
  _gateSeq = 0;
}
