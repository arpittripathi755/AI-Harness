import * as assert from "assert";
import { UsageTracker } from "../llm/usageTracker";

suite("Usage Telemetry and Session Cost Guard (Phase 5)", () => {
  const originalEnvMaxUsd = process.env.MAX_SESSION_USD;

  teardown(() => {
    if (originalEnvMaxUsd !== undefined) {
      process.env.MAX_SESSION_USD = originalEnvMaxUsd;
    } else {
      delete process.env.MAX_SESSION_USD;
    }
  });

  test("aggregation math accurately computes overall, byPhase, and byModel totals", () => {
    const tracker = new UsageTracker();

    tracker.recordUsage("deepseek/deepseek-v4.1-flash", [], { content: "turn 1", toolCalls: [] }, "tool_decision", {
      prompt_tokens: 100,
      completion_tokens: 50,
      cost: 0.01,
    });

    tracker.recordUsage("deepseek/deepseek-v4.1-flash", [], { content: "turn 2", toolCalls: [] }, "edit", {
      prompt_tokens: 200,
      completion_tokens: 100,
      cost: 0.02,
    });

    tracker.recordUsage("qwen/qwen3-coder", [], { content: "turn 3", toolCalls: [] }, "explain", {
      prompt_tokens: 300,
      completion_tokens: 150,
      cost: 0.05,
    });

    const summary = tracker.getSessionSummary();

    // Overall
    assert.strictEqual(summary.recordCount, 3);
    assert.strictEqual(summary.overall.promptTokens, 600);
    assert.strictEqual(summary.overall.completionTokens, 300);
    assert.strictEqual(summary.overall.totalTokens, 900);
    assert.strictEqual(Math.round(summary.overall.costUsd * 100) / 100, 0.08);

    // By Phase
    assert.strictEqual(summary.byPhase.tool_decision.totalTokens, 150);
    assert.strictEqual(summary.byPhase.edit.totalTokens, 300);
    assert.strictEqual(summary.byPhase.explain.totalTokens, 450);

    // By Model
    assert.strictEqual(summary.byModel["deepseek/deepseek-v4.1-flash"].totalTokens, 450);
    assert.strictEqual(summary.byModel["qwen/qwen3-coder"].totalTokens, 450);
  });

  test("estimated vs real records are distinguished properly", () => {
    const tracker = new UsageTracker();

    // Real usage from provider
    const realRec = tracker.recordUsage("m", [], { content: "hi", toolCalls: [] }, "explain", {
      prompt_tokens: 15,
      completion_tokens: 10,
    });
    assert.strictEqual(realRec.estimated, false);
    assert.strictEqual(realRec.promptTokens, 15);
    assert.strictEqual(realRec.completionTokens, 10);

    // Estimated usage (no rawUsage)
    const estRec = tracker.recordUsage(
      "m",
      [{ role: "user", content: "hello world" }],
      { content: "testing token estimation", toolCalls: [] },
      "explain",
    );
    assert.strictEqual(estRec.estimated, true);
    assert.ok(estRec.promptTokens > 0);
    assert.ok(estRec.completionTokens > 0);
  });

  test("warns once at 80% and stops gracefully at 100% of MAX_SESSION_USD", () => {
    process.env.MAX_SESSION_USD = "1.00";
    const tracker = new UsageTracker();

    let warnCalls = 0;
    const onWarn = () => {
      warnCalls++;
    };

    // 1. Spend $0.50 (50%) -> no warning, no stop
    tracker.recordUsage("m", [], { content: "", toolCalls: [] }, "tool_decision", {
      prompt_tokens: 10,
      completion_tokens: 10,
      cost: 0.5,
    });
    let check = tracker.checkSessionLimit(onWarn);
    assert.strictEqual(check.exceedLimit, false);
    assert.strictEqual(warnCalls, 0);

    // 2. Spend another $0.35 (total $0.85, 85%) -> warns once
    tracker.recordUsage("m", [], { content: "", toolCalls: [] }, "edit", {
      prompt_tokens: 10,
      completion_tokens: 10,
      cost: 0.35,
    });
    check = tracker.checkSessionLimit(onWarn);
    assert.strictEqual(check.exceedLimit, false);
    assert.strictEqual(warnCalls, 1, "Should warn once at >= 80%");

    // 3. Spend another $0.05 (total $0.90, 90%) -> should NOT warn a second time
    tracker.recordUsage("m", [], { content: "", toolCalls: [] }, "edit", {
      prompt_tokens: 10,
      completion_tokens: 10,
      cost: 0.05,
    });
    check = tracker.checkSessionLimit(onWarn);
    assert.strictEqual(check.exceedLimit, false);
    assert.strictEqual(warnCalls, 1, "Should NOT warn a second time");

    // 4. Spend another $0.15 (total $1.05, 105%) -> stops gracefully
    tracker.recordUsage("m", [], { content: "", toolCalls: [] }, "edit", {
      prompt_tokens: 10,
      completion_tokens: 10,
      cost: 0.15,
    });
    check = tracker.checkSessionLimit(onWarn);
    assert.strictEqual(check.exceedLimit, true);
    assert.ok(check.message?.includes("Session cost limit of $1.0000 reached"));
  });

  test("no-limit mode allows spend without warnings or stops when MAX_SESSION_USD is unset", () => {
    delete process.env.MAX_SESSION_USD;
    const tracker = new UsageTracker();

    let warned = false;
    tracker.recordUsage("m", [], { content: "", toolCalls: [] }, "edit", {
      prompt_tokens: 100,
      completion_tokens: 100,
      cost: 50.0, // $50 spend
    });

    const check = tracker.checkSessionLimit(() => {
      warned = true;
    });
    assert.strictEqual(check.exceedLimit, false);
    assert.strictEqual(warned, false);
  });
});
