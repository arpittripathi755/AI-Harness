import * as assert from "assert";
import {
  estimateTokens,
  estimateMessagesTokens,
  truncateHeadTail,
  compactHistory,
  resolveInputTokenBudget,
} from "../llm/contextBudget";
import type { ChatMessage } from "../llm/types";

suite("Token-Based Input Management (Phase 3)", () => {
  test("resolveInputTokenBudget safely parses env and numbers, falling back to 24000", () => {
    assert.strictEqual(resolveInputTokenBudget(undefined), 24000);
    assert.strictEqual(resolveInputTokenBudget(""), 24000);
    assert.strictEqual(resolveInputTokenBudget("abc"), 24000);
    assert.strictEqual(resolveInputTokenBudget("-100"), 24000);
    assert.strictEqual(resolveInputTokenBudget("0"), 24000);
    assert.strictEqual(resolveInputTokenBudget(16000), 16000);
    assert.strictEqual(resolveInputTokenBudget("32000"), 32000);
  });

  test("estimateTokens uses length / 3.5 heuristic", () => {
    assert.strictEqual(estimateTokens(""), 0);
    assert.strictEqual(estimateTokens(null), 0);
    assert.strictEqual(estimateTokens("1234567"), 2); // 7 / 3.5 = 2
    assert.strictEqual(estimateTokens("1234"), 2); // 4 / 3.5 = ceil(1.14) = 2
  });

  test("truncateHeadTail boundary tests", () => {
    const shortText = "hello world\nline 2";
    assert.strictEqual(truncateHeadTail(shortText, 100), shortText);

    // Create 100 lines of 50 chars each = 5,000 chars
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: ${"x".repeat(40)}`);
    const longText = lines.join("\n");

    const truncated = truncateHeadTail(longText, 500, 100, 200);
    assert.ok(truncated.length <= 500, "Truncated length should not exceed maxChars");
    assert.ok(truncated.includes("Line 1:"), "Should preserve head");
    assert.ok(truncated.includes("Line 100:"), "Should preserve tail");
    assert.ok(truncated.includes("lines omitted"), "Should include omission marker");
  });

  test("compactHistory returns unchanged messages when below 70% budget", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are an assistant." },
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
      { role: "user", content: "next turn" },
      { role: "assistant", content: "next answer" },
    ];

    const budget = 10000;
    const compacted = compactHistory(messages, budget);
    assert.deepStrictEqual(compacted, messages);
  });

  test("compactHistory does not mutate the input array", () => {
    const originalContent = "Massive file output " + "x".repeat(3000);
    const messages: ChatMessage[] = [
      { role: "system", content: "System prompt." },
      { role: "user", content: "read file" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"src/index.ts"}' } }],
      },
      { role: "tool", tool_call_id: "call_1", content: originalContent },
      { role: "user", content: "turn 2" },
      { role: "assistant", content: "turn 2 answer" },
      { role: "user", content: "turn 3" },
      { role: "assistant", content: "turn 3 answer" },
    ];

    const copyBefore = JSON.parse(JSON.stringify(messages));
    const compacted = compactHistory(messages, 500);

    // Assert original array was not mutated in place
    assert.strictEqual(messages[3].content, originalContent);
    assert.deepStrictEqual(messages, copyBefore);
    assert.notStrictEqual(compacted, messages);
  });

  test("compactHistory keeps the last 3 items verbatim and stubs older tool results", () => {
    const hugeToolOutput = "function foo() {\n" + "  console.log('x');\n".repeat(200) + "}";
    const messages: ChatMessage[] = [
      { role: "system", content: "System prompt" },
      { role: "user", content: "read file please" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"src/test.ts"}' } }],
      },
      { role: "tool", tool_call_id: "c1", content: hugeToolOutput },
      // Last 3 items
      { role: "assistant", content: "I read the file." },
      { role: "user", content: "now edit it" },
      { role: "assistant", content: "Editing file..." },
    ];

    const compacted = compactHistory(messages, 400);

    // Item 3 (older tool result) should be stubbed
    const stubbed = compacted.find((m) => m.role === "tool" && m.tool_call_id === "c1");
    assert.ok(stubbed);
    assert.ok(String(stubbed.content).includes("[tool result omitted: read_file src/test.ts"));

    // Last 3 items should remain intact
    assert.strictEqual(compacted[compacted.length - 1].content, "Editing file...");
    assert.strictEqual(compacted[compacted.length - 2].content, "now edit it");
    assert.strictEqual(compacted[compacted.length - 3].content, "I read the file.");
  });

  test("compactHistory preserves tool-call and tool-result pairing when dropping turns", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "System" },
      // Turn 1
      { role: "user", content: "Task 1 " + "x".repeat(1000) },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }],
      },
      { role: "tool", tool_call_id: "c1", content: "result 1 " + "y".repeat(1000) },
      // Turn 2
      { role: "user", content: "Task 2 " + "x".repeat(1000) },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c2", type: "function", function: { name: "read_file", arguments: '{"path":"b.ts"}' } }],
      },
      { role: "tool", tool_call_id: "c2", content: "result 2 " + "y".repeat(1000) },
      // Last turn
      { role: "user", content: "Recent user" },
      { role: "assistant", content: "Recent assistant" },
    ];

    // Tight budget forcing dropping of older groups
    const compacted = compactHistory(messages, 400);

    // If a tool result is present, its corresponding assistant tool_call must also be present
    const toolMsgIds = compacted.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
    for (const id of toolMsgIds) {
      const hasParentCall = compacted.some(
        (m) => m.role === "assistant" && m.tool_calls?.some((c) => c.id === id),
      );
      assert.ok(hasParentCall, `Tool message ${id} must have paired assistant tool_call in compacted messages`);
    }
  });

  test("compactHistory is idempotent (compacting twice equals compacting once)", () => {
    const hugeToolOutput = "data:\n" + "line of text\n".repeat(300);
    const messages: ChatMessage[] = [
      { role: "system", content: "System" },
      { role: "user", content: "fetch" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "search_workspace", arguments: '{"query":"foo"}' } }],
      },
      { role: "tool", tool_call_id: "c1", content: hugeToolOutput },
      { role: "assistant", content: "Found results." },
      { role: "user", content: "What next?" },
      { role: "assistant", content: "Here is next step." },
    ];

    const budget = 300;
    const pass1 = compactHistory(messages, budget);
    const pass2 = compactHistory(pass1, budget);

    assert.deepStrictEqual(pass1, pass2, "Compacting twice must equal compacting once");
  });
});
