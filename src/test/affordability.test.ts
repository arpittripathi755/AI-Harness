import * as assert from "assert";
import {
  fetchKeyInfo,
  fetchModelPrices,
  getModelCompletionPrice,
  getAffordableTokens,
  invalidateKeyInfoCache,
  invalidateModelsCache,
} from "../llm/affordability";
import { ProviderClient } from "../llm/ProviderClient";
import { MODELS } from "../shared/models";

suite("Affordability-Aware Clamping and 402 Retry (Phase 2)", () => {
  const originalFetch = globalThis.fetch;

  teardown(() => {
    globalThis.fetch = originalFetch;
    invalidateKeyInfoCache();
    invalidateModelsCache();
  });

  test("fetchKeyInfo returns limitRemaining on successful 200 response", async () => {
    globalThis.fetch = (async (url: any) => {
      if (String(url).endsWith("/key")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              limit_remaining: 2.5,
              usage: 0.5,
            },
          }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    }) as any;

    const info = await fetchKeyInfo("sk-test-key-123");
    assert.ok(info);
    assert.strictEqual(info?.limitRemaining, 2.5);
  });

  test("fetchKeyInfo returns null limitRemaining for unlimited keys", async () => {
    invalidateKeyInfoCache();
    globalThis.fetch = (async (url: any) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            limit_remaining: null,
          },
        }),
      } as any;
    }) as any;

    const info = await fetchKeyInfo("sk-test-unlimited");
    assert.ok(info);
    assert.strictEqual(info?.limitRemaining, null);
  });

  test("fetchKeyInfo fails open (returns null, never throws) on network or HTTP error", async () => {
    invalidateKeyInfoCache();
    // Non-200
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as any;
    }) as any;

    const info500 = await fetchKeyInfo("sk-test-fail");
    assert.strictEqual(info500, null);

    // Network throw
    invalidateKeyInfoCache();
    globalThis.fetch = (async () => {
      throw new Error("Network offline");
    }) as any;

    const infoErr = await fetchKeyInfo("sk-test-throw");
    assert.strictEqual(infoErr, null);
  });

  test("getAffordableTokens returns Infinity when price is missing or limit is null", async () => {
    invalidateKeyInfoCache();
    globalThis.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { limit_remaining: 10.0 } }),
      } as any;
    }) as any;

    // Model without completionPricePerToken
    const affordable = await getAffordableTokens("deepseek/deepseek-v4.1-flash", "sk-test-key");
    assert.strictEqual(affordable, Infinity);
  });

  test("getAffordableTokens clamps based on 0.9 safety margin and completionPricePerToken", async () => {
    invalidateKeyInfoCache();
    globalThis.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { limit_remaining: 1.0 } }), // $1.00 remaining
      } as any;
    }) as any;

    const testModelId = "test/priced-model";
    MODELS.push({
      displayName: "Priced Model",
      apiModelId: testModelId,
      completionPricePerToken: 0.0001, // $0.0001 per token -> $1.00 * 0.9 / 0.0001 = 9,000 tokens
    });

    try {
      const affordable = await getAffordableTokens(testModelId, "sk-test-key");
      assert.strictEqual(affordable, 9000);
    } finally {
      const idx = MODELS.findIndex((m) => m.apiModelId === testModelId);
      if (idx !== -1) {
        MODELS.splice(idx, 1);
      }
    }
  });

  test("fetchModelPrices fetches pricing and returns price from cache on subsequent calls", async () => {
    let fetchCount = 0;
    globalThis.fetch = (async (url: any) => {
      if (String(url).endsWith("/models")) {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "qwen/qwen-2.5-72b-instruct",
                pricing: { prompt: "0.0000001", completion: "0.0000004" },
              },
            ],
          }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    }) as any;

    // Call 1: makes fetch
    const prices1 = await fetchModelPrices();
    assert.ok(prices1);
    assert.strictEqual(prices1?.["qwen/qwen-2.5-72b-instruct"], 0.0000004);
    assert.strictEqual(fetchCount, 1);

    // Call 2: served from memory cache without refetching
    const prices2 = await fetchModelPrices();
    assert.ok(prices2);
    assert.strictEqual(prices2?.["qwen/qwen-2.5-72b-instruct"], 0.0000004);
    assert.strictEqual(fetchCount, 1, "Must be served from cache without second network call");
  });

  test("getModelCompletionPrice returns null when model pricing is missing", async () => {
    globalThis.fetch = (async (url: any) => {
      if (String(url).endsWith("/models")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "unrelated/model",
                pricing: { prompt: "0.0001" }, // missing completion pricing
              },
            ],
          }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    }) as any;

    const price = await getModelCompletionPrice("unknown/unpriced-model");
    assert.strictEqual(price, null);
  });

  test("fetchModelPrices fails open (returns null, never throws) on fetch failure", async () => {
    // 500 error
    globalThis.fetch = (async () => ({ ok: false, status: 500 }) as any) as any;
    const res500 = await fetchModelPrices();
    assert.strictEqual(res500, null);

    // Network throw
    invalidateModelsCache();
    globalThis.fetch = (async () => {
      throw new Error("DNS resolution failed");
    }) as any;
    const resErr = await fetchModelPrices();
    assert.strictEqual(resErr, null);
  });

  test("getAffordableTokens uses runtime pricing lookup when model metadata lacks price", async () => {
    globalThis.fetch = (async (url: any) => {
      const urlStr = String(url);
      if (urlStr.endsWith("/models")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "custom/runtime-priced-model",
                pricing: { completion: "0.0002" }, // $0.0002 per token
              },
            ],
          }),
        } as any;
      }
      if (urlStr.endsWith("/key")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { limit_remaining: 2.0 } }), // $2.00 remaining
        } as any;
      }
      return { ok: false, status: 404 } as any;
    }) as any;

    // $2.00 * 0.9 / 0.0002 = 9,000 tokens
    const affordable = await getAffordableTokens("custom/runtime-priced-model", "sk-test-key");
    assert.strictEqual(affordable, 9000);
  });

  test("ProviderClient 402 fallback parses affordable tokens, reduces by 0.9, and retries once", async () => {
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
      const body = JSON.parse(opts.body);
      capturedBodies.push(body);

      if (callCount === 1) {
        // Return 402 with affordable tokens notice
        const errorJson = JSON.stringify({
          error: {
            message: "This request requires more credits, or fewer max_tokens. You requested up to 16384 tokens, but can only afford 8000.",
            code: 402,
          },
        });
        return new Response(errorJson, { status: 402, statusText: "Payment Required" });
      }

      // Second call (retry) succeeds with SSE stream
      const sseBody = "data: {\"choices\":[{\"delta\":{\"content\":\"Retried successfully\"}}]}\n\ndata: [DONE]\n\n";
      return new Response(sseBody, { status: 200, statusText: "OK" });
    }) as any;

    const client = new ProviderClient(
      { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1/", model: "deepseek/deepseek-v4.1-flash" },
      "sk-test-402",
    );

    const stream = client.stream([{ role: "user", content: "hello" }]);
    const events: any[] = [];
    let next = await stream.next();
    while (!next.done) {
      events.push(next.value);
      next = await stream.next();
    }
    const finalTurn = next.value;

    assert.strictEqual(callCount, 2, "Should make exactly 2 calls (initial + single retry)");
    assert.strictEqual(capturedBodies[0].max_tokens, 16384);
    assert.strictEqual(capturedBodies[1].max_tokens, Math.floor(8000 * 0.9)); // 7200
    assert.strictEqual(finalTurn.content, "Retried successfully");
  });

  test("ProviderClient 402 with tiny affordable tokens (< 256) throws immediately without retrying", async () => {
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
      const errorJson = JSON.stringify({
        error: {
          message: "You requested up to 16384 tokens, but can only afford 120.",
          code: 402,
        },
      });
      return new Response(errorJson, { status: 402, statusText: "Payment Required" });
    }) as any;

    const client = new ProviderClient(
      { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1/", model: "deepseek/deepseek-v4.1-flash" },
      "sk-test-tiny",
    );

    let threw = false;
    try {
      const stream = client.stream([{ role: "user", content: "hello" }]);
      await stream.next();
    } catch (err: any) {
      threw = true;
      assert.ok(err.message.includes("OpenRouter balance is too low"));
      assert.ok(err.message.includes("120"));
    }

    assert.ok(threw, "Should have thrown for tiny affordable tokens");
    assert.strictEqual(callCount, 1, "Should NOT have retried when affordable tokens < 256");
  });

  test("ProviderClient does NOT retry a second time if the retry also returns 402", async () => {
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
      const errorJson = JSON.stringify({
        error: {
          message: "You requested up to 8000 tokens, but can only afford 4000.",
          code: 402,
        },
      });
      return new Response(errorJson, { status: 402, statusText: "Payment Required" });
    }) as any;

    const client = new ProviderClient(
      { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1/", model: "deepseek/deepseek-v4.1-flash" },
      "sk-test-second-402",
    );

    let threw = false;
    try {
      const stream = client.stream([{ role: "user", content: "hello" }]);
      await stream.next();
    } catch (err: any) {
      threw = true;
      assert.ok(err.message.includes("402"));
    }

    assert.ok(threw, "Should throw after retry failure");
    assert.strictEqual(callCount, 2, "Must stop after exactly 1 retry (2 total calls)");
  });
});
