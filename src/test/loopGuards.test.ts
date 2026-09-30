import * as assert from "assert";
import * as vscode from "vscode";
import {
  ChatSession,
  DEFAULT_MAX_TOOL_TURNS,
  getMaxToolTurns,
  canonicalizeToolCallKey,
  isReadOnlyTool,
} from "../agent/ChatSession";
import { ToolRegistry } from "../tools/registry";
import type { Tool, ToolContext, ToolResult } from "../tools/types";
import type { AssistantTurn, ChatMessage, StreamEvent } from "../llm/types";

suite("Loop Guards & Duplicate Tool Caching (Phase 6)", () => {
  const originalEnvMaxTurns = process.env.MAX_TOOL_TURNS;

  teardown(() => {
    if (originalEnvMaxTurns !== undefined) {
      process.env.MAX_TOOL_TURNS = originalEnvMaxTurns;
    } else {
      delete process.env.MAX_TOOL_TURNS;
    }
  });

  suite("getMaxToolTurns", () => {
    test("returns DEFAULT_MAX_TOOL_TURNS (25) when unset", () => {
      delete process.env.MAX_TOOL_TURNS;
      assert.strictEqual(getMaxToolTurns(), DEFAULT_MAX_TOOL_TURNS);
      assert.strictEqual(DEFAULT_MAX_TOOL_TURNS, 25);
    });

    test("reads valid integer from environment", () => {
      process.env.MAX_TOOL_TURNS = "10";
      assert.strictEqual(getMaxToolTurns(), 10);
      process.env.MAX_TOOL_TURNS = "42";
      assert.strictEqual(getMaxToolTurns(), 42);
    });

    test("falls back on invalid, zero, or negative values", () => {
      process.env.MAX_TOOL_TURNS = "abc";
      assert.strictEqual(getMaxToolTurns(), 25);
      process.env.MAX_TOOL_TURNS = "0";
      assert.strictEqual(getMaxToolTurns(), 25);
      process.env.MAX_TOOL_TURNS = "-5";
      assert.strictEqual(getMaxToolTurns(), 25);
      process.env.MAX_TOOL_TURNS = "12.34";
      assert.strictEqual(getMaxToolTurns(), 25);
    });
  });

  suite("canonicalizeToolCallKey", () => {
    test("produces identical key regardless of key order", () => {
      const k1 = canonicalizeToolCallKey("read_file", { path: "a.ts", line: 10 });
      const k2 = canonicalizeToolCallKey("read_file", { line: 10, path: "a.ts" });
      assert.strictEqual(k1, k2);
    });

    test("handles nested objects with different key order", () => {
      const k1 = canonicalizeToolCallKey("search", {
        opts: { regex: true, caseSensitive: false },
        query: "foo",
      });
      const k2 = canonicalizeToolCallKey("search", {
        query: "foo",
        opts: { caseSensitive: false, regex: true },
      });
      assert.strictEqual(k1, k2);
    });
  });

  suite("isReadOnlyTool", () => {
    test("identifies read-only tools correctly", () => {
      const readTool: Tool = {
        name: "read_file",
        description: "Read",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: "data" }),
      };
      assert.strictEqual(isReadOnlyTool("read_file", readTool), true);

      const listTool: Tool = {
        name: "list_files",
        description: "List",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: "files" }),
      };
      assert.strictEqual(isReadOnlyTool("list_files", listTool), true);
    });

    test("identifies mutating and side-effect tools as not read-only", () => {
      const runCmdTool: Tool = {
        name: "run_command",
        mutates: true,
        description: "Run shell",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: "ok" }),
      };
      assert.strictEqual(isReadOnlyTool("run_command", runCmdTool), false);

      const editTool: Tool = {
        name: "edit_file",
        mutates: true,
        description: "Edit",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: "edited" }),
      };
      assert.strictEqual(isReadOnlyTool("edit_file", editTool), false);

      const deleteTool: Tool = {
        name: "delete_file",
        description: "Delete",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: "deleted" }),
      };
      assert.strictEqual(isReadOnlyTool("delete_file", deleteTool), false);
    });
  });

  suite("duplicate tool caching in ChatSession", () => {
    let mockCtx: ToolContext;
    let mockClient: any;
    let registry: ToolRegistry;

    setup(() => {
      mockCtx = {
        workspaceRoot: { fsPath: "/workspace" } as vscode.Uri,
        terminalAutoRun: true,
        resolvePath: async (p: string) => ({ fsPath: `/workspace/${p}` } as vscode.Uri),
        toRelative: (uri: vscode.Uri) => uri.fsPath.replace("/workspace/", ""),
        confirm: async () => true,
      };
      mockClient = {
        getModel: () => "test-model",
        stream: async function* () {
          return { content: "done", toolCalls: [], finishReason: "stop" };
        },
      };
      registry = new ToolRegistry();
    });

    test("caches duplicate read-only tool calls and adds prefix note", async () => {
      let readExecCount = 0;
      const readTool: Tool = {
        name: "read_file",
        description: "Read",
        parameters: { type: "object", properties: { path: { type: "string" } } },
        execute: async (args) => {
          readExecCount++;
          return { content: `content of ${args.path}` };
        },
      };
      registry.register(readTool);

      const session = new ChatSession(
        mockClient,
        registry,
        mockCtx,
        "test-ws",
        true,
        "test-model",
      );

      const outputs: string[] = [];
      const callbacks: any = {
        onAssistantStart: () => {},
        onAssistantDelta: () => {},
        onAssistantDone: () => {},
        onToolStart: () => {},
        onToolEnd: (_id: string, _ok: boolean, _sum: string, content?: string) => {
          if (content) {
            outputs.push(content);
          }
        },
        onStatus: () => {},
        onError: () => {},
      };

      const call1 = {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "read_file",
          arguments: JSON.stringify({ path: "src/main.ts" }),
        },
      };

      // First call executes the tool
      await (session as any).runToolCall(call1, callbacks);
      assert.strictEqual(readExecCount, 1);
      assert.strictEqual(outputs[0], "content of src/main.ts");

      // Second identical call hits the cache
      const call2 = {
        id: "call_2",
        type: "function" as const,
        function: {
          name: "read_file",
          arguments: JSON.stringify({ path: "src/main.ts" }),
        },
      };
      await (session as any).runToolCall(call2, callbacks);
      assert.strictEqual(readExecCount, 1, "Tool execute must not be called again");
      assert.ok(
        outputs[1].startsWith("[duplicate call; returning earlier result]"),
        `Expected duplicate prefix note, got: ${outputs[1]}`,
      );
      assert.ok(outputs[1].includes("content of src/main.ts"));
    });

    test("never caches run_command or side-effect tools", async () => {
      let runCmdCount = 0;
      const runCmdTool: Tool = {
        name: "run_command",
        mutates: true,
        description: "Run shell command",
        parameters: { type: "object", properties: { command: { type: "string" } } },
        execute: async (args) => {
          runCmdCount++;
          return { content: `output of ${args.command} (#${runCmdCount})` };
        },
      };
      registry.register(runCmdTool);

      const session = new ChatSession(
        mockClient,
        registry,
        mockCtx,
        "test-ws",
        true,
        "test-model",
      );

      const outputs: string[] = [];
      const callbacks: any = {
        onAssistantStart: () => {},
        onAssistantDelta: () => {},
        onAssistantDone: () => {},
        onToolStart: () => {},
        onToolEnd: (_id: string, _ok: boolean, _sum: string, content?: string) => {
          if (content) {
            outputs.push(content);
          }
        },
        onStatus: () => {},
        onError: () => {},
      };

      const call1 = {
        id: "cmd_1",
        type: "function" as const,
        function: {
          name: "run_command",
          arguments: JSON.stringify({ command: "npm test" }),
        },
      };

      await (session as any).runToolCall(call1, callbacks);
      assert.strictEqual(runCmdCount, 1);

      const call2 = {
        id: "cmd_2",
        type: "function" as const,
        function: {
          name: "run_command",
          arguments: JSON.stringify({ command: "npm test" }),
        },
      };

      await (session as any).runToolCall(call2, callbacks);
      assert.strictEqual(runCmdCount, 2, "run_command must be executed each time without caching");
      assert.ok(!outputs[1].includes("[duplicate call; returning earlier result]"));
    });

    test("mutation clears the read-only cache", async () => {
      let readCount = 0;
      const readTool: Tool = {
        name: "read_file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
        description: "Read",
        execute: async () => {
          readCount++;
          return { content: `data ${readCount}` };
        },
      };
      const editTool: Tool = {
        name: "edit_file",
        mutates: true,
        parameters: { type: "object", properties: { path: { type: "string" } } },
        description: "Edit",
        execute: async () => ({ content: "ok", summary: "Edited" }),
      };
      registry.register(readTool).register(editTool);

      const session = new ChatSession(
        mockClient,
        registry,
        mockCtx,
        "test-ws",
        true,
        "test-model",
      );

      const callbacks: any = {
        onAssistantStart: () => {},
        onAssistantDelta: () => {},
        onAssistantDone: () => {},
        onToolStart: () => {},
        onToolEnd: () => {},
        onStatus: () => {},
        onError: () => {},
      };

      const readCall = {
        id: "r1",
        type: "function" as const,
        function: { name: "read_file", arguments: JSON.stringify({ path: "a.ts" }) },
      };

      // 1. Initial read -> executed
      await (session as any).runToolCall(readCall, callbacks);
      assert.strictEqual(readCount, 1);

      // 2. Duplicate read -> cached
      await (session as any).runToolCall(readCall, callbacks);
      assert.strictEqual(readCount, 1);

      // 3. Edit mutation executes -> invalidates cache
      const editCall = {
        id: "e1",
        type: "function" as const,
        function: { name: "edit_file", arguments: JSON.stringify({ path: "a.ts" }) },
      };
      await (session as any).runToolCall(editCall, callbacks);

      // 4. Read again -> cache was cleared, so it executes fresh!
      await (session as any).runToolCall(readCall, callbacks);
      assert.strictEqual(readCount, 2, "Read cache must be cleared after mutation");
    });
  });

  suite("MAX_TOOL_TURNS cap in agent loop", () => {
    test("stops agent loop when MAX_TOOL_TURNS is reached and prompts summary", async () => {
      process.env.MAX_TOOL_TURNS = "2";

      let streamInvocations = 0;
      let toolsCalled = 0;

      const mockClient: any = {
        getModel: () => "test-model",
        stream: async function* (messages: ChatMessage[], opts: any) {
          streamInvocations++;
          if (opts.phase === "explain" && !opts.tools) {
            // This is the final explanation call after loop guard triggered
            yield { type: "text", delta: "Summary of completed and remaining work" };
            return {
              content: "Summary of completed and remaining work",
              toolCalls: [],
              finishReason: "stop",
            };
          }

          // Otherwise return a tool call
          return {
            content: "Calling tool",
            toolCalls: [
              {
                id: `call_${streamInvocations}`,
                type: "function" as const,
                function: {
                  name: "list_files",
                  arguments: JSON.stringify({ path: `dir_${streamInvocations}` }),
                },
              },
            ],
            finishReason: "tool_calls",
          };
        },
      };

      const registry = new ToolRegistry();
      registry.register({
        name: "list_files",
        description: "List",
        parameters: { type: "object", properties: { path: { type: "string" } } },
        execute: async () => {
          toolsCalled++;
          return { content: "file list" };
        },
      });

      const mockCtx: ToolContext = {
        workspaceRoot: { fsPath: "/workspace" } as vscode.Uri,
        terminalAutoRun: true,
        resolvePath: async (p: string) => ({ fsPath: `/workspace/${p}` } as vscode.Uri),
        toRelative: (uri: vscode.Uri) => uri.fsPath.replace("/workspace/", ""),
        confirm: async () => true,
      };

      const session = new ChatSession(
        mockClient,
        registry,
        mockCtx,
        "test-ws",
        true,
        "test-model",
      );

      let finishedStatus = false;
      let finalAssistantText = "";
      const callbacks = {
        onAssistantStart: () => {},
        onAssistantDelta: (_id: string, delta: string) => {
          finalAssistantText += delta;
        },
        onAssistantDone: () => {},
        onToolStart: () => {},
        onToolEnd: () => {},
        onStatus: (status: string) => {
          if (status === "Finished") {
            finishedStatus = true;
          }
        },
        onError: () => {},
      };

      await session.send("start work", callbacks);

      // MAX_TOOL_TURNS = 2:
      // Turn 1 (toolCalls) -> tool executed (count = 1)
      // Turn 2 (toolCalls) -> tool executed (count = 2)
      // Turn 3 (toolCalls) -> limit reached! Tools NOT executed. Final explain stream called.
      assert.strictEqual(toolsCalled, 2, "Only 2 tool turns should have executed");
      assert.strictEqual(finishedStatus, true, "Session should finish gracefully");
      assert.ok(
        finalAssistantText.includes("Summary of completed and remaining work"),
        "Final summary should be streamed to the user",
      );
    });
  });
});
