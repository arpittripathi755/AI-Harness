import * as assert from "assert";
import {
  MODELS,
  DEFAULT_MODEL_ID,
  resolveModelId,
  getModelByApiId,
  isOpenRouterModelId,
} from "../shared/models";
import { LLMClient } from "../llm/LLMClient";
import { AWS_BEDROCK_PROVIDER } from "../llm/providers";
import { buildEndpointUrl } from "../llm/endpointUtils";
import { ChatSession } from "../agent/ChatSession";
import { ToolRegistry } from "../tools/registry";
import type { ToolDefinition } from "../llm/types";

const MOCK_API_KEY = "sk-or-v1-mock-test-key-abcdef123456";

suite("Nemotron Model ID Regression Suite (Phase 9)", () => {
  const NEMOTRON_ID = "nvidia/nemotron-3-ultra-550b-a55b";
  const INVALID_LEGACY_ID = "lightning-ai/nvidia/nemotron-3-ultra-550b-a55b";
  const INVALID_LEGACY_DASH_ID = "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b";

  // ---------------------------------------------------------------------------
  // TEST 1 — OpenRouter model ID
  // ---------------------------------------------------------------------------
  test("TEST 1: OpenRouter model ID is preserved with no prefix added", () => {
    const resolved = resolveModelId(NEMOTRON_ID);
    assert.strictEqual(
      resolved,
      NEMOTRON_ID,
      `Expected '${NEMOTRON_ID}' without any prefix, got '${resolved}'`,
    );
    assert.ok(
      isOpenRouterModelId(resolved),
      `Expected valid OpenRouter format 'org/model', got '${resolved}'`,
    );
  });

  // ---------------------------------------------------------------------------
  // TEST 2 — Explicit regression against current bug
  // ---------------------------------------------------------------------------
  test("TEST 2: Assert nvidia/nemotron-3-ultra-550b-a55b is NOT transformed into lightning-ai/...", () => {
    const resolved = resolveModelId(NEMOTRON_ID);
    assert.notStrictEqual(
      resolved,
      INVALID_LEGACY_ID,
      `Regression! Model ID must NOT be transformed into '${INVALID_LEGACY_ID}'`,
    );
    assert.notStrictEqual(
      resolved,
      INVALID_LEGACY_DASH_ID,
      `Regression! Model ID must NOT be transformed into '${INVALID_LEGACY_DASH_ID}'`,
    );
    assert.ok(
      !resolved.startsWith("lightning-ai/"),
      `Model ID must not start with 'lightning-ai/', got '${resolved}'`,
    );

    // Also assert that legacy inputs with the erroneous prefix resolve back to the correct ID
    assert.strictEqual(
      resolveModelId(INVALID_LEGACY_ID),
      NEMOTRON_ID,
      `Legacy prefix input '${INVALID_LEGACY_ID}' must resolve to clean ID '${NEMOTRON_ID}'`,
    );
    assert.strictEqual(
      resolveModelId(INVALID_LEGACY_DASH_ID),
      NEMOTRON_ID,
      `Legacy dash input '${INVALID_LEGACY_DASH_ID}' must resolve to clean ID '${NEMOTRON_ID}'`,
    );
    assert.strictEqual(
      resolveModelId("ultra"),
      NEMOTRON_ID,
      "Alias 'ultra' must resolve to Nemotron ID",
    );
    assert.strictEqual(
      resolveModelId("nemotron"),
      NEMOTRON_ID,
      "Alias 'nemotron' must resolve to Nemotron ID",
    );
  });

  // ---------------------------------------------------------------------------
  // TEST 3 — OpenRouter request body
  // ---------------------------------------------------------------------------
  test("TEST 3: OpenRouter request body contains exact model nvidia/nemotron-3-ultra-550b-a55b", async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (async (_url: any, init: any) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body.toString());
        }
        return new Response(
          "data: " +
            JSON.stringify({
              id: "gen-1",
              choices: [
                {
                  delta: { content: "ok" },
                  finish_reason: "stop",
                },
              ],
            }) +
            "\n\ndata: [DONE]\n\n",
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      }) as any;

      const client = new LLMClient({
        baseUrl: "https://openrouter.ai/api/v1/",
        model: NEMOTRON_ID,
        apiKey: MOCK_API_KEY,
      });

      const gen = client.stream([{ role: "user", content: "hello" }]);
      for await (const _ of gen) {
        // consume
      }

      assert.ok(capturedBody, "Request body was captured");
      assert.strictEqual(
        capturedBody.model,
        NEMOTRON_ID,
        `Expected body.model to be '${NEMOTRON_ID}', got '${capturedBody.model}'`,
      );
      assert.ok(
        !capturedBody.model.includes("lightning-ai"),
        `body.model must not contain 'lightning-ai', got '${capturedBody.model}'`,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 4 — OpenRouter endpoint
  // ---------------------------------------------------------------------------
  test("TEST 4: OpenRouter endpoint resolves to https://openrouter.ai/api/v1/chat/completions", () => {
    const endpoint = buildEndpointUrl("https://openrouter.ai/api/v1/", "chat/completions");
    assert.strictEqual(
      endpoint,
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });

  // ---------------------------------------------------------------------------
  // TEST 5 — Trailing slash handling
  // ---------------------------------------------------------------------------
  test("TEST 5: Trailing slash handling produces exactly one /chat/completions", () => {
    const withSlash = buildEndpointUrl("https://openrouter.ai/api/v1/", "chat/completions");
    const withoutSlash = buildEndpointUrl("https://openrouter.ai/api/v1", "chat/completions");
    const withDoubleSlash = buildEndpointUrl("https://openrouter.ai/api/v1//", "/chat/completions");

    assert.strictEqual(withSlash, "https://openrouter.ai/api/v1/chat/completions");
    assert.strictEqual(withoutSlash, "https://openrouter.ai/api/v1/chat/completions");
    assert.strictEqual(withDoubleSlash, "https://openrouter.ai/api/v1/chat/completions");
    assert.ok(
      !withSlash.includes("v1//chat"),
      "Must not produce double slashes in path",
    );
  });

  // ---------------------------------------------------------------------------
  // TEST 6 — Existing OpenRouter models
  // ---------------------------------------------------------------------------
  test("TEST 6: Existing OpenRouter models in MODELS have unchanged API model IDs", () => {
    const existingIds = [
      "deepseek/deepseek-v4.1-flash",
      "deepseek/deepseek-v4-pro",
      "deepseek/deepseek-chat",
      "deepseek/deepseek-r1",
      "qwen/qwen3-coder",
      "qwen/qwen3-coder-plus",
      "qwen/qwen-2.5-72b-instruct",
    ];

    for (const id of existingIds) {
      const resolved = resolveModelId(id);
      assert.strictEqual(resolved, id, `Model '${id}' should resolve to itself unchanged`);
      const entry = getModelByApiId(id);
      assert.ok(entry, `Model '${id}' must exist in registry`);
      assert.strictEqual(entry?.apiModelId, id);
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 7 — Non-OpenRouter regression
  // ---------------------------------------------------------------------------
  test("TEST 7: Non-OpenRouter endpoints retain provider-specific catalog mappings", () => {
    const clientNvidia = new LLMClient({
      baseUrl: "https://integrate.api.nvidia.com/v1/",
      model: NEMOTRON_ID,
      apiKey: "nvapi-test-key",
    });
    // NVIDIA NIM endpoint expects the catalog ID without error
    assert.strictEqual(
      (clientNvidia as any).resolveModelForEndpoint(NEMOTRON_ID, "https://integrate.api.nvidia.com/v1/"),
      "nvidia/nemotron-3-ultra-550b-a55b",
    );

    // DeepSeek official API endpoint expects deepseek-chat
    const clientDeepSeek = new LLMClient({
      baseUrl: "https://api.deepseek.com/v1/",
      model: "deepseek/deepseek-v4.1-flash",
      apiKey: "sk-deepseek-key",
    });
    assert.strictEqual(
      (clientDeepSeek as any).resolveModelForEndpoint("deepseek/deepseek-v4.1-flash", "https://api.deepseek.com/v1/"),
      "deepseek-chat",
    );

    // AWS Bedrock provider retains its configured model identifier
    assert.strictEqual(AWS_BEDROCK_PROVIDER.model, DEFAULT_MODEL_ID);
  });

  // ---------------------------------------------------------------------------
  // TEST 8 — Model switching
  // ---------------------------------------------------------------------------
  test("TEST 8: Model switching default -> Nemotron -> session.setModel() -> request uses exact OpenRouter ID", async () => {
    let capturedModel: string | null = null;
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (async (_url: any, init: any) => {
        if (init?.body) {
          const parsed = JSON.parse(init.body.toString());
          capturedModel = parsed.model;
        }
        return new Response(
          "data: " +
            JSON.stringify({
              id: "gen-2",
              choices: [{ delta: { content: "switched model response" }, finish_reason: "stop" }],
            }) +
            "\n\ndata: [DONE]\n\n",
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      }) as any;

      const client = new LLMClient({
        baseUrl: "https://openrouter.ai/api/v1/",
        model: DEFAULT_MODEL_ID,
        apiKey: MOCK_API_KEY,
      });

      const registry = new ToolRegistry();
      const mockContext: any = {
        workspaceRoot: undefined,
        terminalAutoRun: false,
        autoEdit: false,
        confirm: async () => true,
        resolvePath: async () => undefined,
        toRelative: () => "",
      };

      const session = new ChatSession(
        client,
        registry,
        mockContext,
        "test-workspace",
        false,
        DEFAULT_MODEL_ID,
      );

      assert.strictEqual(client.getModel(), DEFAULT_MODEL_ID);

      // User selects Nemotron via session.setModel()
      session.setModel(NEMOTRON_ID);
      assert.strictEqual(client.getModel(), NEMOTRON_ID);

      await session.send("ping after switch", {
        onAssistantStart: () => {},
        onAssistantDelta: () => {},
        onAssistantDone: () => {},
        onToolStart: () => {},
        onToolEnd: () => {},
        onStatus: () => {},
        onError: () => {},
      });

      assert.strictEqual(
        capturedModel,
        NEMOTRON_ID,
        `Expected request body to use '${NEMOTRON_ID}', got '${capturedModel}'`,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 9 — Authentication
  // ---------------------------------------------------------------------------
  test("TEST 9: Authorization header uses Bearer <API_KEY>", async () => {
    let capturedAuthHeader = "";
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (async (_url: any, init: any) => {
        capturedAuthHeader = String(
          init?.headers?.["Authorization"] || init?.headers?.["authorization"] || "",
        );
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }) as any;

      const client = new LLMClient({
        baseUrl: "https://openrouter.ai/api/v1/",
        model: NEMOTRON_ID,
        apiKey: MOCK_API_KEY,
      });

      const gen = client.stream([{ role: "user", content: "auth test" }]);
      for await (const _ of gen) {
        // consume
      }

      assert.ok(capturedAuthHeader.length > 0, "Authorization header must be present");
      assert.strictEqual(capturedAuthHeader, `Bearer ${MOCK_API_KEY}`);
      assert.ok(capturedAuthHeader.startsWith("Bearer "));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 10 — Streaming
  // ---------------------------------------------------------------------------
  test("TEST 10: Model-ID fix does not break SSE streaming parsing", async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (async () => {
        return new Response(
          "data: " +
            JSON.stringify({
              id: "gen-3",
              choices: [{ delta: { content: "Hello " }, finish_reason: null }],
            }) +
            "\n\n" +
            "data: " +
            JSON.stringify({
              id: "gen-3",
              choices: [{ delta: { content: "world!" }, finish_reason: "stop" }],
            }) +
            "\n\ndata: [DONE]\n\n",
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      }) as any;

      const client = new LLMClient({
        baseUrl: "https://openrouter.ai/api/v1/",
        model: NEMOTRON_ID,
        apiKey: MOCK_API_KEY,
      });

      const chunks: string[] = [];
      const gen = client.stream([{ role: "user", content: "say hello" }]);
      for await (const event of gen) {
        if (event.type === "text") {
          chunks.push(event.delta);
        }
      }

      assert.deepStrictEqual(chunks, ["Hello ", "world!"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 11 — Tool calls
  // ---------------------------------------------------------------------------
  test("TEST 11: OpenRouter requests with tools still use corrected model ID", async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (async (_url: any, init: any) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body.toString());
        }
        return new Response(
          "data: " +
            JSON.stringify({
              id: "gen-4",
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_123",
                        type: "function",
                        function: { name: "test_tool", arguments: "{}" },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            }) +
            "\n\ndata: [DONE]\n\n",
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      }) as any;

      const client = new LLMClient({
        baseUrl: "https://openrouter.ai/api/v1/",
        model: NEMOTRON_ID,
        apiKey: MOCK_API_KEY,
      });

      const toolDefs: ToolDefinition[] = [
        {
          type: "function",
          function: {
            name: "test_tool",
            description: "A tool",
            parameters: { type: "object", properties: {} },
          },
        },
      ];

      const gen = client.stream([{ role: "user", content: "call tool" }], {
        tools: toolDefs,
      });

      for await (const _ of gen) {
        // consume
      }

      assert.ok(capturedBody, "Body captured");
      assert.strictEqual(capturedBody.model, NEMOTRON_ID);
      assert.ok(Array.isArray(capturedBody.tools));
      assert.strictEqual(capturedBody.tools.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---------------------------------------------------------------------------
  // TEST 12 — Invalid model
  // ---------------------------------------------------------------------------
  test("TEST 12: 400 invalid model handling produces expected user-facing error", async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            error: {
              message: "invalid-provider/invalid-model is not a valid model ID",
              code: 400,
            },
          }),
          {
            status: 400,
            statusText: "Bad Request",
            headers: { "Content-Type": "application/json" },
          },
        );
      }) as any;

      const client = new LLMClient({
        baseUrl: "https://openrouter.ai/api/v1/",
        model: "invalid-provider/invalid-model",
        apiKey: MOCK_API_KEY,
      });

      let threw = false;
      try {
        const gen = client.stream([{ role: "user", content: "fail" }]);
        for await (const _ of gen) {
          // consume
        }
      } catch (err: any) {
        threw = true;
        assert.ok(err.message.includes("400 Bad Request"));
        assert.ok(err.message.includes("is not a valid model ID"));
      }

      assert.strictEqual(threw, true, "Expected 400 error to be thrown");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
