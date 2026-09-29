/**
 * Provider layer unit tests — all HTTP calls are mocked.
 * No real API requests are made during `make test`.
 */

process.env.NODE_ENV = "test";

import * as assert from "assert";
import {
  CANONICAL_MODEL,
  OPENROUTER_PROVIDER,
  AWS_BEDROCK_PROVIDER,
  PROVIDER_PRIORITY,
} from "../llm/providers";
import {
  ProviderClient,
  detectProviders,
  buildProviderClient,
  type ProviderDetectionResult,
} from "../llm/ProviderClient";
import { LLMClient } from "../llm/LLMClient";

// ---------------------------------------------------------------------------
// Minimal global fetch mock (replaced per-test via globalThis.fetch)
// ---------------------------------------------------------------------------


function makeMockResponse(
  status: number,
  body: object | string,
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Install a per-URL response map as the global fetch. */
function mockFetch(map: Record<string, () => Response>): void {
  (globalThis as any).fetch = async (
    input: string | URL,
    _init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    for (const pattern of Object.keys(map)) {
      if (url.includes(pattern)) {
        return map[pattern]();
      }
    }
    return makeMockResponse(503, { error: "no mock for: " + url });
  };
}

const realFetch = globalThis.fetch;
function restoreFetch(): void {
  (globalThis as any).fetch = realFetch;
}

// ---------------------------------------------------------------------------
// 1. Canonical model configuration
// ---------------------------------------------------------------------------

suite("Provider: canonical model", () => {
  test("CANONICAL_MODEL is exactly 'deepseek/deepseek-v4.1-flash'", () => {
    assert.strictEqual(CANONICAL_MODEL, "deepseek/deepseek-v4.1-flash");
  });

  test("OpenRouter provider uses canonical model", () => {
    assert.strictEqual(OPENROUTER_PROVIDER.model, CANONICAL_MODEL);
  });

  test("AWS Bedrock provider uses canonical model", () => {
    assert.strictEqual(AWS_BEDROCK_PROVIDER.model, CANONICAL_MODEL);
  });
});

// ---------------------------------------------------------------------------
// 2. Provider configurations
// ---------------------------------------------------------------------------

suite("Provider: configurations", () => {
  test("OpenRouter baseUrl points to openrouter.ai/api/v1", () => {
    assert.ok(
      OPENROUTER_PROVIDER.baseUrl.includes("openrouter.ai/api/v1"),
      `Expected openrouter.ai/api/v1 in ${OPENROUTER_PROVIDER.baseUrl}`,
    );
  });

  test("AWS Bedrock baseUrl points to bedrock-runtime ap-south-1", () => {
    assert.ok(
      AWS_BEDROCK_PROVIDER.baseUrl.includes("bedrock-runtime.ap-south-1.amazonaws.com"),
      `Expected bedrock endpoint in ${AWS_BEDROCK_PROVIDER.baseUrl}`,
    );
  });

  test("PROVIDER_PRIORITY has OpenRouter first", () => {
    assert.strictEqual(PROVIDER_PRIORITY[0].name, "OpenRouter");
  });

  test("PROVIDER_PRIORITY has AWS Bedrock second", () => {
    assert.strictEqual(PROVIDER_PRIORITY[1].name, "AWS Bedrock");
  });

  test("provider names are distinct", () => {
    const names = PROVIDER_PRIORITY.map((p) => p.name);
    assert.strictEqual(new Set(names).size, names.length);
  });
});

// ---------------------------------------------------------------------------
// 3. API key validation
// ---------------------------------------------------------------------------

suite("Provider: API key validation", () => {
  test("buildProviderClient throws when no providers available", () => {
    const result: ProviderDetectionResult = {
      statuses: [
        { name: "OpenRouter", available: false, error: "401 Unauthorized" },
        { name: "AWS Bedrock", available: false, error: "401 Unauthorized" },
      ],
      activeProvider: null,
    };

    assert.throws(
      () => buildProviderClient(result, "test-key"),
      /No LLM provider is available/,
    );
  });

  test("error message from buildProviderClient does not contain the API key", () => {
    const apiKey = "super-secret-key-12345";
    const result: ProviderDetectionResult = {
      statuses: [
        { name: "OpenRouter", available: false, error: "401 Unauthorized" },
        { name: "AWS Bedrock", available: false, error: "Network error" },
      ],
      activeProvider: null,
    };

    try {
      buildProviderClient(result, apiKey);
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert.ok(
        !err.message.includes(apiKey),
        "Error must not contain the API key",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 4. detectProviders — mocked HTTP
// ---------------------------------------------------------------------------

suite("Provider: detectProviders (mocked)", () => {
  teardown(() => restoreFetch());

  test("OpenRouter success → OpenRouter is active", async () => {
    mockFetch({
      "openrouter.ai": () =>
        makeMockResponse(200, {
          choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
        }),
      "bedrock-runtime": () => makeMockResponse(503, { error: "unavailable" }),
    });

    const result = await detectProviders("test-key");
    assert.ok(
      result.statuses.find((s) => s.name === "OpenRouter")?.available,
      "OpenRouter should be available",
    );
    assert.strictEqual(result.activeProvider?.name, "OpenRouter");
  });

  test("AWS success when OpenRouter fails → AWS Bedrock is active", async () => {
    mockFetch({
      "openrouter.ai": () => makeMockResponse(401, { error: "unauthorized" }),
      "bedrock-runtime": () =>
        makeMockResponse(200, {
          choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
        }),
    });

    const result = await detectProviders("test-key");
    assert.ok(
      result.statuses.find((s) => s.name === "AWS Bedrock")?.available,
      "AWS Bedrock should be available",
    );
    assert.strictEqual(result.activeProvider?.name, "AWS Bedrock");
  });

  test("OpenRouter failure + AWS success → AWS Bedrock is active", async () => {
    mockFetch({
      "openrouter.ai": () => makeMockResponse(500, { error: "server error" }),
      "bedrock-runtime": () =>
        makeMockResponse(200, {
          choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
        }),
    });

    const result = await detectProviders("key");
    assert.strictEqual(result.activeProvider?.name, "AWS Bedrock");
    assert.ok(!result.statuses.find((s) => s.name === "OpenRouter")?.available);
  });

  test("AWS failure + OpenRouter success → OpenRouter is active", async () => {
    mockFetch({
      "openrouter.ai": () =>
        makeMockResponse(200, {
          choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
        }),
      "bedrock-runtime": () => makeMockResponse(500, { error: "fail" }),
    });

    const result = await detectProviders("key");
    assert.strictEqual(result.activeProvider?.name, "OpenRouter");
  });

  test("both providers unavailable → activeProvider is null", async () => {
    mockFetch({
      "openrouter.ai": () => makeMockResponse(503, { error: "down" }),
      "bedrock-runtime": () => makeMockResponse(503, { error: "down" }),
    });

    const result = await detectProviders("key");
    assert.strictEqual(result.activeProvider, null);
    assert.ok(result.statuses.every((s) => !s.available));
  });

  test("provider selection: both available → OpenRouter wins (priority order)", async () => {
    mockFetch({
      "openrouter.ai": () =>
        makeMockResponse(200, {
          choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
        }),
      "bedrock-runtime": () =>
        makeMockResponse(200, {
          choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
        }),
    });

    const result = await detectProviders("key");
    assert.strictEqual(
      result.activeProvider?.name,
      "OpenRouter",
      "OpenRouter should win when both are available",
    );
  });
});

// ---------------------------------------------------------------------------
// 5. ProviderClient streaming — mock SSE
// ---------------------------------------------------------------------------

function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(`data: ${e}\n\n`));
      }
      controller.close();
    },
  });
}

suite("Provider: ProviderClient streaming (mocked)", () => {
  teardown(() => restoreFetch());

  test("normal text response is normalized correctly", async () => {
    const chunk = JSON.stringify({
      choices: [
        {
          delta: { content: "Hello" },
          finish_reason: null,
        },
      ],
    });
    const done = "[DONE]";

    (globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      body: sseStream([chunk, done]),
    } as Response);

    const client = new ProviderClient(OPENROUTER_PROVIDER, "test-key");
    const gen = client.stream([{ role: "user", content: "hi" }]);

    let textDelta = "";
    let result = await gen.next();
    while (!result.done) {
      if (result.value.type === "text") {
        textDelta += result.value.delta;
      }
      result = await gen.next();
    }
    const turn = result.value;
    assert.strictEqual(textDelta, "Hello");
    assert.strictEqual(turn.toolCalls.length, 0);
  });

  test("tool-call response is normalized correctly", async () => {
    const chunk = JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_abc",
                type: "function",
                function: { name: "read_file", arguments: "{\"path\":\"src/main.ts\"}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });

    (globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      body: sseStream([chunk, "[DONE]"]),
    } as Response);

    const client = new ProviderClient(OPENROUTER_PROVIDER, "test-key");
    const gen = client.stream([{ role: "user", content: "read main.ts" }]);

    let result = await gen.next();
    while (!result.done) {
      result = await gen.next();
    }
    const turn = result.value;
    assert.strictEqual(turn.toolCalls.length, 1);
    assert.strictEqual(turn.toolCalls[0].function.name, "read_file");
    assert.ok(turn.toolCalls[0].function.arguments.includes("src/main.ts"));
  });

  test("HTTP 401 error identifies provider without exposing API key", async () => {
    const apiKey = "secret-key-xyz";
    (globalThis as any).fetch = async () =>
      makeMockResponse(401, { error: "Unauthorized" });

    const client = new ProviderClient(OPENROUTER_PROVIDER, apiKey);
    const gen = client.stream([{ role: "user", content: "hi" }]);

    try {
      let r = await gen.next();
      while (!r.done) {
        r = await gen.next();
      }
      assert.fail("Should have thrown on 401");
    } catch (err: any) {
      assert.ok(err.message.includes("401"), "Error should mention HTTP status");
      assert.ok(!err.message.includes(apiKey), "Error must NOT include the API key");
    }
  });

  test("timeout / network failure propagates a usable error", async function () {
    this.timeout(10000);
    (globalThis as any).fetch = async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    };

    const client = new ProviderClient(OPENROUTER_PROVIDER, "key");
    const gen = client.stream([{ role: "user", content: "hi" }]);

    await assert.rejects(async () => {
      let r = await gen.next();
      while (!r.done) {
        r = await gen.next();
      }
    });
  });

  test("malformed SSE response yields empty turn without crashing", async () => {
    (globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      body: sseStream(["NOT_VALID_JSON", "[DONE]"]),
    } as Response);

    const client = new ProviderClient(OPENROUTER_PROVIDER, "key");
    const gen = client.stream([{ role: "user", content: "hi" }]);
    let r = await gen.next();
    while (!r.done) {
      r = await gen.next();
    }
    // Should complete without error
    assert.ok(r.done);
  });
});

// ---------------------------------------------------------------------------
// 6. Fallback behavior
// ---------------------------------------------------------------------------

suite("Provider: runtime fallback", () => {
  teardown(() => restoreFetch());

  test("falls back to secondary provider on primary stream failure", async function () {
    this.timeout(10000);
    let callCount = 0;
    (globalThis as any).fetch = async (input: any) => {
      callCount++;
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("openrouter.ai")) {
        return makeMockResponse(503, { error: "service unavailable" });
      }
      // AWS fallback succeeds
      return {
        ok: true,
        status: 200,
        body: sseStream([
          JSON.stringify({
            choices: [{ delta: { content: "fallback response" }, finish_reason: null }],
          }),
          "[DONE]",
        ]),
      } as Response;
    };

    const client = new ProviderClient(
      OPENROUTER_PROVIDER,
      "key",
      AWS_BEDROCK_PROVIDER,
    );
    const gen = client.stream([{ role: "user", content: "hi" }]);
    let r = await gen.next();
    let text = "";
    while (!r.done) {
      if (r.value.type === "text") {
        text += r.value.delta;
      }
      r = await gen.next();
    }
    assert.ok(text.includes("fallback response"), "Should have received fallback response");
    // Primary was tried, fallback was also tried
    assert.ok(callCount >= 2);
  });

  test("does not fall back on 401 auth errors (bad key should fail fast)", async () => {
    let callCount = 0;
    (globalThis as any).fetch = async (input: any) => {
      const url = typeof input === "string" ? input : input?.url || input?.toString() || "";
      if (url.includes("/models") || url.includes("/key")) {
        return makeMockResponse(200, { data: [] });
      }
      callCount++;
      return makeMockResponse(401, { error: "Unauthorized" });
    };

    const client = new ProviderClient(
      OPENROUTER_PROVIDER,
      "bad-key",
      AWS_BEDROCK_PROVIDER,
    );
    const gen = client.stream([{ role: "user", content: "hi" }]);

    await assert.rejects(async () => {
      let r = await gen.next();
      while (!r.done) {
        r = await gen.next();
      }
    }, /401/);

    assert.strictEqual(callCount, 1, "Should not attempt fallback on auth error");
  });
});

// ---------------------------------------------------------------------------
// 7. buildProviderClient — selection logic
// ---------------------------------------------------------------------------

suite("Provider: buildProviderClient selection", () => {
  test("selects first available provider", () => {
    const result: ProviderDetectionResult = {
      statuses: [
        { name: "OpenRouter", available: true },
        { name: "AWS Bedrock", available: true },
      ],
      activeProvider: OPENROUTER_PROVIDER,
    };
    const client = buildProviderClient(result, "key");
    assert.strictEqual(client.providerName, "OpenRouter");
    assert.strictEqual(client.canonicalModel, CANONICAL_MODEL);
  });

  test("selects AWS when OpenRouter is the only available", () => {
    const result: ProviderDetectionResult = {
      statuses: [
        { name: "OpenRouter", available: false, error: "403" },
        { name: "AWS Bedrock", available: true },
      ],
      activeProvider: AWS_BEDROCK_PROVIDER,
    };
    const client = buildProviderClient(result, "key");
    assert.strictEqual(client.providerName, "AWS Bedrock");
  });

  test("canonicalModel is always CANONICAL_MODEL", () => {
    const result: ProviderDetectionResult = {
      statuses: [{ name: "OpenRouter", available: true }],
      activeProvider: OPENROUTER_PROVIDER,
    };
    const client = buildProviderClient(result, "key");
    assert.strictEqual(client.canonicalModel, "deepseek/deepseek-v4.1-flash");
  });
});

// ---------------------------------------------------------------------------
// 8. Runtime configuration: setModel, setBaseUrl, resolveModelId
// ---------------------------------------------------------------------------

suite("Provider: runtime configuration", () => {
  test("ProviderClient.setModel updates model immediately", () => {
    const client = new ProviderClient(
      { ...OPENROUTER_PROVIDER },
      "test-key",
      { ...AWS_BEDROCK_PROVIDER },
    );
    assert.strictEqual(client.model, CANONICAL_MODEL);

    client.setModel("custom/my-new-model");
    assert.strictEqual(client.model, "custom/my-new-model");
  });

  test("ProviderClient.setBaseUrl updates endpoint and detects known providers", () => {
    const client = new ProviderClient(
      { ...OPENROUTER_PROVIDER },
      "test-key",
    );
    assert.strictEqual(client.providerName, "OpenRouter");
    assert.strictEqual(client.providerBaseUrl, "https://openrouter.ai/api/v1/");

    // Switch to AWS Bedrock
    client.setBaseUrl("https://bedrock-runtime.ap-south-1.amazonaws.com/openai/v1");
    assert.strictEqual(client.providerName, "AWS Bedrock");
    assert.strictEqual(
      client.providerBaseUrl,
      "https://bedrock-runtime.ap-south-1.amazonaws.com/openai/v1/",
    );

    // Switch to custom endpoint
    client.setBaseUrl("https://api.mycustomai.com/v1");
    assert.strictEqual(client.providerName, "Custom");
    assert.strictEqual(client.providerBaseUrl, "https://api.mycustomai.com/v1/");
  });

  test("ProviderClient.setBaseUrl preserves active model", () => {
    const client = new ProviderClient(
      { ...OPENROUTER_PROVIDER },
      "test-key",
    );
    client.setModel("custom/preserved-model");
    client.setBaseUrl("https://bedrock-runtime.ap-south-1.amazonaws.com/openai/v1");
    assert.strictEqual(client.model, "custom/preserved-model");
  });
});

// ---------------------------------------------------------------------------
// 9. Token budget request payload verification
// ---------------------------------------------------------------------------

suite("Provider: token budget request payload", () => {
  teardown(() => restoreFetch());

  test("OpenRouter request body contains max_tokens = 16384 and stream = true by default", async () => {
    let capturedBody: any = null;
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        ok: true,
        status: 200,
        body: sseStream(["[DONE]"]),
      } as Response;
    };

    const client = new ProviderClient(OPENROUTER_PROVIDER, "test-key");
    const gen = client.stream([{ role: "user", content: "hi" }]);
    await gen.next();

    assert.ok(capturedBody, "Request body should have been captured");
    assert.strictEqual(capturedBody.stream, true);
    assert.strictEqual(capturedBody.max_tokens, 16384);
  });

  test("OpenRouter request body respects custom maxTokens in StreamOptions", async () => {
    let capturedBody: any = null;
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        ok: true,
        status: 200,
        body: sseStream(["[DONE]"]),
      } as Response;
    };

    const client = new ProviderClient(OPENROUTER_PROVIDER, "test-key");
    const gen = client.stream([{ role: "user", content: "hi" }], { maxTokens: 8192 });
    await gen.next();

    assert.ok(capturedBody, "Request body should have been captured");
    assert.strictEqual(capturedBody.stream, true);
    assert.strictEqual(capturedBody.max_tokens, 8192);
  });

  test("LLMClient direct chat/completions sends max_tokens = 16384 and stream = true", async () => {
    let capturedBody: any = null;
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        ok: true,
        status: 200,
        body: sseStream(["[DONE]"]),
      } as Response;
    };

    const llm = new LLMClient({
      baseUrl: "https://openrouter.ai/api/v1/",
      model: "deepseek/deepseek-v4.1-flash",
      apiKey: "test-key",
    });
    const gen = llm.stream([{ role: "user", content: "hi" }]);
    await gen.next();

    assert.ok(capturedBody, "Request body should have been captured");
    assert.strictEqual(capturedBody.stream, true);
    assert.strictEqual(capturedBody.max_tokens, 16384);
  });

  test("LLMClient.fromProviderClient passes maxTokens to delegated stream", async () => {
    let capturedBody: any = null;
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        ok: true,
        status: 200,
        body: sseStream(["[DONE]"]),
      } as Response;
    };

    const providerClient = new ProviderClient(OPENROUTER_PROVIDER, "test-key");
    const llm = LLMClient.fromProviderClient(providerClient, "test-key", 4096);
    const gen = llm.stream([{ role: "user", content: "hi" }]);
    await gen.next();

    assert.ok(capturedBody, "Request body should have been captured");
    assert.strictEqual(capturedBody.stream, true);
    assert.strictEqual(capturedBody.max_tokens, 4096);
  });
});

// ---------------------------------------------------------------------------
// 10. Exact model request payload & runtime model switching
// ---------------------------------------------------------------------------

suite("Provider: exact model request and runtime switching", () => {
  teardown(() => restoreFetch());

  test("OpenRouter request body contains exact DeepSeek model ID when DeepSeek is active", async () => {
    let capturedBody: any = null;
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        ok: true,
        status: 200,
        body: sseStream(["[DONE]"]),
      } as Response;
    };

    const client = new ProviderClient(
      { ...OPENROUTER_PROVIDER, model: "deepseek/deepseek-v4.1-flash" },
      "test-key",
    );
    const gen = client.stream([{ role: "user", content: "hi" }]);
    await gen.next();

    assert.ok(capturedBody, "Request body should have been captured");
    assert.strictEqual(capturedBody.model, "deepseek/deepseek-v4.1-flash");
  });

  test("OpenRouter request body contains exact Qwen model ID when Qwen is active", async () => {
    let capturedBody: any = null;
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        ok: true,
        status: 200,
        body: sseStream(["[DONE]"]),
      } as Response;
    };

    const client = new ProviderClient(
      { ...OPENROUTER_PROVIDER, model: "qwen/qwen3-coder" },
      "test-key",
    );
    const gen = client.stream([{ role: "user", content: "hi" }]);
    await gen.next();

    assert.ok(capturedBody, "Request body should have been captured");
    assert.strictEqual(capturedBody.model, "qwen/qwen3-coder");
    assert.notStrictEqual(capturedBody.model, "deepseek/deepseek-v4.1-flash");
  });

  test("OpenRouter request body contains exact unknown/custom model ID without DeepSeek fallback", async () => {
    let capturedBody: any = null;
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        ok: true,
        status: 200,
        body: sseStream(["[DONE]"]),
      } as Response;
    };

    const client = new ProviderClient(
      { ...OPENROUTER_PROVIDER, model: "provider/custom-model-id" },
      "test-key",
    );
    const gen = client.stream([{ role: "user", content: "hi" }]);
    await gen.next();

    assert.ok(capturedBody, "Request body should have been captured");
    assert.strictEqual(capturedBody.model, "provider/custom-model-id");
  });

  test("Runtime model switch dynamically updates LLMClient request model", async () => {
    let capturedBody: any = null;
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        ok: true,
        status: 200,
        body: sseStream(["[DONE]"]),
      } as Response;
    };

    const providerClient = new ProviderClient(
      { ...OPENROUTER_PROVIDER, model: "deepseek/deepseek-v4.1-flash" },
      "test-key",
    );
    const llm = LLMClient.fromProviderClient(providerClient, "test-key");

    // First request: DeepSeek
    const gen1 = llm.stream([{ role: "user", content: "first" }]);
    await gen1.next();
    assert.strictEqual(capturedBody.model, "deepseek/deepseek-v4.1-flash");

    // Runtime switch to Qwen: /model qwen/qwen3-coder
    llm.setModel("qwen/qwen3-coder");
    assert.strictEqual(llm.getModel(), "qwen/qwen3-coder");
    assert.strictEqual(providerClient.model, "qwen/qwen3-coder");

    // Second request: Qwen
    const gen2 = llm.stream([{ role: "user", content: "second" }]);
    await gen2.next();
    assert.strictEqual(capturedBody.model, "qwen/qwen3-coder");

    // Runtime switch back to DeepSeek: /model deepseek/deepseek-chat
    llm.setModel("deepseek/deepseek-chat");
    assert.strictEqual(llm.getModel(), "deepseek/deepseek-chat");
    assert.strictEqual(providerClient.model, "deepseek/deepseek-chat");

    // Third request: DeepSeek V3
    const gen3 = llm.stream([{ role: "user", content: "third" }]);
    await gen3.next();
    assert.strictEqual(capturedBody.model, "deepseek/deepseek-chat");
  });

  test("Model selection is independent of the API key", async () => {
    let capturedBody: any = null;
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        ok: true,
        status: 200,
        body: sseStream(["[DONE]"]),
      } as Response;
    };

    const apiKey = "sk-or-v1-same-fixed-key";

    // Same API key with DeepSeek
    const clientDeepSeek = new ProviderClient(
      { ...OPENROUTER_PROVIDER, model: "deepseek/deepseek-v4.1-flash" },
      apiKey,
    );
    const genA = clientDeepSeek.stream([{ role: "user", content: "ping" }]);
    await genA.next();
    assert.strictEqual(capturedBody.model, "deepseek/deepseek-v4.1-flash");

    // Same API key with Qwen
    const clientQwen = new ProviderClient(
      { ...OPENROUTER_PROVIDER, model: "qwen/qwen3-coder" },
      apiKey,
    );
    const genB = clientQwen.stream([{ role: "user", content: "ping" }]);
    await genB.next();
    assert.strictEqual(capturedBody.model, "qwen/qwen3-coder");
  });
});
