import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  buildStableSystemPrompt,
  buildSystemPrompt,
  ChatSession,
} from "../agent/ChatSession";
import {
  canonicalJsonStringify,
  canonicalizeToolDefinitions,
  formatDynamicTaskContext,
  isStablePromptPrefixEnabled,
  partitionPrompt,
  PromptPrefixTracker,
} from "../agent/promptPrefix";
import { createToolRegistry, ToolRegistry } from "../tools";
import type { Tool, ToolContext } from "../tools/types";
import type { ChatMessage, ToolDefinition, StreamEvent } from "../llm/types";
import type { StreamOptions } from "../llm/LLMClient";
import { Orchestrator, DEFAULT_BUDGET } from "../agent/Orchestrator";

suite("Phase 4: Cache-Stable Prompt Prefix", () => {
  const sampleSystemPrompt = buildStableSystemPrompt(
    "DeepSeek V4.1 Flash",
    "test-workspace",
    "/workspace",
    true,
    null,
  );

  const registry = createToolRegistry();
  const sampleTools = registry.definitions(true);
  const sampleModel = "deepseek/deepseek-v4.1-flash";

  suite("Cache-Stability Test Matrix (Section 16)", () => {
    test("Test 1: identical consecutive requests produce identical prefixHash", () => {
      const tracker = new PromptPrefixTracker();
      const history: ChatMessage[] = [
        { role: "system", content: sampleSystemPrompt },
        { role: "user", content: "Inspect codebase" },
      ];

      const res1 = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: sampleModel,
        history,
        tracker,
      });

      const res2 = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: sampleModel,
        history,
        tracker,
      });

      assert.strictEqual(res1.stats.prefixHash, res2.stats.prefixHash);
      assert.strictEqual(res1.stablePrefix.serialized, res2.stablePrefix.serialized);
      assert.strictEqual(res1.stats.prefixBytes, res2.stats.prefixBytes);
      assert.strictEqual(res1.stats.prefixEstimatedTokens, res2.stats.prefixEstimatedTokens);
      assert.strictEqual(tracker.statsSummary.hashChanges, 0);
    });

    test("Test 2: changing user message leaves prefixHash unchanged while suffix changes", () => {
      const tracker = new PromptPrefixTracker();
      const history1: ChatMessage[] = [
        { role: "system", content: sampleSystemPrompt },
        { role: "user", content: "Query A: inspect header.ts" },
      ];
      const history2: ChatMessage[] = [
        { role: "system", content: sampleSystemPrompt },
        { role: "user", content: "Query B: inspect footer.ts and navigation.ts" },
      ];

      const res1 = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: sampleModel,
        history: history1,
        tracker,
      });

      const res2 = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: sampleModel,
        history: history2,
        tracker,
      });

      assert.strictEqual(res1.stats.prefixHash, res2.stats.prefixHash);
      assert.notStrictEqual(res1.stats.suffixBytes, res2.stats.suffixBytes);
      assert.strictEqual(tracker.statsSummary.hashChanges, 0);
    });

    test("Test 3: changing tool result leaves prefixHash unchanged while suffix changes", () => {
      const tracker = new PromptPrefixTracker();
      const history1: ChatMessage[] = [
        { role: "system", content: sampleSystemPrompt },
        { role: "user", content: "Run test" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "run_command", arguments: '{"command":"npm test"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "FAIL 1 test failed in math.test.js" },
      ];

      const history2: ChatMessage[] = [
        { role: "system", content: sampleSystemPrompt },
        { role: "user", content: "Run test" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "run_command", arguments: '{"command":"npm test"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "PASS all 24 tests passed" },
      ];

      const res1 = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: sampleModel,
        history: history1,
        dynamicContext: "Task phase: VERIFYING",
        tracker,
      });

      const res2 = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: sampleModel,
        history: history2,
        dynamicContext: "Task phase: EXPLAINING",
        tracker,
      });

      assert.strictEqual(res1.stats.prefixHash, res2.stats.prefixHash);
      assert.strictEqual(tracker.statsSummary.hashChanges, 0);
      assert.notStrictEqual(res1.stats.suffixBytes, res2.stats.suffixBytes);
    });

    test("Test 4: adding another conversation turn preserves stable prefix", () => {
      const tracker = new PromptPrefixTracker();
      const turn1History: ChatMessage[] = [
        { role: "system", content: sampleSystemPrompt },
        { role: "user", content: "Find bug" },
      ];
      const turn2History: ChatMessage[] = [
        ...turn1History,
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"src/calc.ts"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "export function add() {}" },
      ];

      const res1 = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: sampleModel,
        history: turn1History,
        tracker,
      });

      const res2 = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: sampleModel,
        history: turn2History,
        dynamicContext: "Files read: src/calc.ts",
        tracker,
      });

      assert.strictEqual(res1.stats.prefixHash, res2.stats.prefixHash);
      assert.strictEqual(tracker.statsSummary.hashChanges, 0);
      assert.ok(res2.stats.suffixEstimatedTokens > res1.stats.suffixEstimatedTokens);
    });

    test("Test 5: tool registration unchanged yields identical tool schema serialization", () => {
      const canonical1 = canonicalizeToolDefinitions(sampleTools);
      const canonical2 = canonicalizeToolDefinitions(sampleTools);

      assert.strictEqual(
        canonicalJsonStringify(canonical1),
        canonicalJsonStringify(canonical2),
      );
    });

    test("Test 6: tool registration changes invalidate prefixHash with tool_schema reason", () => {
      const tracker = new PromptPrefixTracker();
      const history: ChatMessage[] = [
        { role: "system", content: sampleSystemPrompt },
        { role: "user", content: "Do work" },
      ];

      const res1 = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: sampleModel,
        history,
        tracker,
      });

      // Mode changed to read-only: mutating tools removed
      const planTools = registry.definitions(false);
      const res2 = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: planTools,
        model: sampleModel,
        history,
        tracker,
      });

      assert.notStrictEqual(res1.stats.prefixHash, res2.stats.prefixHash);
      assert.strictEqual(res2.stats.invalidationReason, "tool_schema");
      assert.strictEqual(tracker.statsSummary.hashChanges, 1);
    });

    test("Test 7: system prompt changes invalidate prefixHash with system_prompt reason", () => {
      const tracker = new PromptPrefixTracker();
      const history: ChatMessage[] = [
        { role: "system", content: sampleSystemPrompt },
        { role: "user", content: "Do work" },
      ];

      const res1 = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: sampleModel,
        history,
        tracker,
      });

      // Workspace switched or mode changed
      const newPrompt = buildStableSystemPrompt(
        "DeepSeek V4.1 Flash",
        "another-workspace",
        "/another/path",
        true,
        null,
      );

      const res2 = partitionPrompt({
        stableSystemPrompt: newPrompt,
        tools: sampleTools,
        model: sampleModel,
        history,
        tracker,
      });

      assert.notStrictEqual(res1.stats.prefixHash, res2.stats.prefixHash);
      assert.strictEqual(res2.stats.invalidationReason, "system_prompt");
    });

    test("Test 8: stable region contains no random/timestamp fields", () => {
      const prompt1 = buildStableSystemPrompt("DeepSeek V4.1 Flash", "ws", "/root", true);
      // Wait small tick to ensure if Date.now() was used, time would advance
      const start = Date.now();
      while (Date.now() - start < 10) {}
      const prompt2 = buildStableSystemPrompt("DeepSeek V4.1 Flash", "ws", "/root", true);

      assert.strictEqual(prompt1, prompt2, "Prompt should be byte-identical across timestamps");
      assert.ok(!prompt1.includes(new Date().getFullYear().toString() + "-"), "Prompt should not have live timestamp stamps");
    });

    test("Test 9: feature flag OFF preserves exact legacy request layout", () => {
      const origFlag = process.env.DAXIOM_STABLE_PROMPT_PREFIX;
      try {
        delete process.env.DAXIOM_STABLE_PROMPT_PREFIX;
        delete process.env.DAXIOM_STABLE_CACHE_PREFIX;
        assert.strictEqual(isStablePromptPrefixEnabled(), false);

        const orch = new Orchestrator(DEFAULT_BUDGET);
        const legacyPrompt = buildSystemPrompt(
          "Qwen3 Coder 480B",
          "my-ws",
          "/ws",
          true,
          "Working memory: tested 1 file",
          orch,
        );

        // When flag is off, buildSystemPrompt retains working memory in the system prompt
        assert.ok(legacyPrompt.includes("Working memory: tested 1 file"));
        assert.ok(legacyPrompt.includes("Current task phase: Exploring codebase"));
      } finally {
        if (origFlag !== undefined) {
          process.env.DAXIOM_STABLE_PROMPT_PREFIX = origFlag;
        }
      }
    });

    test("Test 10: serialization determinism across different object key insertion orders", () => {
      const objA = {
        name: "test_tool",
        description: "A test tool",
        parameters: {
          type: "object",
          properties: {
            zebra: { type: "string", description: "Z" },
            apple: { type: "number", description: "A" },
          },
          required: ["apple", "zebra"],
        },
      };

      const objB = {
        parameters: {
          required: ["apple", "zebra"],
          properties: {
            apple: { description: "A", type: "number" },
            zebra: { description: "Z", type: "string" },
          },
          type: "object",
        },
        description: "A test tool",
        name: "test_tool",
      };

      const serializedA = canonicalJsonStringify(objA);
      const serializedB = canonicalJsonStringify(objB);

      assert.strictEqual(serializedA, serializedB);
    });
  });

  suite("Invalidation Reason Tracking (Section 23)", () => {
    test("detects model change invalidation", () => {
      const tracker = new PromptPrefixTracker();
      partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: "deepseek/deepseek-v4.1-flash",
        history: [{ role: "user", content: "hi" }],
        tracker,
      });

      const res = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: "qwen/qwen-2.5-coder-32b-instruct",
        history: [{ role: "user", content: "hi" }],
        tracker,
      });

      assert.strictEqual(res.stats.invalidationReason, "model");
    });

    test("detects provider change invalidation", () => {
      const tracker = new PromptPrefixTracker();
      partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: sampleModel,
        provider: "https://openrouter.ai/api/v1/",
        history: [{ role: "user", content: "hi" }],
        tracker,
      });

      const res = partitionPrompt({
        stableSystemPrompt: sampleSystemPrompt,
        tools: sampleTools,
        model: sampleModel,
        provider: "https://bedrock-runtime.ap-south-1.amazonaws.com/",
        history: [{ role: "user", content: "hi" }],
        tracker,
      });

      assert.strictEqual(res.stats.invalidationReason, "provider");
    });
  });

  suite("Multi-Turn Replay Benchmark (Sections 21, 36)", () => {
    test("runs a 15-request deterministic multi-turn replay and verifies prefix stability rate >= 90%", () => {
      const tracker = new PromptPrefixTracker();
      const history: ChatMessage[] = [
        { role: "system", content: sampleSystemPrompt },
        { role: "user", content: "Fix issue #42 in calculator module" },
      ];

      interface TurnStep {
        assistantCalls?: Array<{ name: string; args: string; id: string }>;
        assistantText?: string;
        toolResults?: Array<{ id: string; name: string; content: string }>;
        dynamicContext?: string;
        isRetry?: boolean;
      }

      const replaySteps: TurnStep[] = [
        // Turn 1: Initial request
        {},
        // Turn 2: list_files call
        {
          assistantCalls: [{ id: "call_1", name: "list_files", args: '{"path":"src"}' }],
          toolResults: [{ id: "call_1", name: "list_files", content: "src/calc.ts\nsrc/index.ts\nsrc/util.ts" }],
          dynamicContext: "Files read: src\nTask phase: Exploring codebase",
        },
        // Turn 3: read_file call
        {
          assistantCalls: [{ id: "call_2", name: "read_file", args: '{"path":"src/calc.ts"}' }],
          toolResults: [{ id: "call_2", name: "read_file", content: "export function add(a, b) { return a - b; }" }],
          dynamicContext: "Files read: src/calc.ts\nTask phase: Exploring codebase",
        },
        // Turn 4: read_file test
        {
          assistantCalls: [{ id: "call_3", name: "read_file", args: '{"path":"test/calc.test.ts"}' }],
          toolResults: [{ id: "call_3", name: "read_file", content: "assert.strictEqual(add(1, 2), 3);" }],
          dynamicContext: "Files read: test/calc.test.ts\nTask phase: Exploring codebase",
        },
        // Turn 5: edit_file call
        {
          assistantCalls: [{ id: "call_4", name: "edit_file", args: '{"path":"src/calc.ts","edits":[{"oldString":"return a - b;","newString":"return a + b;"}]}' }],
          toolResults: [{ id: "call_4", name: "edit_file", content: "Edited src/calc.ts (staged in memory)" }],
          dynamicContext: "Files modified: src/calc.ts\nTask phase: EDITING",
        },
        // Turn 6: run_command verification (Phase 3 command digest)
        {
          assistantCalls: [{ id: "call_5", name: "run_command", args: '{"command":"npm test"}' }],
          toolResults: [{ id: "call_5", name: "run_command", content: "[Command Digest] Exit code: 0\nAll 12 tests passed (ran against staged edits)" }],
          dynamicContext: "Files modified: src/calc.ts\nLast test: passed\nTask phase: VERIFYING",
        },
        // Turn 7: model-facing retry turn (empty output / length)
        {
          isRetry: true,
          dynamicContext: "Files modified: src/calc.ts\nTask phase: VERIFYING",
        },
        // Turn 8: multi_edit call
        {
          assistantCalls: [{ id: "call_6", name: "multi_edit", args: '{"path":"src/calc.ts","changes":[]}' }],
          toolResults: [{ id: "call_6", name: "multi_edit", content: "No-op multi edit" }],
          dynamicContext: "Files modified: src/calc.ts\nTask phase: EDITING",
        },
        // Turn 9: read_file verification
        {
          assistantCalls: [{ id: "call_7", name: "read_file", args: '{"path":"src/calc.ts"}' }],
          toolResults: [{ id: "call_7", name: "read_file", content: "export function add(a, b) { return a + b; }" }],
          dynamicContext: "Task phase: VERIFYING",
        },
        // Turn 10: run_command second check
        {
          assistantCalls: [{ id: "call_8", name: "run_command", args: '{"command":"npm run lint"}' }],
          toolResults: [{ id: "call_8", name: "run_command", content: "[Command Digest] Exit code: 0\nLint clean" }],
          dynamicContext: "Task phase: VERIFYING",
        },
        // Turn 11: git status inspection
        {
          assistantCalls: [{ id: "call_9", name: "run_command", args: '{"command":"git status --short"}' }],
          toolResults: [{ id: "call_9", name: "run_command", content: "M src/calc.ts" }],
          dynamicContext: "Task phase: VERIFYING",
        },
        // Turn 12: read active editor
        {
          assistantCalls: [{ id: "call_10", name: "read_active_editor", args: "{}" }],
          toolResults: [{ id: "call_10", name: "read_active_editor", content: "Active editor: src/calc.ts" }],
          dynamicContext: "Task phase: VERIFYING",
        },
        // Turn 13: check diagnostics
        {
          assistantCalls: [{ id: "call_11", name: "run_command", args: '{"command":"npx tsc --noEmit"}' }],
          toolResults: [{ id: "call_11", name: "run_command", content: "[Command Digest] Exit code: 0\nTypeScript clean" }],
          dynamicContext: "Task phase: VERIFYING",
        },
        // Turn 14: wrap up explanation
        {
          assistantText: "The issue has been resolved. The add function in src/calc.ts now correctly returns a + b.",
          dynamicContext: "Task phase: EXPLAINING",
        },
        // Turn 15: final confirmation turn
        {
          assistantText: "All tests pass. Ready for review.",
          dynamicContext: "Task phase: EXPLAINING",
        },
      ];

      const records: Array<{
        req: number;
        prefixHash: string;
        prefixBytes: number;
        prefixTokens: number;
        suffixBytes: number;
        suffixTokens: number;
        totalTokens: number;
      }> = [];

      for (let i = 0; i < replaySteps.length; i++) {
        const step = replaySteps[i];

        if (step.assistantCalls) {
          history.push({
            role: "assistant",
            content: null,
            tool_calls: step.assistantCalls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: c.args },
            })),
          });
        } else if (step.assistantText) {
          history.push({
            role: "assistant",
            content: step.assistantText,
          });
        }

        if (step.toolResults) {
          for (const tr of step.toolResults) {
            history.push({
              role: "tool",
              tool_call_id: tr.id,
              content: tr.content,
            });
          }
        }

        const partition = partitionPrompt({
          stableSystemPrompt: sampleSystemPrompt,
          tools: sampleTools,
          model: sampleModel,
          history,
          dynamicContext: step.dynamicContext,
          tracker,
        });

        records.push({
          req: i + 1,
          prefixHash: partition.stats.prefixHash,
          prefixBytes: partition.stats.prefixBytes,
          prefixTokens: partition.stats.prefixEstimatedTokens,
          suffixBytes: partition.stats.suffixBytes,
          suffixTokens: partition.stats.suffixEstimatedTokens,
          totalTokens: partition.stats.totalEstimatedTokens,
        });
      }

      assert.strictEqual(records.length, 15);

      // Verify that across all 15 requests, the prefixHash never changed!
      const initialHash = records[0].prefixHash;
      for (let i = 1; i < records.length; i++) {
        assert.strictEqual(
          records[i].prefixHash,
          initialHash,
          `Request ${i + 1} prefixHash must match initial request`,
        );
        assert.strictEqual(
          records[i].prefixBytes,
          records[0].prefixBytes,
          `Request ${i + 1} prefixBytes must match initial request`,
        );
        assert.strictEqual(
          records[i].prefixTokens,
          records[0].prefixTokens,
          `Request ${i + 1} prefixTokens must match initial request`,
        );
      }

      // Prefix stability: 15 requests, 0 hash changes -> 100% stability!
      assert.strictEqual(tracker.statsSummary.totalRequests, 15);
      assert.strictEqual(tracker.statsSummary.hashChanges, 0);
      assert.strictEqual(tracker.statsSummary.stabilityRate, 100);

      // Verify suffix grew as history accumulated
      assert.ok(
        records[14].suffixTokens > records[0].suffixTokens,
        `Final request suffix (${records[14].suffixTokens} tokens) should exceed turn 1 suffix (${records[0].suffixTokens} tokens)`,
      );
    });
  });

  suite("ChatSession End-to-End Integration", () => {
    const originalFlag = process.env.DAXIOM_STABLE_PROMPT_PREFIX;

    teardown(() => {
      if (originalFlag !== undefined) {
        process.env.DAXIOM_STABLE_PROMPT_PREFIX = originalFlag;
      } else {
        delete process.env.DAXIOM_STABLE_PROMPT_PREFIX;
      }
    });

    function makeMockToolContext(tempDir: string): ToolContext {
      return {
        workspaceRoot: { fsPath: tempDir } as vscode.Uri,
        terminalAutoRun: true,
        resolvePath: async (p: string) => ({ fsPath: path.join(tempDir, p) } as vscode.Uri),
        toRelative: (uri: vscode.Uri) => path.relative(tempDir, uri.fsPath),
        confirm: async () => true,
      };
    }

    function makeCallbacks() {
      return {
        onAssistantStart: () => {},
        onAssistantDelta: () => {},
        onAssistantDone: () => {},
        onToolStart: () => {},
        onToolEnd: () => {},
        onStatus: () => {},
        onError: () => {},
      };
    }

    test("ChatSession with DAXIOM_STABLE_PROMPT_PREFIX=1 keeps system message byte-identical and moves task context to ephemeral tail", async () => {
      process.env.DAXIOM_STABLE_PROMPT_PREFIX = "1";
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-phase4-"));

      const streamCalls: Array<{ messages: ChatMessage[]; opts: StreamOptions }> = [];
      let callIndex = 0;

      const mockClient = {
        getModel: () => "test-model",
        getBaseUrl: () => "https://openrouter.ai/api/v1/",
        stream: async function* (messages: ChatMessage[], opts: StreamOptions) {
          streamCalls.push({ messages: [...messages], opts: { ...opts } });
          callIndex++;

          if (callIndex === 1) {
            // First turn: assistant calls inspect_tool
            return {
              content: null,
              toolCalls: [
                {
                  id: "call_1",
                  type: "function" as const,
                  function: { name: "inspect_tool", arguments: "{}" },
                },
              ],
              finishReason: "tool_calls",
            };
          } else if (callIndex === 2) {
            // Second turn: assistant calls inspect_tool again
            return {
              content: null,
              toolCalls: [
                {
                  id: "call_2",
                  type: "function" as const,
                  function: { name: "inspect_tool", arguments: "{}" },
                },
              ],
              finishReason: "tool_calls",
            };
          } else {
            // Third turn: final explanation
            yield { delta: "Done" } as StreamEvent;
            return {
              content: "Done",
              toolCalls: [],
              finishReason: "stop",
            };
          }
        },
      };

      const registry = new ToolRegistry();
      registry.register({
        name: "inspect_tool",
        description: "Test read-only tool",
        mutates: false,
        parameters: { type: "object", properties: {} },
        execute: async () => ({ ok: true, summary: "inspected", content: "data: ok" }),
      });

      const session = new ChatSession(
        mockClient as any,
        registry,
        makeMockToolContext(tempDir),
        "test-ws",
        true,
        "test-model",
      );

      await session.send("Analyze workspace", makeCallbacks());

      assert.strictEqual(streamCalls.length, 3, "Expected 3 stream calls across the 2 tool iterations");

      // Verify that across all 3 turns, the system message (index 0) was 100% byte-for-byte identical!
      const sysMsg0 = streamCalls[0].messages[0].content;
      const sysMsg1 = streamCalls[1].messages[0].content;
      const sysMsg2 = streamCalls[2].messages[0].content;
      assert.strictEqual(sysMsg0, sysMsg1, "Turn 1 and Turn 2 system prompts must be byte-identical");
      assert.strictEqual(sysMsg1, sysMsg2, "Turn 2 and Turn 3 system prompts must be byte-identical");

      // Verify that Turn 2 and Turn 3 received ephemeral [CURRENT TASK CONTEXT] at the tail
      const turn2Tail = streamCalls[1].messages[streamCalls[1].messages.length - 1];
      assert.strictEqual(turn2Tail.role, "user");
      assert.ok(
        typeof turn2Tail.content === "string" && turn2Tail.content.includes("[CURRENT TASK CONTEXT]"),
        "Turn 2 tail message must contain ephemeral task context",
      );

      const turn3Tail = streamCalls[2].messages[streamCalls[2].messages.length - 1];
      assert.strictEqual(turn3Tail.role, "user");
      assert.ok(
        typeof turn3Tail.content === "string" && turn3Tail.content.includes("[CURRENT TASK CONTEXT]"),
        "Turn 3 tail message must contain ephemeral task context",
      );

      // Verify history persistence: ephemeral tail message is NOT stored in history!
      const history = session.exportHistory();
      for (const msg of history) {
        if (typeof msg.content === "string") {
          assert.ok(
            !msg.content.includes("[CURRENT TASK CONTEXT]"),
            "Ephemeral context message must NEVER be persisted in history",
          );
        }
      }

      // Verify tracker stats: 3 requests, 0 prefix hash changes (100% prefix stability)
      assert.strictEqual(session.stablePrefixTracker.statsSummary.totalRequests, 3);
      assert.strictEqual(session.stablePrefixTracker.statsSummary.hashChanges, 0);
      assert.strictEqual(session.stablePrefixTracker.statsSummary.stabilityRate, 100);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test("ChatSession with flag OFF retains legacy behavior without ephemeral tail message", async () => {
      delete process.env.DAXIOM_STABLE_PROMPT_PREFIX;
      delete process.env.DAXIOM_STABLE_CACHE_PREFIX;
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-phase4-legacy-"));

      const streamCalls: Array<{ messages: ChatMessage[]; opts: StreamOptions }> = [];
      let callIndex = 0;

      const mockClient = {
        getModel: () => "test-model",
        getBaseUrl: () => "https://openrouter.ai/api/v1/",
        stream: async function* (messages: ChatMessage[], opts: StreamOptions) {
          streamCalls.push({ messages: [...messages], opts: { ...opts } });
          callIndex++;

          if (callIndex === 1) {
            return {
              content: null,
              toolCalls: [
                {
                  id: "call_1",
                  type: "function" as const,
                  function: { name: "inspect_tool", arguments: "{}" },
                },
              ],
              finishReason: "tool_calls",
            };
          } else {
            yield { delta: "Done legacy" } as StreamEvent;
            return {
              content: "Done legacy",
              toolCalls: [],
              finishReason: "stop",
            };
          }
        },
      };

      const registry = new ToolRegistry();
      registry.register({
        name: "inspect_tool",
        description: "Test read-only tool",
        mutates: false,
        parameters: { type: "object", properties: {} },
        execute: async () => ({ ok: true, summary: "inspected", content: "data: ok" }),
      });

      const session = new ChatSession(
        mockClient as any,
        registry,
        makeMockToolContext(tempDir),
        "test-ws",
        true,
        "test-model",
      );

      await session.send("Analyze workspace legacy", makeCallbacks());

      assert.strictEqual(streamCalls.length, 2);

      // In legacy mode, system prompt is updated with working memory in messages[0]
      const sys0 = streamCalls[0].messages[0].content as string;
      const sys1 = streamCalls[1].messages[0].content as string;
      // Turn 2 system prompt contains the recorded tool execution in messages[0]
      assert.notStrictEqual(sys0, sys1, "In legacy mode, system prompt mutates across turns");

      // No ephemeral user message at the tail
      const turn2Tail = streamCalls[1].messages[streamCalls[1].messages.length - 1];
      assert.strictEqual(turn2Tail.role, "tool", "In legacy mode, last message is the tool result, not ephemeral user");

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
