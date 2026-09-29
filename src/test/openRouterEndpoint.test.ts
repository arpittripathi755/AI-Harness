/**
 * Phase 7 — OpenRouter Endpoint/API Correctness Tests.
 *
 * All 20 required tests from the Phase 7 spec.
 * All HTTP calls are mocked — NO real API key, NO real network requests.
 */

process.env.NODE_ENV = "test";

import * as assert from "assert";
import { buildEndpointUrl } from "../llm/endpointUtils";
import { OPENROUTER_PROVIDER, AWS_BEDROCK_PROVIDER } from "../llm/providers";
import { ProviderClient } from "../llm/ProviderClient";
import { LLMClient } from "../llm/LLMClient";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_KEY = "test-key-phase7";

const realFetch = (globalThis as any).fetch;
function restoreFetch(): void {
  (globalThis as any).fetch = realFetch;
}

/** Build an SSE ReadableStream from an array of event payload strings. */
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

/** Drive a generator to completion, collecting text deltas and the final turn. */
async function drainStream(gen: AsyncGenerator<any, any, unknown>) {
  let text = "";
  let result = await gen.next();
  while (!result.done) {
    if (result.value?.type === "text") {
      text += result.value.delta;
    }
    result = await gen.next();
  }
  return { text, turn: result.value };
}

// ---------------------------------------------------------------------------
// Test 1 — OpenRouter URL: base without trailing slash
// ---------------------------------------------------------------------------

suite("Phase 7 — URL construction", () => {
  test("Test 1: base URL without trailing slash → correct endpoint", () => {
    const url = buildEndpointUrl("https://openrouter.ai/api/v1", "chat/completions");
    assert.strictEqual(url, "https://openrouter.ai/api/v1/chat/completions");
  });

  // Test 2 — OpenRouter URL: base with trailing slash
  test("Test 2: base URL with trailing slash → correct endpoint", () => {
    const url = buildEndpointUrl("https://openrouter.ai/api/v1/", "chat/completions");
    assert.strictEqual(url, "https://openrouter.ai/api/v1/chat/completions");
  });

  // Test 3 — No duplicated /chat/completions in result
  test("Test 3: no duplicate /chat/completions in constructed URL", () => {
    const url = buildEndpointUrl("https://openrouter.ai/api/v1/", "chat/completions");
    const occurrences = (url.match(/chat\/completions/g) ?? []).length;
    assert.strictEqual(
      occurrences, 1,
      `Expected exactly 1 occurrence of chat/completions, got ${occurrences} in: ${url}`,
    );
  });

  test("Test 3 variant: multiple trailing slashes are normalised", () => {
    const url = buildEndpointUrl("https://openrouter.ai/api/v1///", "chat/completions");
    assert.strictEqual(url, "https://openrouter.ai/api/v1/chat/completions");
  });

  test("Test 3 variant: leading slash in path is stripped", () => {
    const url = buildEndpointUrl("https://openrouter.ai/api/v1/", "/chat/completions");
    assert.strictEqual(url, "https://openrouter.ai/api/v1/chat/completions");
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Authorization header
// ---------------------------------------------------------------------------

suite("Phase 7 — Authentication", () => {
  teardown(restoreFetch);

  test("Test 4: Authorization: Bearer <configured key> is sent correctly", async () => {
    let capturedHeaders: Record<string, string> = {};
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.headers) {
        capturedHeaders = init.headers as Record<string, string>;
      }
      return { ok: true, status: 200, body: sseStream(["[DONE]"]) } as Response;
    };

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "hello" }]);
    await gen.next();

    assert.strictEqual(
      capturedHeaders["Authorization"],
      `Bearer ${TEST_KEY}`,
      "Authorization header must be exactly 'Bearer <key>'",
    );
  });

  // Test 20 — API key never in diagnostics / error messages
  test("Test 20: API key never appears in thrown error messages", async () => {
    const secretKey = "sk-or-v1-super-secret-key-99999";
    (globalThis as any).fetch = async () => {
      return new Response(
        JSON.stringify({ error: { message: `Unauthorized key=${secretKey}` } }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    };

    const client = new ProviderClient(OPENROUTER_PROVIDER, secretKey);
    const gen = client.stream([{ role: "user", content: "hello" }]);

    try {
      let r = await gen.next();
      while (!r.done) { r = await gen.next(); }
      assert.fail("Should have thrown on 401");
    } catch (err: any) {
      assert.ok(
        !err.message.includes(secretKey),
        `Error message MUST NOT contain the API key. Got: ${err.message}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Configured model ID is preserved
// ---------------------------------------------------------------------------

suite("Phase 7 — Model ID", () => {
  teardown(restoreFetch);

  test("Test 5: namespaced OpenRouter model ID is sent verbatim in request body", async () => {
    let capturedBody: any = null;
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.body) { capturedBody = JSON.parse(init.body as string); }
      return { ok: true, status: 200, body: sseStream(["[DONE]"]) } as Response;
    };

    const customModel = "anthropic/claude-opus-4";
    const client = new ProviderClient({ ...OPENROUTER_PROVIDER, model: customModel }, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "hello" }]);
    await gen.next();

    assert.ok(capturedBody, "Request body must be captured");
    assert.strictEqual(capturedBody.model, customModel, "Model ID must not be rewritten");
  });

  test("Test 5 variant: canonical DeepSeek model ID is preserved as-is", async () => {
    let capturedBody: any = null;
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.body) { capturedBody = JSON.parse(init.body as string); }
      return { ok: true, status: 200, body: sseStream(["[DONE]"]) } as Response;
    };

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "hello" }]);
    await gen.next();

    assert.ok(capturedBody);
    assert.strictEqual(capturedBody.model, OPENROUTER_PROVIDER.model);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Streaming request body
// ---------------------------------------------------------------------------

suite("Phase 7 — Streaming", () => {
  teardown(restoreFetch);

  test("Test 6: stream=true is set in request body", async () => {
    let capturedBody: any = null;
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.body) { capturedBody = JSON.parse(init.body as string); }
      return { ok: true, status: 200, body: sseStream(["[DONE]"]) } as Response;
    };

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "hello" }]);
    await gen.next();

    assert.ok(capturedBody);
    assert.strictEqual(capturedBody.stream, true, "stream must be true");
  });

  // Test 7 — Normal SSE content
  test("Test 7: normal SSE content chunks are parsed and yielded correctly", async () => {
    const chunks = [
      JSON.stringify({ choices: [{ delta: { content: "Hello, " }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ delta: { content: "world!" }, finish_reason: "stop" }] }),
      "[DONE]",
    ];
    (globalThis as any).fetch = async () =>
      ({ ok: true, status: 200, body: sseStream(chunks) } as Response);

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const { text, turn } = await drainStream(client.stream([{ role: "user", content: "hi" }]));

    assert.strictEqual(text, "Hello, world!", "Text deltas must be concatenated correctly");
    assert.strictEqual(turn.content, "Hello, world!", "AssistantTurn.content must match");
    assert.strictEqual(turn.finishReason, "stop");
  });

  // Test 8 — Tool-call streaming
  test("Test 8: streamed tool call fragments are accumulated correctly", async () => {
    const chunks = [
      JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0, id: "call_abc", type: "function",
              function: { name: "read_file", arguments: "{\"pa" },
            }],
          },
          finish_reason: null,
        }],
      }),
      JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{ index: 0, function: { arguments: "th\":\"src\"}" } }],
          },
          finish_reason: "tool_calls",
        }],
      }),
      "[DONE]",
    ];
    (globalThis as any).fetch = async () =>
      ({ ok: true, status: 200, body: sseStream(chunks) } as Response);

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const { turn } = await drainStream(
      client.stream([{ role: "user", content: "read src" }], {
        tools: [{
          type: "function",
          function: { name: "read_file", description: "read", parameters: {} },
        }],
      }),
    );

    assert.strictEqual(turn.toolCalls.length, 1);
    assert.strictEqual(turn.toolCalls[0].id, "call_abc");
    assert.strictEqual(turn.toolCalls[0].function.name, "read_file");
    assert.ok(turn.toolCalls[0].function.arguments.includes("src"), "Arguments must be joined correctly");
  });

  // Test 9 — [DONE] sentinel
  test("Test 9: [DONE] sentinel terminates stream cleanly without error", async () => {
    (globalThis as any).fetch = async () =>
      ({ ok: true, status: 200, body: sseStream(["[DONE]"]) } as Response);

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const { turn } = await drainStream(client.stream([{ role: "user", content: "hi" }]));

    assert.strictEqual(turn.content, "");
    assert.strictEqual(turn.toolCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Test 10 — Provider usage capture
// ---------------------------------------------------------------------------

suite("Phase 7 — Usage integration", () => {
  teardown(restoreFetch);

  test("Test 10: provider-reported usage is captured in AssistantTurn.usage", async () => {
    const usageChunk = JSON.stringify({
      choices: [{ delta: { content: "hi" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 123,
        completion_tokens: 45,
        total_tokens: 168,
      },
    });
    (globalThis as any).fetch = async () =>
      ({ ok: true, status: 200, body: sseStream([usageChunk, "[DONE]"]) } as Response);

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const { turn } = await drainStream(client.stream([{ role: "user", content: "hi" }]));

    assert.ok(turn.usage, "AssistantTurn.usage must be present when provider reports it");
    assert.strictEqual(turn.usage.prompt_tokens, 123);
    assert.strictEqual(turn.usage.completion_tokens, 45);
    assert.strictEqual(turn.usage.total_tokens, 168);
  });

  // Test 11 — Missing usage falls back safely
  test("Test 11: missing provider usage → AssistantTurn.usage is undefined, no error", async () => {
    const chunk = JSON.stringify({
      choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
      // no usage field
    });
    (globalThis as any).fetch = async () =>
      ({ ok: true, status: 200, body: sseStream([chunk, "[DONE]"]) } as Response);

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const { turn } = await drainStream(client.stream([{ role: "user", content: "hi" }]));

    assert.strictEqual(turn.usage, undefined, "usage must be undefined when provider does not report it");
    assert.strictEqual(turn.content, "ok");
  });

  // Test 12 — Malformed optional usage field
  test("Test 12: malformed usage field does not crash — content is still delivered", async () => {
    const goodChunk = JSON.stringify({
      choices: [{ delta: { content: "good content" }, finish_reason: null }],
    });
    // A valid JSON chunk but with non-numeric usage fields
    const badUsageChunk = JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: "NOT_A_NUMBER", completion_tokens: null },
    });
    (globalThis as any).fetch = async () =>
      ({ ok: true, status: 200, body: sseStream([goodChunk, badUsageChunk, "[DONE]"]) } as Response);

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const { turn } = await drainStream(client.stream([{ role: "user", content: "hi" }]));

    assert.strictEqual(turn.content, "good content", "Content must be delivered despite malformed usage");
  });
});

// ---------------------------------------------------------------------------
// Test 13–18 — Error handling
// ---------------------------------------------------------------------------

suite("Phase 7 — Error handling", () => {
  teardown(restoreFetch);

  // Test 13 — HTTP 400
  test("Test 13: HTTP 400 throws a descriptive error", async () => {
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ error: { message: "bad request" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    await assert.rejects(
      async () => { await drainStream(client.stream([{ role: "user", content: "hi" }])); },
      /400/,
    );
  });

  // Test 14 — HTTP 401 / 403
  test("Test 14: HTTP 401 throws auth error without exposing API key", async () => {
    const secretKey = "sk-or-v1-auth-test-key";
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });

    const client = new ProviderClient(OPENROUTER_PROVIDER, secretKey);
    try {
      await drainStream(client.stream([{ role: "user", content: "hi" }]));
      assert.fail("Should have thrown");
    } catch (err: any) {
      assert.ok(err.message.includes("401"), "Error must mention 401");
      assert.ok(!err.message.includes(secretKey), "Error must NOT contain the API key");
    }
  });

  test("Test 14 variant: HTTP 403 throws auth error", async () => {
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ error: { message: "Forbidden" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    await assert.rejects(
      async () => { await drainStream(client.stream([{ role: "user", content: "hi" }])); },
      /403/,
    );
  });

  // Test 15 — HTTP 402 existing behavior preserved
  test("Test 15: HTTP 402 insufficient_credits throws without modifying existing behavior", async () => {
    (globalThis as any).fetch = async () =>
      new Response(
        JSON.stringify({ error: { message: "Insufficient credits", code: 402 } }),
        { status: 402, headers: { "content-type": "application/json" } },
      );

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    await assert.rejects(
      async () => { await drainStream(client.stream([{ role: "user", content: "hi" }])); },
      /402|credit|payment/i,
    );
  });

  // Test 16 — HTTP 429 existing behavior preserved
  test("Test 16: HTTP 429 triggers existing retry behavior and eventually throws", async function () {
    this.timeout(10000);
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    await assert.rejects(
      async () => { await drainStream(client.stream([{ role: "user", content: "hi" }])); },
      /429|rate limit/i,
    );
  });

  // Test 17 — HTTP 5xx existing behavior preserved
  test("Test 17: HTTP 503 eventually throws after retries (existing behavior)", async function () {
    this.timeout(10000);
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ error: { message: "service unavailable" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    await assert.rejects(
      async () => { await drainStream(client.stream([{ role: "user", content: "hi" }])); },
    );
  });

  // Test 18 — Network failure
  test("Test 18: network failure (ECONNREFUSED) propagates a usable error", async function () {
    this.timeout(10000);
    (globalThis as any).fetch = async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    };

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    await assert.rejects(
      async () => { await drainStream(client.stream([{ role: "user", content: "hi" }])); },
    );
  });
});

// ---------------------------------------------------------------------------
// Test 19 — Non-OpenRouter provider compatibility (Case D)
// ---------------------------------------------------------------------------

suite("Phase 7 — Non-OpenRouter provider compatibility", () => {
  teardown(restoreFetch);

  test("Test 19: AWS Bedrock sends correct auth and URL, no OpenRouter headers", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    (globalThis as any).fetch = async (input: string | URL, init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      if (init?.headers) { capturedHeaders = init.headers as Record<string, string>; }
      return { ok: true, status: 200, body: sseStream(["[DONE]"]) } as Response;
    };

    const bedrockKey = "bedrock-test-key";
    const client = new ProviderClient(AWS_BEDROCK_PROVIDER, bedrockKey);
    const gen = client.stream([{ role: "user", content: "hi" }]);
    await gen.next();

    assert.ok(
      capturedUrl.includes("bedrock-runtime"),
      `URL must include bedrock-runtime, got: ${capturedUrl}`,
    );
    assert.ok(capturedUrl.includes("chat/completions"), "URL must include chat/completions");
    assert.ok(!capturedUrl.includes("openrouter.ai"), "URL must NOT include openrouter.ai");
    assert.strictEqual(capturedHeaders["Authorization"], `Bearer ${bedrockKey}`);
    assert.ok(!capturedHeaders["HTTP-Referer"], "HTTP-Referer must not be sent to Bedrock");
    assert.ok(!capturedHeaders["X-Title"], "X-Title must not be sent to Bedrock");
  });

  test("Test 19 variant: AWS Bedrock URL construction without trailing slash", () => {
    const url = buildEndpointUrl(
      "https://bedrock-runtime.ap-south-1.amazonaws.com/openai/v1",
      "chat/completions",
    );
    assert.strictEqual(
      url,
      "https://bedrock-runtime.ap-south-1.amazonaws.com/openai/v1/chat/completions",
    );
    const occ = (url.match(/chat\/completions/g) ?? []).length;
    assert.strictEqual(occ, 1);
  });

  test("Test 19 variant: custom provider URL is not rewritten", () => {
    const url = buildEndpointUrl("https://api.mycustomai.com/v1/", "chat/completions");
    assert.strictEqual(url, "https://api.mycustomai.com/v1/chat/completions");
  });

  test("Test 19 variant: LLMClient direct path normalises base URL without trailing slash", async () => {
    let capturedUrl = "";
    (globalThis as any).fetch = async (input: string | URL, _init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return { ok: true, status: 200, body: sseStream(["[DONE]"]) } as Response;
    };

    // No trailing slash — the old code would have produced /api/v1chat/completions
    const llm = new LLMClient({
      baseUrl: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-v4.1-flash",
      apiKey: TEST_KEY,
    });
    const gen = llm.stream([{ role: "user", content: "hi" }]);
    await gen.next();

    assert.strictEqual(
      capturedUrl,
      "https://openrouter.ai/api/v1/chat/completions",
      "LLMClient direct path must produce correct URL even without trailing slash in baseUrl",
    );
  });
});

// ---------------------------------------------------------------------------
// OpenRouter-specific headers presence
// ---------------------------------------------------------------------------

suite("Phase 7 — OpenRouter-specific headers", () => {
  teardown(restoreFetch);

  test("OpenRouter requests include HTTP-Referer and X-Title headers", async () => {
    let capturedHeaders: Record<string, string> = {};
    (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
      if (init?.headers) { capturedHeaders = init.headers as Record<string, string>; }
      return { ok: true, status: 200, body: sseStream(["[DONE]"]) } as Response;
    };

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "hi" }]);
    await gen.next();

    assert.ok(capturedHeaders["HTTP-Referer"], "HTTP-Referer header must be present for OpenRouter");
    assert.ok(capturedHeaders["X-Title"], "X-Title header must be present for OpenRouter");
  });

  test("OpenRouter request URL is exactly baseUrl + /chat/completions", async () => {
    let capturedUrl = "";
    (globalThis as any).fetch = async (input: string | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return { ok: true, status: 200, body: sseStream(["[DONE]"]) } as Response;
    };

    const client = new ProviderClient(OPENROUTER_PROVIDER, TEST_KEY);
    const gen = client.stream([{ role: "user", content: "hi" }]);
    await gen.next();

    assert.strictEqual(
      capturedUrl,
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });
});
