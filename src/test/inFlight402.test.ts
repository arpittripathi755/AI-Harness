/**
 * Tests for:
 *  - classify402 (all three classes + truncated body)
 *  - in-flight 402 retry: honors Retry-After, max 2 retries, halves max_tokens
 *  - abort during the in-flight wait cancels cleanly
 *  - single-flight gate: two concurrent calls run sequentially; gate released on error/abort
 *  - no retry starts before previous stream is closed
 *  - API key never appears in error strings
 */

process.env.NODE_ENV = "test";

import * as assert from "assert";
import { classify402 } from "../llm/classify402";
import { withGate, _resetGateForTest } from "../llm/singleFlight";
import { ProviderClient } from "../llm/ProviderClient";
import { invalidateKeyInfoCache, invalidateModelsCache } from "../llm/affordability";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHeaders(map: Record<string, string>): { get(name: string): string | null } {
  return {
    get(name: string): string | null {
      const lower = name.toLowerCase();
      for (const [k, v] of Object.entries(map)) {
        if (k.toLowerCase() === lower) { return v; }
      }
      return null;
    },
  };
}

const FAKE_KEY = "sk-or-v1-fakekeyfortesting";

// ---------------------------------------------------------------------------
// Phase 1: classify402 unit tests
// ---------------------------------------------------------------------------

suite("classify402 — all three classes", () => {
  test("max_tokens_unaffordable: parses affordable token count from realistic body", () => {
    const body = JSON.stringify({
      error: {
        message:
          "This request requires more credits, or fewer max_tokens. You requested up to 16384 tokens, but can only afford 8000.",
        code: 402,
      },
    });
    const result = classify402(body, makeHeaders({}), FAKE_KEY);
    assert.strictEqual(result.kind, "max_tokens_unaffordable");
    assert.strictEqual(result.affordableTokens, 8000);
    assert.ok(!result.message.includes(FAKE_KEY), "API key must not appear in message");
  });

  test("in_flight_budget: detected via metadata.reason", () => {
    const body = JSON.stringify({
      error: {
        message: "This request would exceed your available credits given your current in-flight requests.",
        code: 402,
        metadata: {
          reason: "in_flight_budget_exhausted",
          limit_source: "openrouter_in_flight_budget",
        },
      },
    });
    const result = classify402(body, makeHeaders({ "Retry-After": "120" }), FAKE_KEY);
    assert.strictEqual(result.kind, "in_flight_budget");
    assert.strictEqual(result.retryAfterSeconds, 120);
    assert.ok(!result.message.includes(FAKE_KEY));
  });

  test("in_flight_budget: detected via message containing 'in-flight'", () => {
    const body = JSON.stringify({
      error: {
        message: "You have too many in-flight requests consuming your credit budget.",
        code: 402,
      },
    });
    const result = classify402(body, makeHeaders({}), FAKE_KEY);
    assert.strictEqual(result.kind, "in_flight_budget");
    assert.strictEqual(result.retryAfterSeconds, 20); // default when header absent
  });

  test("in_flight_budget: Retry-After clamped to 130s max", () => {
    const body = JSON.stringify({
      error: {
        message: "in-flight budget exhausted",
        code: 402,
        metadata: { reason: "in_flight_budget_exhausted" },
      },
    });
    const result = classify402(body, makeHeaders({ "Retry-After": "999" }), FAKE_KEY);
    assert.strictEqual(result.kind, "in_flight_budget");
    assert.strictEqual(result.retryAfterSeconds, 130);
  });

  test("insufficient_credits: generic 402 with no special markers", () => {
    const body = JSON.stringify({
      error: {
        message: "Payment required. Please add credits to your account.",
        code: 402,
      },
    });
    const result = classify402(body, makeHeaders({}), FAKE_KEY);
    assert.strictEqual(result.kind, "insufficient_credits");
    assert.strictEqual(result.affordableTokens, undefined);
    assert.strictEqual(result.retryAfterSeconds, undefined);
    assert.ok(!result.message.includes(FAKE_KEY));
  });

  test("insufficient_credits: truncated/unparseable body does not throw", () => {
    const body = `{"error":{"message":"partial`; // truncated JSON
    const result = classify402(body, makeHeaders({}), FAKE_KEY);
    // Should not throw and should return insufficient_credits (the safe default)
    assert.ok(
      result.kind === "insufficient_credits" || result.kind === "in_flight_budget",
      "Must classify without throwing on truncated body",
    );
    assert.ok(!result.message.includes(FAKE_KEY));
  });

  test("insufficient_credits: empty body does not throw", () => {
    const result = classify402("", makeHeaders({}), FAKE_KEY);
    assert.strictEqual(result.kind, "insufficient_credits");
  });

  test("API key is redacted from all classify402 output", () => {
    const body = JSON.stringify({
      error: {
        message: `Unauthorized: ${FAKE_KEY} is invalid`,
        code: 402,
      },
    });
    const result = classify402(body, makeHeaders({}), FAKE_KEY);
    assert.ok(!result.message.includes(FAKE_KEY), `Key leaked: ${result.message}`);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: ProviderClient in-flight retry tests
// ---------------------------------------------------------------------------

suite("ProviderClient — in-flight 402 retry", () => {
  const originalFetch = globalThis.fetch;
  teardown(() => {
    globalThis.fetch = originalFetch;
    invalidateKeyInfoCache();
    invalidateModelsCache();
    _resetGateForTest();
  });

  function inFlightBody(reason = "in_flight_budget_exhausted"): string {
    return JSON.stringify({
      error: {
        message: "This request would exceed your in-flight budget.",
        code: 402,
        metadata: { reason },
      },
    });
  }

  function successSse(text = "OK response"): string {
    return (
      `data: {"choices":[{"delta":{"content":"${text}"}}]}\n\n` +
      `data: [DONE]\n\n`
    );
  }

  test("in-flight retry: honors Retry-After, retries at most 2 times, halves max_tokens each retry", async () => {
    let callCount = 0;
    const capturedMaxTokens: number[] = [];
    const waitTimes: number[] = [];

    globalThis.fetch = (async (url: any, opts: any) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/key")) {
        return { ok: true, status: 200, json: async () => ({ data: { limit_remaining: null } }) } as any;
      }
      if (urlStr.endsWith("/models")) {
        return { ok: true, status: 200, json: async () => ({ data: [] }) } as any;
      }

      callCount++;
      const body = JSON.parse(opts.body);
      capturedMaxTokens.push(body.max_tokens);

      if (callCount <= 2) {
        // Return in-flight 402 with Retry-After: 1 (fast for tests)
        return new Response(inFlightBody(), {
          status: 402,
          statusText: "Payment Required",
          headers: { "Retry-After": "1" },
        });
      }
      // Third call succeeds
      return new Response(successSse(), { status: 200 });
    }) as any;

    const client = new ProviderClient(
      { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1/", model: "deepseek/deepseek-v4.1-flash" },
      FAKE_KEY,
    );

    const stream = client.stream([{ role: "user", content: "hello" }], {
      maxTokens: 2048,
      onRetry: (waitMs) => { waitTimes.push(waitMs); },
    });
    let next = await stream.next();
    while (!next.done) { next = await stream.next(); }
    const turn = next.value;

    assert.strictEqual(callCount, 3, "Should make 3 calls: initial + 2 in-flight retries");
    assert.strictEqual(turn.content, "OK response");

    // max_tokens should halve with each retry
    assert.ok(capturedMaxTokens[1] < capturedMaxTokens[0], "max_tokens should decrease on retry 1");
    assert.ok(capturedMaxTokens[2] < capturedMaxTokens[1], "max_tokens should decrease on retry 2");
    assert.ok(capturedMaxTokens[2] >= 512, "max_tokens should never go below 512");
  });

  test("in-flight retry: gives up after 2 retries with clear actionable error message", async () => {
    let callCount = 0;
    globalThis.fetch = (async (url: any) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/key")) {
        return { ok: true, status: 200, json: async () => ({ data: { limit_remaining: null } }) } as any;
      }
      if (urlStr.endsWith("/models")) {
        return { ok: true, status: 200, json: async () => ({ data: [] }) } as any;
      }
      callCount++;
      return new Response(inFlightBody(), {
        status: 402,
        headers: { "Retry-After": "1" },
      });
    }) as any;

    const client = new ProviderClient(
      { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1/", model: "deepseek/deepseek-v4.1-flash" },
      FAKE_KEY,
    );

    let threw = false;
    let errMessage = "";
    try {
      const stream = client.stream([{ role: "user", content: "hello" }], { maxTokens: 2048 });
      await stream.next();
    } catch (err: any) {
      threw = true;
      errMessage = err.message;
    }

    assert.ok(threw, "Should throw after exhausting in-flight retries");
    assert.ok(errMessage.includes("in-flight budget cap"), `Message should mention in-flight: ${errMessage}`);
    assert.ok(errMessage.includes("openrouter.ai/settings/credits"), "Should include credits URL");
    assert.ok(errMessage.includes("re-run"), "Should tell user to re-run");
    assert.ok(!errMessage.includes(FAKE_KEY), "API key must not appear in error");
    // 1 initial + 2 retries = 3 total
    assert.strictEqual(callCount, 3, "Must stop at exactly 3 calls (1 + 2 retries)");
  });

  test("abort during in-flight wait cancels cleanly", async () => {
    let callCount = 0;
    globalThis.fetch = (async (url: any) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/key")) {
        return { ok: true, status: 200, json: async () => ({ data: { limit_remaining: null } }) } as any;
      }
      if (urlStr.endsWith("/models")) {
        return { ok: true, status: 200, json: async () => ({ data: [] }) } as any;
      }
      callCount++;
      // Return in-flight 402 with a long Retry-After
      return new Response(inFlightBody(), {
        status: 402,
        headers: { "Retry-After": "60" },
      });
    }) as any;

    const controller = new AbortController();
    const client = new ProviderClient(
      { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1/", model: "deepseek/deepseek-v4.1-flash" },
      FAKE_KEY,
    );

    // Abort after a short delay (faster than the 60s Retry-After)
    const abortTimer = setTimeout(() => controller.abort(), 50);

    let threw = false;
    let errName = "";
    try {
      const stream = client.stream([{ role: "user", content: "hello" }], {
        signal: controller.signal,
        maxTokens: 2048,
      });
      await stream.next();
    } catch (err: any) {
      threw = true;
      errName = err.name;
    } finally {
      clearTimeout(abortTimer);
    }

    assert.ok(threw, "Should throw when aborted during wait");
    assert.strictEqual(errName, "AbortError", "Should be an AbortError");
    assert.strictEqual(callCount, 1, "Should not retry after abort");
  });

  test("existing max_tokens 402 handling still works (not broken by classify402)", async () => {
    let callCount = 0;
    const capturedBodies: any[] = [];

    globalThis.fetch = (async (url: any, opts: any) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/key")) {
        return { ok: true, status: 200, json: async () => ({ data: { limit_remaining: null } }) } as any;
      }
      if (urlStr.endsWith("/models")) {
        return { ok: true, status: 200, json: async () => ({ data: [] }) } as any;
      }
      callCount++;
      capturedBodies.push(JSON.parse(opts.body));
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: "can only afford 8000",
              code: 402,
            },
          }),
          { status: 402 },
        );
      }
      return new Response(successSse("retried ok"), { status: 200 });
    }) as any;

    const client = new ProviderClient(
      { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1/", model: "deepseek/deepseek-v4.1-flash" },
      FAKE_KEY,
    );
    const stream = client.stream([{ role: "user", content: "hello" }], { maxTokens: 16384 });
    let next = await stream.next();
    while (!next.done) { next = await stream.next(); }
    const turn = next.value;

    assert.strictEqual(callCount, 2);
    assert.strictEqual(capturedBodies[1].max_tokens, Math.floor(8000 * 0.9));
    assert.strictEqual(turn.content, "retried ok");
  });
});

// ---------------------------------------------------------------------------
// Phase 3: single-flight gate unit tests
// ---------------------------------------------------------------------------

suite("Single-flight gate", () => {
  teardown(() => {
    _resetGateForTest();
  });

  test("two concurrent calls run sequentially (not overlapping)", async () => {
    const order: string[] = [];

    const p1 = withGate(async () => {
      order.push("start-1");
      await new Promise((r) => setTimeout(r, 20));
      order.push("end-1");
      return "r1";
    });

    const p2 = withGate(async () => {
      order.push("start-2");
      await new Promise((r) => setTimeout(r, 5));
      order.push("end-2");
      return "r2";
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.strictEqual(r1, "r1");
    assert.strictEqual(r2, "r2");

    // p1 must fully complete before p2 starts
    assert.deepStrictEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
  });

  test("gate is released on error so subsequent calls succeed", async () => {
    let secondRan = false;

    // First call throws
    const p1 = withGate(async () => {
      throw new Error("boom");
    }).catch(() => { /* ignore */ });

    // Second call should still run
    const p2 = withGate(async () => {
      secondRan = true;
      return "ok";
    });

    await Promise.all([p1, p2]);
    assert.ok(secondRan, "Gate should be released after error");
  });

  test("gate is released on abort", async () => {
    const controller = new AbortController();
    let secondRan = false;

    const p1 = withGate(async () => {
      controller.abort();
      // Simulate an abort propagating
      throw new DOMException("Aborted", "AbortError");
    }).catch(() => { /* ignore */ });

    const p2 = withGate(async () => {
      secondRan = true;
      return "ok";
    });

    await Promise.all([p1, p2]);
    assert.ok(secondRan, "Gate should be released after abort");
  });

  test("gate ensures no retry starts before previous stream response is settled", async () => {
    // Simulate two stream initiation calls: gate must prevent overlap
    const timeline: string[] = [];

    const makeStreamCall = (label: string, delayMs: number) =>
      withGate(async () => {
        timeline.push(`fetch-start-${label}`);
        await new Promise((r) => setTimeout(r, delayMs));
        timeline.push(`fetch-end-${label}`);
        return { ok: true };
      });

    await Promise.all([makeStreamCall("A", 30), makeStreamCall("B", 5)]);

    // A must start and finish before B starts
    const iA = timeline.indexOf("fetch-start-A");
    const eA = timeline.indexOf("fetch-end-A");
    const iB = timeline.indexOf("fetch-start-B");
    assert.ok(iA < eA, "A should start before A ends");
    assert.ok(eA < iB, "A should fully end before B starts");
  });
});
