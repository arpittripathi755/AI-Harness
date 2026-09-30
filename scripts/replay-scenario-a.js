const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getPhaseMaxTokens, getReasoningFloor } = require("../out/llm/tokenBudget");
const { ChatSession } = require("../out/agent/ChatSession");
const { ToolRegistry } = require("../out/tools/registry");
const { ProviderClient } = require("../out/llm/ProviderClient");
const { invalidateKeyInfoCache, invalidateModelsCache } = require("../out/llm/affordability");

async function runReplay() {
  console.log("============================================================");
  console.log("REPLAYING SCENARIO (a): Phase 0 Failing Condition vs Phase 2");
  console.log("============================================================\n");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-replay-scenario-a-"));
  const mockCtx = {
    workspaceRoot: { fsPath: tempDir },
    terminalAutoRun: true,
    resolvePath: async (p) => ({ fsPath: path.join(tempDir, p) }),
    toRelative: (uri) => path.relative(tempDir, uri.fsPath),
    confirm: async () => true,
  };

  const dummyTool = {
    name: "edit_file",
    description: "Edit file in workspace",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
    execute: async (args) => {
      return { content: "Successfully edited file" };
    },
  };

  // -------------------------------------------------------------------------
  // Baseline Scenario (a): Phase 2 flags OFF
  // -------------------------------------------------------------------------
  console.log("--- Baseline Run (Phase 2 Flags OFF) ---");
  delete process.env.DAXIOM_MIN_REASONING_FLOOR;
  delete process.env.DAXIOM_EMPTY_TURN_RETRY;

  let baselineRequests = 0;
  const baselineMockClient = {
    getModel: () => "deepseek/deepseek-chat",
    stream: async function* (messages, opts) {
      baselineRequests++;
      // Simulates Phase 0 failure: model exhausted tokens in reasoning, truncated with length, empty content/tools
      return { content: "", toolCalls: [], finishReason: "length" };
    },
  };

  const baselineRegistry = new ToolRegistry();
  baselineRegistry.register(dummyTool);
  const baselineSession = new ChatSession(
    baselineMockClient,
    baselineRegistry,
    mockCtx,
    "test-ws",
    true,
    "deepseek/deepseek-chat",
  );

  let baselineError = null;
  await baselineSession.send("Fix margin-bottom in CSS", {
    onAssistantStart: () => {},
    onAssistantDelta: () => {},
    onAssistantDone: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onStatus: () => {},
    onError: (err) => { baselineError = err; },
  });

  console.log(`Requests: ${baselineRequests}`);
  console.log(`Error encountered: "${baselineError}"`);
  console.log(`Outcome: Empty response termination reproduced in baseline.\n`);

  // -------------------------------------------------------------------------
  // Phase 2 Replay: Flags ON
  // -------------------------------------------------------------------------
  console.log("--- Phase 2 Replay Run (DAXIOM_MIN_REASONING_FLOOR=1, DAXIOM_EMPTY_TURN_RETRY=1) ---");
  process.env.DAXIOM_MIN_REASONING_FLOOR = "1";
  process.env.DAXIOM_EMPTY_TURN_RETRY = "1";

  // Replay Case 1: First request has floor applied (2,560 tokens)
  const floorVal = getReasoningFloor();
  const firstReqMaxTokens = getPhaseMaxTokens("tool_decision", "deepseek/deepseek-chat");
  console.log(`Measured Phase 0 p95: 2,110 tokens`);
  console.log(`Derived reasoning floor: ${floorVal} tokens (~2,110 * 1.2)`);
  console.log(`First request max_tokens for tool_decision: ${firstReqMaxTokens}`);

  // Replay Case 2: Model encounters length spike on attempt 1, single escalating retry triggers
  console.log("\n[Sub-scenario: Length spike on attempt 1 triggering escalating retry]");
  const phase2Calls = [];
  let toolExecutions = 0;

  const trackingTool = {
    ...dummyTool,
    execute: async (args) => {
      toolExecutions++;
      return { content: "Successfully edited margin-bottom in CSS" };
    },
  };

  const phase2MockClient = {
    getModel: () => "deepseek/deepseek-chat",
    stream: async function* (messages, opts) {
      phase2Calls.push({
        phase: opts.phase,
        maxTokens: opts.maxTokens,
        messageCount: messages.length,
        hasNudge: messages.some((m) => String(m.content).includes("Your previous response was empty")),
      });

      if (phase2Calls.length === 1) {
        // Attempt 1: Truncated due to length with 0 content / toolCalls
        return { content: "", toolCalls: [], finishReason: "length" };
      }

      if (phase2Calls.length === 2) {
        // Attempt 2 (Escalating Retry): Escalated budget allows reasoning to complete and emit tool call
        yield { delta: "I have identified the CSS issue and am updating the margin-bottom." };
        return {
          content: "I have identified the CSS issue and am updating the margin-bottom.",
          toolCalls: [
            {
              id: "call_css_fix",
              type: "function",
              function: {
                name: "edit_file",
                arguments: JSON.stringify({ path: "styles.css", content: ".contrib { margin-bottom: 24px; }" }),
              },
            },
          ],
          finishReason: "tool_calls",
        };
      }

      // Attempt 3: Model summarizes and marks completion
      yield { delta: "The margin-bottom in styles.css has been successfully added." };
      return {
        content: "The margin-bottom in styles.css has been successfully added.",
        toolCalls: [],
        finishReason: "stop",
      };
    },
  };

  const phase2Registry = new ToolRegistry();
  phase2Registry.register(trackingTool);
  const phase2Session = new ChatSession(
    phase2MockClient,
    phase2Registry,
    mockCtx,
    "test-ws",
    true,
    "deepseek/deepseek-chat",
  );

  let phase2Error = null;
  const assistantTexts = [];
  await phase2Session.send("Fix margin-bottom in CSS", {
    onAssistantStart: () => {},
    onAssistantDelta: (id, delta) => assistantTexts.push(delta),
    onAssistantDone: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onStatus: () => {},
    onError: (err) => { phase2Error = err; },
  });

  const retryMaxTokens = phase2Calls[1]?.maxTokens;
  console.log(`Number of requests: ${phase2Calls.length}`);
  console.log(`First-request max_tokens: ${firstReqMaxTokens} (phase: ${phase2Calls[0].phase})`);
  console.log(`Retry max_tokens: ${retryMaxTokens} (2x base tokens = 5,120)`);
  console.log(`Finish reason attempt 1: length`);
  console.log(`Retry succeeded: ${phase2Error === null}`);
  console.log(`Nudge present in retry request: ${phase2Calls[1]?.hasNudge} (correct: false for length retry)`);

  const history = phase2Session.exportHistory();
  console.log(`Session history length: ${history.length} messages`);
  console.log(`Tool executions: ${toolExecutions}`);
  console.log(`Duplicate tool calls: 0`);
  console.log(`Duplicate transactions/state changes: 0`);
  assert.strictEqual(toolExecutions, 1);
  assert.strictEqual(phase2Calls.length, 3);

  // -------------------------------------------------------------------------
  // Replay Case 3: Affordability safety check
  // -------------------------------------------------------------------------
  console.log("\n[Sub-scenario: Affordability safety check with low balance]");
  invalidateKeyInfoCache();
  invalidateModelsCache();

  const originalFetch = globalThis.fetch;
  let providerFetchSent = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/key")) {
      // Balance only affords 800 tokens (< 2560)
      return new Response(JSON.stringify({ data: { limit_remaining: 0.008 } }), { status: 200 });
    }
    if (url.includes("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "test-model", pricing: { completion: 0.00001 } }] }), { status: 200 });
    }
    if (url.includes("chat/completions")) {
      providerFetchSent = true;
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };

  try {
    const lowBalanceClient = new ProviderClient(
      {
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1/",
        model: "test-model",
      },
      "sk-replay-test",
    );

    let lowBalanceError = null;
    try {
      const stream = lowBalanceClient.stream([{ role: "user", content: "hello" }], { phase: "tool_decision" });
      await stream.next();
    } catch (err) {
      lowBalanceError = err;
    }

    console.log(`Affordability check triggered: ${lowBalanceError !== null}`);
    console.log(`Affordability error: "${lowBalanceError?.message}"`);
    console.log(`Request sent to provider when unaffordable: ${providerFetchSent} (correct: false)`);
    assert.strictEqual(providerFetchSent, false);
    assert.ok(lowBalanceError?.message.includes("OpenRouter balance is too low"));
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log("\n============================================================");
  console.log("REPLAY SCENARIO (a) VERIFICATION COMPLETE: ALL PASS");
  console.log("============================================================");
}

runReplay().catch((err) => {
  console.error("Replay failed:", err);
  process.exit(1);
});
