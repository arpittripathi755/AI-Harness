import * as assert from "assert";
import { buildSystemPrompt } from "../agent/ChatSession";
import { Orchestrator, DEFAULT_BUDGET } from "../agent/Orchestrator";

suite("Cache-Friendly Prompt Layout (Phase 4)", () => {
  test("two consecutive prompt builds with different volatile inputs share an identical stable prefix", () => {
    const orch1 = new Orchestrator(DEFAULT_BUDGET); // Phase: EXPLORING

    const orch2 = new Orchestrator(DEFAULT_BUDGET);
    orch2.onMutationAttempt("src/index.ts"); // Phase: EDITING

    const promptTurn1 = buildSystemPrompt(
      "Qwen3 Coder 480B",
      "my-workspace",
      "/path/to/workspace",
      true,
      "Working memory: analyzed 2 files",
      orch1,
    );

    const promptTurn2 = buildSystemPrompt(
      "Qwen3 Coder 480B",
      "my-workspace",
      "/path/to/workspace",
      true,
      "Working memory: modified 5 files and ran tests",
      orch2,
    );

    // Compute common prefix length
    let commonPrefixLen = 0;
    const minLen = Math.min(promptTurn1.length, promptTurn2.length);
    while (
      commonPrefixLen < minLen &&
      promptTurn1[commonPrefixLen] === promptTurn2[commonPrefixLen]
    ) {
      commonPrefixLen++;
    }

    const stablePrefix = promptTurn1.slice(0, commonPrefixLen);

    // The shared prefix must contain the core system instructions
    assert.ok(
      stablePrefix.includes("Work by reasoning step by step"),
      "Stable prefix must include reasoning directives",
    );
    assert.ok(
      stablePrefix.includes("Be efficient with tool calls"),
      "Stable prefix must include tool efficiency rules",
    );
    assert.ok(
      stablePrefix.includes("UNTRUSTED DATA SAFETY"),
      "Stable prefix must include web search and safety instructions",
    );

    // Ensure the stable prefix is substantial (> 1000 characters)
    assert.ok(
      stablePrefix.length > 1000,
      `Stable prefix should be substantial for KV prompt caching (was ${stablePrefix.length} chars)`,
    );

    // The volatile differences only appear AFTER the stable prefix
    const suffix1 = promptTurn1.slice(commonPrefixLen);
    const suffix2 = promptTurn2.slice(commonPrefixLen);

    assert.ok(suffix1.includes("Exploring codebase"));
    assert.ok(suffix2.includes("Editing files"));
    assert.ok(suffix1.includes("analyzed 2 files"));
    assert.ok(suffix2.includes("modified 5 files"));
  });
});
