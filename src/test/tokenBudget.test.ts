import * as assert from "assert";
import {
  PHASE_BUDGET,
  getPhaseMaxTokens,
  getPhaseModelOverride,
  type CallPhase,
} from "../llm/tokenBudget";
import { MODELS } from "../shared/models";

suite("Adaptive Token Budget: Per-Phase Output Budgets (Phase 1)", () => {
  const originalEnvMaxTokens = process.env.MAX_TOKENS;
  const originalEnvAiMaxTokens = process.env.AI_MAX_TOKENS;

  teardown(() => {
    if (originalEnvMaxTokens !== undefined) {
      process.env.MAX_TOKENS = originalEnvMaxTokens;
    } else {
      delete process.env.MAX_TOKENS;
    }
    if (originalEnvAiMaxTokens !== undefined) {
      process.env.AI_MAX_TOKENS = originalEnvAiMaxTokens;
    } else {
      delete process.env.AI_MAX_TOKENS;
    }
  });

  test("each phase default matches the specification", () => {
    delete process.env.MAX_TOKENS;
    delete process.env.AI_MAX_TOKENS;

    assert.strictEqual(PHASE_BUDGET.tool_decision, 1024);
    assert.strictEqual(PHASE_BUDGET.edit, 4096);
    assert.strictEqual(PHASE_BUDGET.explain, 1536);
    assert.strictEqual(PHASE_BUDGET.plan, 2048);

    assert.strictEqual(getPhaseMaxTokens("tool_decision", "deepseek/deepseek-v4.1-flash"), 1024);
    assert.strictEqual(getPhaseMaxTokens("edit", "deepseek/deepseek-v4.1-flash"), 4096);
    assert.strictEqual(getPhaseMaxTokens("explain", "deepseek/deepseek-v4.1-flash"), 1536);
    assert.strictEqual(getPhaseMaxTokens("plan", "deepseek/deepseek-v4.1-flash"), 2048);
  });

  test("env ceiling lowers a phase budget when lower", () => {
    process.env.MAX_TOKENS = "2000";

    // Edit (4096) is capped by env ceiling 2000
    assert.strictEqual(getPhaseMaxTokens("edit", "deepseek/deepseek-v4.1-flash"), 2000);

    // Tool decision (1024) is NOT raised by env ceiling 2000 (can only lower)
    assert.strictEqual(getPhaseMaxTokens("tool_decision", "deepseek/deepseek-v4.1-flash"), 1024);
  });

  test("env ceiling using AI_MAX_TOKENS works similarly", () => {
    delete process.env.MAX_TOKENS;
    process.env.AI_MAX_TOKENS = "800";

    // Both edit and tool_decision get capped to 800
    assert.strictEqual(getPhaseMaxTokens("edit", "deepseek/deepseek-v4.1-flash"), 800);
    assert.strictEqual(getPhaseMaxTokens("tool_decision", "deepseek/deepseek-v4.1-flash"), 800);
  });

  test("model ceiling lowers the budget further if model has maxOutputTokens", () => {
    delete process.env.MAX_TOKENS;
    delete process.env.AI_MAX_TOKENS;

    // Temporarily add a model with maxOutputTokens: 500
    const testModelId = "test/restricted-output-model";
    MODELS.push({
      displayName: "Restricted Model",
      apiModelId: testModelId,
      maxOutputTokens: 500,
    });

    try {
      assert.strictEqual(getPhaseMaxTokens("tool_decision", testModelId), 500);
      assert.strictEqual(getPhaseMaxTokens("edit", testModelId), 500);
    } finally {
      const idx = MODELS.findIndex((m) => m.apiModelId === testModelId);
      if (idx !== -1) {
        MODELS.splice(idx, 1);
      }
    }
  });

  test("override takes precedence before ceilings", () => {
    delete process.env.MAX_TOKENS;
    delete process.env.AI_MAX_TOKENS;

    // Explicit override 300 overrides tool_decision (1024)
    assert.strictEqual(getPhaseMaxTokens("tool_decision", "deepseek/deepseek-v4.1-flash", 300), 300);

    // Explicit override 5000 is capped by env ceiling 2000
    process.env.MAX_TOKENS = "2000";
    assert.strictEqual(getPhaseMaxTokens("tool_decision", "deepseek/deepseek-v4.1-flash", 5000), 2000);
  });

  test("invalid env values ('abc', '0', '-5') are safely ignored and do not crash", () => {
    for (const bad of ["abc", "0", "-5", "NaN", "   "]) {
      process.env.MAX_TOKENS = bad;
      assert.strictEqual(getPhaseMaxTokens("tool_decision", "deepseek/deepseek-v4.1-flash"), 1024);
      assert.strictEqual(getPhaseMaxTokens("edit", "deepseek/deepseek-v4.1-flash"), 4096);
    }
  });
});

suite("Model Routing (Phase 7)", () => {
  const originalEnvPhaseOverride = process.env.PHASE_MODEL_OVERRIDE;

  teardown(() => {
    if (originalEnvPhaseOverride !== undefined) {
      process.env.PHASE_MODEL_OVERRIDE = originalEnvPhaseOverride;
    } else {
      delete process.env.PHASE_MODEL_OVERRIDE;
    }
  });

  test("returns undefined when PHASE_MODEL_OVERRIDE is unset", () => {
    delete process.env.PHASE_MODEL_OVERRIDE;
    assert.strictEqual(getPhaseModelOverride("edit"), undefined);
    assert.strictEqual(getPhaseModelOverride("plan"), undefined);
  });

  test("reads valid JSON map of phase -> modelId", () => {
    process.env.PHASE_MODEL_OVERRIDE = JSON.stringify({
      edit: "qwen/qwen-2.5-coder-32b-instruct",
      plan: "deepseek/deepseek-chat",
    });

    assert.strictEqual(
      getPhaseModelOverride("edit"),
      "qwen/qwen-2.5-coder-32b-instruct",
    );
    assert.strictEqual(
      getPhaseModelOverride("plan"),
      "deepseek/deepseek-chat",
    );
    assert.strictEqual(
      getPhaseModelOverride("tool_decision"),
      undefined,
    );
  });

  test("gracefully handles invalid JSON", () => {
    process.env.PHASE_MODEL_OVERRIDE = "not-valid-json";
    assert.strictEqual(getPhaseModelOverride("edit"), undefined);
  });
});

