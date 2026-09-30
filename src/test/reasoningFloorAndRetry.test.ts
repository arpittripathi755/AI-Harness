import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  DERIVED_REASONING_FLOOR,
  getReasoningFloor,
  getPhaseMaxTokens,
} from "../llm/tokenBudget";
import { ProviderClient } from "../llm/ProviderClient";
import { invalidateKeyInfoCache, invalidateModelsCache } from "../llm/affordability";
import { ChatSession } from "../agent/ChatSession";
import { ToolRegistry } from "../tools/registry";
import type { Tool, ToolContext } from "../tools/types";
import type { ChatMessage, StreamEvent } from "../llm/types";
import type { StreamOptions } from "../llm/LLMClient";

suite("Phase 2: Reasoning-safe Output Floor and Single Escalating Retry", () => {
  const originalFloorEnv = process.env.DAXIOM_MIN_REASONING_FLOOR;
  const originalRetryEnv = process.env.DAXIOM_EMPTY_TURN_RETRY;
  const originalMaxTokens = process.env.MAX_TOKENS;
  const originalAiMaxTokens = process.env.AI_MAX_TOKENS;

  setup(() => {
    invalidateKeyInfoCache();
    invalidateModelsCache();
  });

  teardown(() => {
    invalidateKeyInfoCache();
    invalidateModelsCache();
    if (originalFloorEnv !== undefined) {
      process.env.DAXIOM_MIN_REASONING_FLOOR = originalFloorEnv;
    } else {
      delete process.env.DAXIOM_MIN_REASONING_FLOOR;
    }

    if (originalRetryEnv !== undefined) {
      process.env.DAXIOM_EMPTY_TURN_RETRY = originalRetryEnv;
    } else {
      delete process.env.DAXIOM_EMPTY_TURN_RETRY;
    }

    if (originalMaxTokens !== undefined) {
      process.env.MAX_TOKENS = originalMaxTokens;
    } else {
      delete process.env.MAX_TOKENS;
    }

    if (originalAiMaxTokens !== undefined) {
      process.env.AI_MAX_TOKENS = originalAiMaxTokens;
    } else {
      delete process.env.AI_MAX_TOKENS;
    }
  });

  // =========================================================================
  // 1. Floor configuration & tokenBudget unit tests
  // =========================================================================

  test("1. Floor is disabled (0) by default or when set to '0' / 'false'", () => {
    delete process.env.DAXIOM_MIN_REASONING_FLOOR;
    assert.strictEqual(getReasoningFloor(), 0);

    process.env.DAXIOM_MIN_REASONING_FLOOR = "0";
    assert.strictEqual(getReasoningFloor(), 0);

    process.env.DAXIOM_MIN_REASONING_FLOOR = "false";
    assert.strictEqual(getReasoningFloor(), 0);
  });

  test("2. Floor defaults to DERIVED_REASONING_FLOOR (2560) when enabled with '1' or 'true'", () => {
    assert.strictEqual(DERIVED_REASONING_FLOOR, 2560);

    process.env.DAXIOM_MIN_REASONING_FLOOR = "1";
    assert.strictEqual(getReasoningFloor(), 2560);

    process.env.DAXIOM_MIN_REASONING_FLOOR = "true";
    assert.strictEqual(getReasoningFloor(), 2560);
  });

  test("3. Floor supports custom positive integer configuration", () => {
    process.env.DAXIOM_MIN_REASONING_FLOOR = "3000";
    assert.strictEqual(getReasoningFloor(), 3000);

    process.env.DAXIOM_MIN_REASONING_FLOOR = "1800";
    assert.strictEqual(getReasoningFloor(), 1800);
  });

  test("4. getPhaseMaxTokens applies floor to tool_decision and edit phases, but not explain/plan", () => {
    delete process.env.MAX_TOKENS;
    delete process.env.AI_MAX_TOKENS;
    process.env.DAXIOM_MIN_REASONING_FLOOR = "2560";

    // tool_decision phase default is 2048; with floor 2560 it becomes 2560
    assert.strictEqual(getPhaseMaxTokens("tool_decision", "openrouter/auto"), 2560);

    // edit phase default is 4096; max(4096, 2560) is 4096
    assert.strictEqual(getPhaseMaxTokens("edit", "openrouter/auto"), 4096);

    // explain phase default is 2048; floor does not apply to explain
    assert.strictEqual(getPhaseMaxTokens("explain", "openrouter/auto"), 2048);

    // plan phase default is 2048; floor does not apply to plan
    assert.strictEqual(getPhaseMaxTokens("plan", "openrouter/auto"), 2048);
  });

  test("5. Hard ceiling (MAX_TOKENS) caps the floor if set lower", () => {
    process.env.DAXIOM_MIN_REASONING_FLOOR = "2560";
    process.env.MAX_TOKENS = "2200";

    assert.strictEqual(getPhaseMaxTokens("tool_decision", "openrouter/auto"), 2200);
  });

  // =========================================================================
  // 2. ProviderClient floor & affordability integration tests
  // =========================================================================

  test("6. Affordability: throws error and sends no request if floor cannot be safely afforded", async () => {
    process.env.DAXIOM_MIN_REASONING_FLOOR = "2560";

    const originalFetch = globalThis.fetch;
    let requestSent = false;

    // Simulate key that can afford only 900 tokens
    // price = $0.00001, limitRemaining = $0.01 -> affordable = floor(0.01 * 0.9 / 0.00001) = 900 tokens < 2560
    globalThis.fetch = (async (input: any, init?: any): Promise<Response> => {
      const url = String(input);
      if (url.includes("/key")) {
        return new Response(JSON.stringify({ data: { limit_remaining: 0.01 } }), { status: 200 });
      }
      if (url.includes("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "test-model", pricing: { completion: 0.00001 } }] }), { status: 200 });
      }
      if (url.includes("chat/completions")) {
        requestSent = true;
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      const client = new ProviderClient(
        {
          name: "OpenRouter",
          baseUrl: "https://openrouter.ai/api/v1/",
          model: "test-model",
        },
        "sk-test",
      );

      let caughtError: Error | undefined;
      try {
        const stream = client.stream([{ role: "user", content: "hello" }], { phase: "tool_decision" });
        await stream.next();
      } catch (err: any) {
        caughtError = err;
      }

      assert.ok(caughtError, "Expected affordability error to be thrown");
      assert.ok(
        caughtError.message.includes("OpenRouter balance is too low"),
        `Unexpected error message: ${caughtError?.message}`,
      );
      assert.ok(
        caughtError.message.includes("minimum required for reasoning is 2560"),
        `Error did not mention reasoning floor: ${caughtError?.message}`,
      );
      assert.strictEqual(requestSent, false, "Request must not be sent if floor is unaffordable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("7. Reservation clamp does not lower max_tokens below reasoning floor when balance affords it", async () => {
    process.env.DAXIOM_MIN_REASONING_FLOOR = "2560";

    const originalFetch = globalThis.fetch;
    let interceptedMaxTokens: number | undefined;

    // Simulate key that can afford 5,000 tokens:
    // limitRemaining = $0.05, completion price = $0.00001 -> affordable = 4,500 tokens (> 2560)
    // 50% reservation fraction gives 2,500 tokens (which without our fix would clamp below 2560)
    globalThis.fetch = (async (input: any, init?: any): Promise<Response> => {
      const url = String(input);
      if (url.includes("/key")) {
        return new Response(JSON.stringify({ data: { limit_remaining: 0.05 } }), { status: 200 });
      }
      if (url.includes("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "test-model", pricing: { completion: 0.00001 } }] }), { status: 200 });
      }
      if (url.includes("chat/completions")) {
        const body = JSON.parse(String(init?.body));
        interceptedMaxTokens = body.max_tokens;
        // Return dummy SSE stream
        const sse = "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      const client = new ProviderClient(
        {
          name: "OpenRouter",
          baseUrl: "https://openrouter.ai/api/v1/",
          model: "test-model",
        },
        "sk-test-7",
      );

      const stream = client.stream([{ role: "user", content: "hello" }], { phase: "tool_decision" });
      await stream.next();
      assert.strictEqual(interceptedMaxTokens, 2560, "max_tokens must respect the 2560 reasoning floor");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // =========================================================================
  // 3. ChatSession single escalating retry tests
  // =========================================================================

  function makeMockToolContext(tempDir: string): ToolContext {
    return {
      workspaceRoot: { fsPath: tempDir } as vscode.Uri,
      terminalAutoRun: true,
      resolvePath: async (p: string) => ({ fsPath: path.join(tempDir, p) } as vscode.Uri),
      toRelative: (uri: vscode.Uri) => path.relative(tempDir, uri.fsPath),
      confirm: async () => true,
    };
  }

  function makeCallbacks(collectedOutputs: {
    starts: string[];
    deltas: string[];
    dones: string[];
    errors: string[];
    statuses: string[];
  }) {
    return {
      onAssistantStart: (id: string) => collectedOutputs.starts.push(id),
      onAssistantDelta: (id: string, delta: string) => collectedOutputs.deltas.push(delta),
      onAssistantDone: (id: string) => collectedOutputs.dones.push(id),
      onToolStart: () => {},
      onToolEnd: () => {},
      onStatus: (status: string) => collectedOutputs.statuses.push(status),
      onError: (err: string) => collectedOutputs.errors.push(err),
    };
  }

  test("8. Retry disabled by default: empty response terminates with error without retrying", async () => {
    delete process.env.DAXIOM_EMPTY_TURN_RETRY;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-phase2-"));

    let streamCallCount = 0;
    const mockClient = {
      getModel: () => "test-model",
      stream: async function* () {
        streamCallCount++;
        return { content: "", toolCalls: [], finishReason: "length" };
      },
    };

    const registry = new ToolRegistry();
    const session = new ChatSession(
      mockClient as any,
      registry,
      makeMockToolContext(tempDir),
      "test-ws",
      true,
      "test-model",
    );

    const outputs = { starts: [], deltas: [], dones: [], errors: [], statuses: [] };
    await session.send("test prompt", makeCallbacks(outputs));

    assert.strictEqual(streamCallCount, 1, "Must call stream exactly once when retry flag is OFF");
    assert.ok(outputs.errors.some((e: string) => e.includes("empty response")));
    assert.strictEqual(session.exportHistory().length, 1, "Only initial user message should remain in history");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("9. Retry on finish_reason == 'length': retries once with escalated max_tokens and no nudge", async () => {
    process.env.DAXIOM_EMPTY_TURN_RETRY = "1";
    process.env.DAXIOM_MIN_REASONING_FLOOR = "2560";
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-phase2-"));

    const streamCalls: { messages: ChatMessage[]; opts: StreamOptions }[] = [];
    const mockClient = {
      getModel: () => "test-model",
      stream: async function* (messages: ChatMessage[], opts: StreamOptions) {
        streamCalls.push({ messages: [...messages], opts: { ...opts } });
        if (streamCalls.length === 1) {
          // First attempt returns empty with length truncation
          return { content: "", toolCalls: [], finishReason: "length" };
        }
        // Second attempt succeeds with answer
        yield { delta: "Success after retry" } as StreamEvent;
        return { content: "Success after retry", toolCalls: [], finishReason: "stop" };
      },
    };

    const registry = new ToolRegistry();
    registry.register({
      name: "dummy_tool",
      description: "Dummy",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: "done" }),
    });
    const session = new ChatSession(
      mockClient as any,
      registry,
      makeMockToolContext(tempDir),
      "test-ws",
      true,
      "test-model",
    );

    const outputs = { starts: [], deltas: [], dones: [], errors: [], statuses: [] };
    await session.send("Fix the issue", makeCallbacks(outputs));

    assert.strictEqual(streamCalls.length, 2, "Expected exactly one initial request and one retry request");

    // First request: standard phase tokens (with floor 2560)
    assert.strictEqual(streamCalls[0].opts.phase, "tool_decision");
    assert.strictEqual(streamCalls[0].opts.maxTokens, undefined);

    // Second request: escalated maxTokens (2560 * 2 = 5120)
    assert.strictEqual(streamCalls[1].opts.maxTokens, 5120);

    // Verify messages sent on retry: NO nudge added for length retry
    const retryUserMsgs = streamCalls[1].messages.filter((m) => m.role === "user");
    assert.strictEqual(retryUserMsgs.length, 1);
    assert.strictEqual(retryUserMsgs[0].content, "Fix the issue");

    // Verify history stored: only the initial user message and the successful assistant reply
    const history = session.exportHistory();
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].role, "user");
    assert.strictEqual(history[0].content, "Fix the issue");
    assert.strictEqual(history[1].role, "assistant");
    assert.strictEqual(history[1].content, "Success after retry");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("10. Retry on non-length empty turn: retries with transient nudge and never persists nudge in history", async () => {
    process.env.DAXIOM_EMPTY_TURN_RETRY = "1";
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-phase2-"));

    const streamCalls: { messages: ChatMessage[]; opts: StreamOptions }[] = [];
    const mockClient = {
      getModel: () => "test-model",
      stream: async function* (messages: ChatMessage[], opts: StreamOptions) {
        streamCalls.push({ messages: [...messages], opts: { ...opts } });
        if (streamCalls.length === 1) {
          // Empty turn with stop (no tool calls, no content)
          return { content: "", toolCalls: [], finishReason: "stop" };
        }
        // Retry succeeds
        yield { delta: "Now responding" } as StreamEvent;
        return { content: "Now responding", toolCalls: [], finishReason: "stop" };
      },
    };

    const registry = new ToolRegistry();
    const session = new ChatSession(
      mockClient as any,
      registry,
      makeMockToolContext(tempDir),
      "test-ws",
      true,
      "test-model",
    );

    const outputs = { starts: [], deltas: [], dones: [], errors: [], statuses: [] };
    await session.send("Do something", makeCallbacks(outputs));

    assert.strictEqual(streamCalls.length, 2, "Expected exactly 2 requests");

    // The second request must contain the transient nudge
    const retryMsgs = streamCalls[1].messages;
    const lastRetryMsg = retryMsgs[retryMsgs.length - 1];
    assert.strictEqual(lastRetryMsg.role, "user");
    assert.ok(
      String(lastRetryMsg.content).includes("Your previous response was empty"),
      "Transient nudge must be sent in retry request",
    );

    // CRITICAL: Verify transient nudge was NEVER persisted to history
    const sessionMessages = session.exportHistory();
    assert.strictEqual(sessionMessages.length, 2);
    assert.strictEqual(sessionMessages[0].content, "Do something");
    assert.strictEqual(sessionMessages[1].content, "Now responding");
    for (const msg of sessionMessages) {
      if (typeof msg.content === "string") {
        assert.ok(!msg.content.includes("Your previous response was empty"), "Nudge must not be in session messages");
      }
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("11. Retry fails if second attempt is also empty: exactly 2 requests, no infinite loop", async () => {
    process.env.DAXIOM_EMPTY_TURN_RETRY = "1";
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-phase2-"));

    let streamCallCount = 0;
    const mockClient = {
      getModel: () => "test-model",
      stream: async function* () {
        streamCallCount++;
        return { content: "", toolCalls: [], finishReason: "length" };
      },
    };

    const registry = new ToolRegistry();
    const session = new ChatSession(
      mockClient as any,
      registry,
      makeMockToolContext(tempDir),
      "test-ws",
      true,
      "test-model",
    );

    const outputs = { starts: [], deltas: [], dones: [], errors: [], statuses: [] };
    await session.send("Do work", makeCallbacks(outputs));

    assert.strictEqual(streamCallCount, 2, "Must stop after exactly 1 retry (2 total calls)");
    assert.ok(outputs.errors.some((e: string) => e.includes("empty response")));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("12. Retry with tool calls: executes tool calls and records state exactly once", async () => {
    process.env.DAXIOM_EMPTY_TURN_RETRY = "1";
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-phase2-"));

    let toolExecutions = 0;
    const dummyTool: Tool = {
      name: "custom_write",
      description: "Write",
      parameters: { type: "object", properties: { text: { type: "string" } } },
      execute: async (args) => {
        toolExecutions++;
        return { content: `Wrote: ${args.text}` };
      },
    };
    const registry = new ToolRegistry();
    registry.register(dummyTool);

    let streamCallCount = 0;
    const mockClient = {
      getModel: () => "test-model",
      stream: async function* () {
        streamCallCount++;
        if (streamCallCount === 1) {
          // Attempt 1: empty
          return { content: "", toolCalls: [], finishReason: "length" };
        }
        if (streamCallCount === 2) {
          // Attempt 2: tool call
          return {
            content: "Calling tool",
            toolCalls: [
              {
                id: "call_abc",
                type: "function" as const,
                function: { name: "custom_write", arguments: JSON.stringify({ text: "sample" }) },
              },
            ],
            finishReason: "tool_calls",
          };
        }
        // Final completion after tool result
        return { content: "Done!", toolCalls: [], finishReason: "stop" };
      },
    };

    const session = new ChatSession(
      mockClient as any,
      registry,
      makeMockToolContext(tempDir),
      "test-ws",
      true,
      "test-model",
    );

    const outputs = { starts: [], deltas: [], dones: [], errors: [], statuses: [] };
    await session.send("Run tool", makeCallbacks(outputs));

    assert.strictEqual(toolExecutions, 1, "Tool call must be executed exactly once, no duplicates");
    assert.strictEqual(streamCallCount, 3, "Expected 1 failed turn + 1 retry turn + 1 turn after tool execution = 3 calls");

    const history = session.exportHistory();
    // 0: user message
    // 1: assistant tool call
    // 2: tool result
    // 3: final assistant message
    assert.strictEqual(history.length, 4);
    assert.strictEqual(history[1].role, "assistant");
    assert.strictEqual(history[1].tool_calls?.length, 1);
    assert.strictEqual(history[2].role, "tool");
    assert.strictEqual(history[3].role, "assistant");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
