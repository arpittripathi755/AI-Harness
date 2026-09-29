import * as assert from "assert";
import { ProviderClient } from "../llm/ProviderClient";
import { LLMClient } from "../llm/LLMClient";
import {
  recordModelAffordability,
  clearAffordabilityCache,
  getAffordableTokens,
} from "../llm/affordability";
import {
  MODELS,
  resolveModelId,
  DEFAULT_MAX_TOKENS,
} from "../shared/models";
import {
  DERIVED_REASONING_FLOOR,
  getPhaseMaxTokens,
} from "../llm/tokenBudget";
import type { ProviderConfig } from "../llm/providers";

suite("OpenRouter 402 Affordability and Token Clamping Regression (Phase 9)", () => {
  const NEMOTRON = "nvidia/nemotron-3-ultra-550b-a55b";
  const TEST_KEY = "sk-or-v1-test-affordability-key";
  const OPENROUTER_PROVIDER: ProviderConfig = {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1/",
    model: NEMOTRON,
  };

  const originalFetch = globalThis.fetch;
  const originalEnvMaxTokens = process.env.MAX_TOKENS;
  const originalEnvFloor = process.env.DAXIOM_MIN_REASONING_FLOOR;

  setup(() => {
    clearAffordabilityCache();
    delete process.env.MAX_TOKENS;
    delete process.env.AI_MAX_TOKENS;
    delete process.env.DAXIOM_MIN_REASONING_FLOOR;
  });

  teardown(() => {
    globalThis.fetch = originalFetch;
    clearAffordabilityCache();
    if (originalEnvMaxTokens !== undefined) {
      process.env.MAX_TOKENS = originalEnvMaxTokens;
    } else {
      delete process.env.MAX_TOKENS;
    }
    if (originalEnvFloor !== undefined) {
      process.env.DAXIOM_MIN_REASONING_FLOOR = originalEnvFloor;
    } else {
      delete process.env.DAXIOM_MIN_REASONING_FLOOR;
    }
  });

  function sseStreamResponse(content = "hello", toolCalls?: any[]): Response {
    const chunk = {
      choices: [
        {
          delta: {
            content,
            tool_calls: toolCalls,
          },
          finish_reason: "stop",
        },
      ],
    };
    const sseBody = `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
    return new Response(sseBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  // ---------------------------------------------------------------------------
  // TEST 1 — Affordable request: requested = 16384, affordable = 5507 -> <= 5507
  // ---------------------------------------------------------------------------
  test("TEST 1: Affordable request clamps 16384 to <= 5507", async () => {
    recordModelAffordability(NEMOTRON, 5507);
    let capturedBody: any = null;

    globalThis.fetch = (async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes("chat/completions")) {
        if (typeof init?.body === "string") {
          capturedBody = JSON.parse(init.body);
        }
        return sseStreamResponse("ok");
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "hi" }], { maxTokens: 16384 });
    for await (const _ of gen) {}

    assert.ok(capturedBody, "Request body was captured");
    assert.ok(
      capturedBody.max_tokens <= 5507,
      `Expected max_tokens <= 5507, got ${capturedBody.max_tokens}`,
    );
  });

  // ---------------------------------------------------------------------------
  // TEST 2 — Normal budget: requested = 4096, affordable = 10000 -> remains 4096
  // ---------------------------------------------------------------------------
  test("TEST 2: Normal budget (4096) remains 4096 when affordable is 10000", async () => {
    recordModelAffordability(NEMOTRON, 10000);
    let capturedBody: any = null;

    globalThis.fetch = (async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes("chat/completions")) {
        if (typeof init?.body === "string") {
          capturedBody = JSON.parse(init.body);
        }
        return sseStreamResponse("ok");
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "hi" }], { maxTokens: 4096 });
    for await (const _ of gen) {}

    assert.ok(capturedBody, "Request body was captured");
    assert.strictEqual(
      capturedBody.max_tokens,
      4096,
      `Expected max_tokens === 4096, got ${capturedBody.max_tokens}`,
    );
  });

  // ---------------------------------------------------------------------------
  // TEST 3 — Model ceiling: requested = 16384, modelMax = 8192, affordable = 10000 -> <= 8192
  // ---------------------------------------------------------------------------
  test("TEST 3: Model ceiling caps requested budget to model maxOutputTokens", async () => {
    const testModelId = "test/restricted-output-model";
    MODELS.push({
      displayName: "Restricted Output Model",
      apiModelId: testModelId,
      maxOutputTokens: 8192,
    });
    recordModelAffordability(testModelId, 10000);
    let capturedBody: any = null;

    try {
      globalThis.fetch = (async (url: any, init?: any) => {
        const urlStr = String(url);
        if (urlStr.includes("chat/completions")) {
          if (typeof init?.body === "string") {
            capturedBody = JSON.parse(init.body);
          }
          return sseStreamResponse("ok");
        }
        return new Response("{}", { status: 200 });
      }) as any;

      const provider: ProviderConfig = {
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1/",
        model: testModelId,
      };
      const client = new ProviderClient(provider, TEST_KEY);
      const gen = client.stream([{ role: "user", content: "hi" }], { maxTokens: 16384 });
      for await (const _ of gen) {}

      assert.ok(capturedBody, "Request body was captured");
      assert.ok(
        capturedBody.max_tokens <= 8192,
        `Expected max_tokens <= 8192, got ${capturedBody.max_tokens}`,
      );
    } finally {
      const idx = MODELS.findIndex((m) => m.apiModelId === testModelId);
      if (idx !== -1) {
        MODELS.splice(idx, 1);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 4 — Environment ceiling: requested = 16384, envCeiling = 4096, affordable = 10000 -> <= 4096
  // ---------------------------------------------------------------------------
  test("TEST 4: Environment ceiling MAX_TOKENS caps requested budget to <= 4096", async () => {
    process.env.MAX_TOKENS = "4096";
    recordModelAffordability(NEMOTRON, 10000);
    let capturedBody: any = null;

    globalThis.fetch = (async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes("chat/completions")) {
        if (typeof init?.body === "string") {
          capturedBody = JSON.parse(init.body);
        }
        return sseStreamResponse("ok");
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "hi" }], { phase: "edit", maxTokens: 16384 });
    for await (const _ of gen) {}

    assert.ok(capturedBody, "Request body was captured");
    assert.ok(
      capturedBody.max_tokens <= 4096,
      `Expected max_tokens <= 4096, got ${capturedBody.max_tokens}`,
    );
  });

  // ---------------------------------------------------------------------------
  // TEST 5 — Reasoning floor: requested = 16384, floor = 2560, affordable = 5507 -> floor respected & <= 5507
  // ---------------------------------------------------------------------------
  test("TEST 5: Reasoning floor is respected while staying affordable", async () => {
    process.env.DAXIOM_MIN_REASONING_FLOOR = "1";
    recordModelAffordability(NEMOTRON, 5507);
    let capturedBody: any = null;

    globalThis.fetch = (async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes("chat/completions")) {
        if (typeof init?.body === "string") {
          capturedBody = JSON.parse(init.body);
        }
        return sseStreamResponse("ok");
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "analyze" }], {
      phase: "tool_decision",
      maxTokens: 16384,
    });
    for await (const _ of gen) {}

    assert.ok(capturedBody, "Request body was captured");
    assert.ok(
      capturedBody.max_tokens <= 5507,
      `Expected max_tokens <= 5507, got ${capturedBody.max_tokens}`,
    );
    assert.ok(
      capturedBody.max_tokens >= DERIVED_REASONING_FLOOR,
      `Expected max_tokens >= floor (${DERIVED_REASONING_FLOOR}), got ${capturedBody.max_tokens}`,
    );
  });

  // ---------------------------------------------------------------------------
  // TEST 6 — Affordability below floor: floor = 2560, affordable < 2560 -> throws descriptive error
  // ---------------------------------------------------------------------------
  test("TEST 6: Affordability below floor throws descriptive error without sending request", async () => {
    process.env.DAXIOM_MIN_REASONING_FLOOR = "1";
    recordModelAffordability(NEMOTRON, 1500);
    let requestSent = false;

    globalThis.fetch = (async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("chat/completions")) {
        requestSent = true;
        return sseStreamResponse("should not be called");
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    let caughtError: Error | null = null;
    try {
      const gen = client.stream([{ role: "user", content: "think" }], {
        phase: "tool_decision",
        maxTokens: 16384,
      });
      for await (const _ of gen) {}
    } catch (err: any) {
      caughtError = err;
    }

    assert.ok(caughtError, "Expected stream to throw error when affordable < floor");
    assert.match(
      caughtError.message,
      /OpenRouter balance is too low.*can only afford 1500 tokens.*minimum required for reasoning is 2560/i,
      `Expected error to explain balance is too low for reasoning floor, got: ${caughtError.message}`,
    );
    assert.strictEqual(requestSent, false, "No chat/completions request should be sent when affordable < floor");
  });

  // ---------------------------------------------------------------------------
  // TEST 7 — 402 max_tokens_unaffordable: provider returns 402 with affordable=5507 -> retries with affordable
  // ---------------------------------------------------------------------------
  test("TEST 7: 402 max_tokens_unaffordable retries once with affordable tokens and caches limit", async () => {
    let callCount = 0;
    const capturedBodies: any[] = [];

    globalThis.fetch = (async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes("chat/completions")) {
        callCount++;
        if (typeof init?.body === "string") {
          capturedBodies.push(JSON.parse(init.body));
        }
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              error: {
                message:
                  "This request requires more credits, or fewer max_tokens. You requested up to 16384 tokens, but can only afford 5507.",
                code: 402,
                metadata: { limit_source: "openrouter_credits" },
              },
            }),
            { status: 402, headers: { "Content-Type": "application/json" } },
          );
        }
        return sseStreamResponse("recovered content");
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "hello" }], { maxTokens: 16384 });
    let fullText = "";
    for await (const ev of gen) {
      if (ev.type === "text") fullText += ev.delta;
    }

    assert.strictEqual(callCount, 2, "Expected exactly 1 retry after 402");
    assert.strictEqual(fullText, "recovered content");
    assert.strictEqual(capturedBodies[0].max_tokens, 16384, "First request sent 16384");
    assert.ok(
      capturedBodies[1].max_tokens <= 5507,
      `Retry request must be <= 5507, got ${capturedBodies[1].max_tokens}`,
    );
    assert.strictEqual(
      capturedBodies[1].max_tokens,
      Math.floor(5507 * 0.9),
      `Retry request should use floor(5507 * 0.9) = 4956`,
    );

    // Verify subsequent call automatically uses the recorded limit without 402
    capturedBodies.length = 0;
    const secondGen = client.stream([{ role: "user", content: "turn 2" }], { maxTokens: 16384 });
    for await (const _ of secondGen) {}
    assert.ok(
      capturedBodies[0].max_tokens <= 5507,
      `Turn 2 must pre-clamp to <= 5507 from cache, got ${capturedBodies[0].max_tokens}`,
    );
  });

  // ---------------------------------------------------------------------------
  // TEST 8 — In-flight 402: preserves existing in-flight halving and retry behavior
  // ---------------------------------------------------------------------------
  test("TEST 8: In-flight 402 retries with Retry-After and halved max_tokens", async () => {
    let callCount = 0;
    const capturedBodies: any[] = [];

    globalThis.fetch = (async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes("chat/completions")) {
        callCount++;
        if (typeof init?.body === "string") {
          capturedBodies.push(JSON.parse(init.body));
        }
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              error: {
                message:
                  "This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.",
                code: 402,
                metadata: {
                  reason: "in_flight_budget_exhausted",
                  limit_source: "openrouter_in_flight_budget",
                },
              },
            }),
            {
              status: 402,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": "0", // 0 wait for fast unit test
              },
            },
          );
        }
        return sseStreamResponse("settled in-flight response");
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "test in flight" }], { maxTokens: 4000 });
    let text = "";
    for await (const ev of gen) {
      if (ev.type === "text") text += ev.delta;
    }

    assert.strictEqual(callCount, 2, "Expected 1 retry after in-flight 402");
    assert.strictEqual(text, "settled in-flight response");
    assert.strictEqual(capturedBodies[0].max_tokens, 4000);
    assert.strictEqual(capturedBodies[1].max_tokens, 2000, "In-flight retry should halve max_tokens to 2000");
  });

  // ---------------------------------------------------------------------------
  // TEST 9 — 429: preserves existing 429 retry behavior
  // ---------------------------------------------------------------------------
  test("TEST 9: HTTP 429 triggers retry via fetchWithRetry and delivers response", async () => {
    let callCount = 0;

    globalThis.fetch = (async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("chat/completions")) {
        callCount++;
        if (callCount === 1) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "Retry-After": "0" },
          });
        }
        return sseStreamResponse("429 recovered text");
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "test 429" }], { maxTokens: 2048 });
    let text = "";
    for await (const ev of gen) {
      if (ev.type === "text") text += ev.delta;
    }

    assert.ok(callCount > 1, "fetchWithRetry should have retried after 429");
    assert.strictEqual(text, "429 recovered text");
  });

  // ---------------------------------------------------------------------------
  // TEST 10 — Streaming: successful streaming works cleanly after affordability clamping
  // ---------------------------------------------------------------------------
  test("TEST 10: Streaming delivers incremental text chunks after affordability clamping", async () => {
    recordModelAffordability(NEMOTRON, 5507);
    const chunks = ["Hello", " world", " from", " clamped", " streaming!"];

    globalThis.fetch = (async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("chat/completions")) {
        const sseLines = chunks
          .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
          .join("") + "data: [DONE]\n\n";
        return new Response(sseLines, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "stream please" }], { maxTokens: 16384 });
    const received: string[] = [];
    for await (const ev of gen) {
      if (ev.type === "text") received.push(ev.delta);
    }

    assert.deepStrictEqual(received, chunks);
    assert.strictEqual(received.join(""), "Hello world from clamped streaming!");
  });

  // ---------------------------------------------------------------------------
  // TEST 11 — Tool call: tool-call requests use clamped max_tokens
  // ---------------------------------------------------------------------------
  test("TEST 11: Tool calls are included and request uses clamped max_tokens", async () => {
    recordModelAffordability(NEMOTRON, 5507);
    let capturedBody: any = null;

    globalThis.fetch = (async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes("chat/completions")) {
        if (typeof init?.body === "string") {
          capturedBody = JSON.parse(init.body);
        }
        return sseStreamResponse("", [
          {
            index: 0,
            id: "call-1",
            function: { name: "read_file", arguments: '{"path":"file.ts"}' },
          },
        ]);
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "read file" }], {
      maxTokens: 16384,
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        },
      ],
    });
    for await (const _ of gen) {}

    assert.ok(capturedBody, "Request body was captured");
    assert.ok(
      capturedBody.max_tokens <= 5507,
      `Expected max_tokens <= 5507 for tool call turn, got ${capturedBody.max_tokens}`,
    );
    assert.ok(Array.isArray(capturedBody.tools), "tools array should be attached");
    assert.strictEqual(capturedBody.tools[0].function.name, "read_file");
  });

  // ---------------------------------------------------------------------------
  // TEST 12 — OpenRouter model: model is nvidia/nemotron-3-ultra-550b-a55b and NOT lightning-ai/...
  // ---------------------------------------------------------------------------
  test("TEST 12: Request uses exact OpenRouter model nvidia/nemotron-3-ultra-550b-a55b and not lightning-ai/...", async () => {
    let capturedBody: any = null;

    globalThis.fetch = (async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes("chat/completions")) {
        if (typeof init?.body === "string") {
          capturedBody = JSON.parse(init.body);
        }
        return sseStreamResponse("model ok");
      }
      return new Response("{}", { status: 200 });
    }) as any;

    const client = new LLMClient({
      baseUrl: "https://openrouter.ai/api/v1/",
      model: NEMOTRON,
      apiKey: TEST_KEY,
    });
    const gen = client.stream([{ role: "user", content: "check model" }]);
    for await (const _ of gen) {}

    assert.ok(capturedBody, "Request body was captured");
    assert.strictEqual(
      capturedBody.model,
      "nvidia/nemotron-3-ultra-550b-a55b",
      `Expected exact OpenRouter model ID, got ${capturedBody.model}`,
    );
    assert.ok(
      !capturedBody.model.includes("lightning-ai"),
      `Model ID must not contain lightning-ai, got ${capturedBody.model}`,
    );
  });
});
