/**
 * UsageMark & Hybrid Token Estimation Tests (Phase 5).
 *
 * Verifies:
 *   1. Provider usage precedence (Ground Truth wins)
 *   2. Provider usage absent falls back to calibrated or raw estimate
 *   3. Raw estimate fallback when uncalibrated
 *   4. Calibrated estimate computation with known factor
 *   5. Calibration update moving in expected direction
 *   6. Bounded calibration clamping against extreme ratios
 *   7. Provider / model identity isolation
 *   8. Missing cached_tokens preservation (undefined, never assumed 0)
 *   9. Malformed provider usage safe fallback
 *  10. Zero values / division-by-zero safety
 *  11. Multi-request / retry accounting without double counting
 *  12. Feature flag OFF preserves exact legacy behavior
 *  13. Streaming final chunk usage propagation
 *  14. Streaming without usage graceful fallback
 *  15. Reasoning token preservation (present vs undefined)
 *  16. Multi-turn deterministic replay benchmark (Before vs After error comparison)
 */

import * as assert from "assert";
import {
  isUsageMarkEnabled,
  resolveUsageMark,
  CalibrationTracker,
  getCalibrationIdentity,
  computeRelativeError,
  clamp,
  MIN_CORRECTION_FACTOR,
  MAX_CORRECTION_FACTOR,
  DEFAULT_CALIBRATION_ALPHA,
  type UsageObservation,
  type UsageMark,
} from "../llm/usageMark";
import { UsageTracker } from "../llm/usageTracker";
import type { ChatMessage, AssistantTurn, ChatCompletionChunk } from "../llm/types";

suite("UsageMark: Hybrid Token Estimation (Phase 5)", () => {
  let origEnvFlag: string | undefined;

  setup(() => {
    origEnvFlag = process.env.DAXIOM_USAGE_MARK;
  });

  teardown(() => {
    if (origEnvFlag !== undefined) {
      process.env.DAXIOM_USAGE_MARK = origEnvFlag;
    } else {
      delete process.env.DAXIOM_USAGE_MARK;
    }
  });

  // -------------------------------------------------------------------------
  // Test 1: Provider usage wins
  // -------------------------------------------------------------------------
  test("Test 1: provider usage wins (provider = 1000, estimate = 1200 => result = 1000, source = 'provider')", () => {
    const tracker = new CalibrationTracker();
    const obs: UsageObservation = {
      model: "deepseek/deepseek-chat",
      provider: "openrouter",
      estimatedPromptTokens: 1200,
      estimatedCompletionTokens: 500,
      actualPromptTokens: 1000,
      actualCompletionTokens: 450,
      actualTotalTokens: 1450,
    };

    const mark = resolveUsageMark(obs, tracker);

    assert.strictEqual(mark.source, "provider");
    assert.strictEqual(mark.confidence, "high");
    assert.strictEqual(mark.promptTokens, 1000);
    assert.strictEqual(mark.completionTokens, 450);
    assert.strictEqual(mark.totalTokens, 1450);
    assert.strictEqual(mark.actualPromptTokens, 1000);
    assert.strictEqual(mark.actualCompletionTokens, 450);
  });

  // -------------------------------------------------------------------------
  // Test 2: Provider usage absent
  // -------------------------------------------------------------------------
  test("Test 2: provider usage absent falls back to estimate or calibrated estimate", () => {
    const tracker = new CalibrationTracker();
    const obs: UsageObservation = {
      model: "deepseek/deepseek-chat",
      provider: "openrouter",
      estimatedPromptTokens: 1200,
      estimatedCompletionTokens: 300,
      // actualPromptTokens & actualCompletionTokens absent
    };

    const mark = resolveUsageMark(obs, tracker);

    assert.notStrictEqual(mark.source, "provider");
    assert.strictEqual(mark.promptTokens, 1200);
    assert.strictEqual(mark.completionTokens, 300);
    assert.strictEqual(mark.totalTokens, 1500);
  });

  // -------------------------------------------------------------------------
  // Test 3: Raw estimate fallback
  // -------------------------------------------------------------------------
  test("Test 3: raw estimate fallback when no calibration history exists", () => {
    const tracker = new CalibrationTracker();
    const obs: UsageObservation = {
      model: "deepseek/deepseek-chat",
      provider: "openrouter",
      estimatedPromptTokens: 850,
      estimatedCompletionTokens: 150,
    };

    const mark = resolveUsageMark(obs, tracker);

    assert.strictEqual(mark.source, "estimate");
    assert.strictEqual(mark.confidence, "low");
    assert.strictEqual(mark.promptTokens, 850);
    assert.strictEqual(mark.completionTokens, 150);
    assert.strictEqual(mark.totalTokens, 1000);
    assert.strictEqual(mark.promptCorrectionFactor, 1.0);
    assert.strictEqual(mark.completionCorrectionFactor, 1.0);
  });

  // -------------------------------------------------------------------------
  // Test 4: Calibrated estimate
  // -------------------------------------------------------------------------
  test("Test 4: calibrated estimate uses known calibration factors", () => {
    const tracker = new CalibrationTracker();
    // Inject known calibration factors for openrouter::qwen-coder: prompt 1.10, completion 1.20
    tracker.setState("openrouter", "qwen-coder", {
      promptFactor: 1.1,
      completionFactor: 1.2,
      sampleCount: 5,
    });

    const obs: UsageObservation = {
      model: "qwen-coder",
      provider: "openrouter",
      estimatedPromptTokens: 1000,
      estimatedCompletionTokens: 500,
      // Provider usage absent
    };

    const mark = resolveUsageMark(obs, tracker);

    assert.strictEqual(mark.source, "calibrated-estimate");
    assert.strictEqual(mark.confidence, "medium");
    // 1000 * 1.10 = 1100
    assert.strictEqual(mark.promptTokens, 1100);
    // 500 * 1.20 = 600
    assert.strictEqual(mark.completionTokens, 600);
    assert.strictEqual(mark.totalTokens, 1700);
    assert.strictEqual(mark.promptCorrectionFactor, 1.1);
    assert.strictEqual(mark.completionCorrectionFactor, 1.2);
  });

  // -------------------------------------------------------------------------
  // Test 5: Calibration update moves factor in expected direction
  // -------------------------------------------------------------------------
  test("Test 5: calibration update moves factor in expected direction toward observed ratio", () => {
    const tracker = new CalibrationTracker(0.2); // alpha = 0.2
    const key = getCalibrationIdentity("openrouter", "deepseek-model");

    // Initially factor is 1.0. Observed: estimated=1000, actual=1200 (ratio = 1.20)
    tracker.update({
      model: "deepseek-model",
      provider: "openrouter",
      estimatedPromptTokens: 1000,
      estimatedCompletionTokens: 500,
      actualPromptTokens: 1200,
      actualCompletionTokens: 500,
    });

    const state1 = tracker.getState("openrouter", "deepseek-model");
    assert.ok(state1);
    assert.strictEqual(state1.sampleCount, 1);
    // Expected newFactor = 1.0 * (1 - 0.2) + 1.20 * 0.2 = 0.8 + 0.24 = 1.04
    assert.strictEqual(Math.round(state1.promptFactor * 1000) / 1000, 1.04);
    assert.strictEqual(Math.round(state1.completionFactor * 1000) / 1000, 1.0);

    // Another observation with higher ratio: actual=1400 (ratio = 1.40)
    tracker.update({
      model: "deepseek-model",
      provider: "openrouter",
      estimatedPromptTokens: 1000,
      estimatedCompletionTokens: 500,
      actualPromptTokens: 1400,
      actualCompletionTokens: 500,
    });

    const state2 = tracker.getState("openrouter", "deepseek-model");
    assert.ok(state2);
    assert.strictEqual(state2.sampleCount, 2);
    // Expected newFactor = 1.04 * 0.8 + 1.40 * 0.2 = 0.832 + 0.28 = 1.112
    assert.ok(state2.promptFactor > state1.promptFactor, "Factor should have increased further");
    assert.strictEqual(Math.round(state2.promptFactor * 1000) / 1000, 1.112);
  });

  // -------------------------------------------------------------------------
  // Test 6: Bounded calibration clamps against extreme ratios
  // -------------------------------------------------------------------------
  test("Test 6: bounded calibration prevents unbounded drift from extreme ratios", () => {
    const tracker = new CalibrationTracker(1.0, MIN_CORRECTION_FACTOR, MAX_CORRECTION_FACTOR); // alpha=1.0 for immediate extreme test

    // Extreme high ratio: 100x
    tracker.update({
      model: "m",
      provider: "p",
      estimatedPromptTokens: 10,
      estimatedCompletionTokens: 10,
      actualPromptTokens: 1000,
      actualCompletionTokens: 1000,
    });

    let state = tracker.getState("p", "m");
    assert.ok(state);
    assert.strictEqual(state.promptFactor, MAX_CORRECTION_FACTOR, "Should be clamped at MAX_CORRECTION_FACTOR (2.0)");
    assert.strictEqual(state.completionFactor, MAX_CORRECTION_FACTOR, "Should be clamped at MAX_CORRECTION_FACTOR (2.0)");

    // Extreme low ratio: 0.001x
    tracker.update({
      model: "m",
      provider: "p",
      estimatedPromptTokens: 10000,
      estimatedCompletionTokens: 10000,
      actualPromptTokens: 1,
      actualCompletionTokens: 1,
    });

    state = tracker.getState("p", "m");
    assert.ok(state);
    assert.strictEqual(state.promptFactor, MIN_CORRECTION_FACTOR, "Should be clamped at MIN_CORRECTION_FACTOR (0.5)");
    assert.strictEqual(state.completionFactor, MIN_CORRECTION_FACTOR, "Should be clamped at MIN_CORRECTION_FACTOR (0.5)");
  });

  // -------------------------------------------------------------------------
  // Test 7: Provider/Model isolation
  // -------------------------------------------------------------------------
  test("Test 7: provider and model isolation ensures Model A does not contaminate Model B", () => {
    const tracker = new CalibrationTracker(0.5);

    // Update openrouter::model-A with 1.5 ratio
    tracker.update({
      model: "model-A",
      provider: "openrouter",
      estimatedPromptTokens: 100,
      estimatedCompletionTokens: 100,
      actualPromptTokens: 150,
      actualCompletionTokens: 150,
    });

    const stateA = tracker.getState("openrouter", "model-A");
    const stateB = tracker.getState("openrouter", "model-B");
    const stateOtherProvider = tracker.getState("custom-endpoint", "model-A");

    assert.ok(stateA);
    assert.strictEqual(stateA.promptFactor, 1.25);

    // Model B and custom-endpoint::model-A must be uncalibrated
    assert.strictEqual(stateB, undefined);
    assert.strictEqual(stateOtherProvider, undefined);

    // Resolving usage for Model B should fall back to raw estimate
    const markB = resolveUsageMark(
      {
        model: "model-B",
        provider: "openrouter",
        estimatedPromptTokens: 200,
        estimatedCompletionTokens: 100,
      },
      tracker,
    );
    assert.strictEqual(markB.source, "estimate");
    assert.strictEqual(markB.promptTokens, 200);
  });

  // -------------------------------------------------------------------------
  // Test 8: Missing cached_tokens preservation (undefined, never assumed 0)
  // -------------------------------------------------------------------------
  test("Test 8: missing cached_tokens remains strictly undefined (never coerced to 0)", () => {
    const tracker = new CalibrationTracker();
    const obs: UsageObservation = {
      model: "deepseek/deepseek-chat",
      provider: "openrouter",
      estimatedPromptTokens: 500,
      estimatedCompletionTokens: 200,
      actualPromptTokens: 480,
      actualCompletionTokens: 190,
      cachedTokens: undefined, // Provider omitted it
    };

    const mark = resolveUsageMark(obs, tracker);
    assert.strictEqual(mark.cachedTokens, undefined, "cachedTokens must remain undefined when omitted");
    assert.notStrictEqual(mark.cachedTokens, 0, "cachedTokens must NEVER be coerced to 0");

    // When provider explicitly reports 0, it must be recorded as 0
    const obsZero: UsageObservation = {
      ...obs,
      cachedTokens: 0,
    };
    const markZero = resolveUsageMark(obsZero, tracker);
    assert.strictEqual(markZero.cachedTokens, 0, "cachedTokens must be 0 only when explicitly reported as 0");
  });

  // -------------------------------------------------------------------------
  // Test 9: Malformed provider usage falls back safely
  // -------------------------------------------------------------------------
  test("Test 9: malformed provider usage falls back safely without throwing", () => {
    const tracker = new CalibrationTracker();

    // Negative tokens, NaN, non-numeric values
    const obsNegative: UsageObservation = {
      model: "test-model",
      estimatedPromptTokens: 100,
      estimatedCompletionTokens: 50,
      actualPromptTokens: -100 as any,
      actualCompletionTokens: NaN as any,
    };

    const mark = resolveUsageMark(obsNegative, tracker);
    assert.strictEqual(mark.source, "estimate");
    assert.strictEqual(mark.promptTokens, 100);
    assert.strictEqual(mark.completionTokens, 50);

    // Tracker should NOT have recorded any samples from malformed observation
    assert.strictEqual(tracker.getState(undefined, "test-model"), undefined);
  });

  // -------------------------------------------------------------------------
  // Test 10: Zero values division-by-zero safety
  // -------------------------------------------------------------------------
  test("Test 10: zero values do not trigger division-by-zero in errors or calibration", () => {
    const tracker = new CalibrationTracker();

    // 0 estimated tokens or 0 actual tokens
    const obsZero: UsageObservation = {
      model: "empty-model",
      estimatedPromptTokens: 0,
      estimatedCompletionTokens: 0,
      actualPromptTokens: 0,
      actualCompletionTokens: 0,
    };

    const mark = resolveUsageMark(obsZero, tracker);
    assert.strictEqual(mark.source, "provider");
    assert.strictEqual(mark.promptTokens, 0);
    assert.strictEqual(mark.completionTokens, 0);
    assert.strictEqual(mark.totalTokens, 0);
    assert.strictEqual(mark.relativePromptError, undefined);
    assert.strictEqual(mark.relativeCompletionError, undefined);

    // Relative error helper direct test
    assert.strictEqual(computeRelativeError(100, 0), undefined);
    assert.strictEqual(computeRelativeError(0, 0), undefined);
    assert.strictEqual(computeRelativeError(100, -5), undefined);
  });

  // -------------------------------------------------------------------------
  // Test 11: Retry accounting does not double count and aggregates accurately
  // -------------------------------------------------------------------------
  test("Test 11: multi-request retry accounting produces distinct records and aggregates explicitly", () => {
    process.env.DAXIOM_USAGE_MARK = "1";
    const usageTracker = new UsageTracker();
    usageTracker.reset(true);

    const messages: ChatMessage[] = [{ role: "user", content: "Implement a feature" }];

    // Request A: empty / failed turn (burned 1000 prompt tokens, 500 completion tokens)
    const turnA = {
      content: "",
      toolCalls: [],
      finishReason: "length",
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500,
        cost: 0.002,
      },
    };
    const recA = usageTracker.recordUsage("m1", messages, turnA, "tool_decision");

    // Request B: successful retry turn (consumed 1100 prompt tokens, 600 completion tokens)
    const turnB = {
      content: "Here is the code",
      toolCalls: [],
      finishReason: "stop",
      usage: {
        prompt_tokens: 1100,
        completion_tokens: 600,
        total_tokens: 1700,
        cost: 0.0025,
      },
    };
    const recB = usageTracker.recordUsage("m1", messages, turnB, "tool_decision");

    // Verify distinct records
    assert.strictEqual(recA.promptTokens, 1000);
    assert.strictEqual(recA.completionTokens, 500);
    assert.strictEqual(recB.promptTokens, 1100);
    assert.strictEqual(recB.completionTokens, 600);

    // Verify explicit session aggregation: total = 1500 + 1700 = 3200 (not just 1700!)
    const summary = usageTracker.getSessionSummary();
    assert.strictEqual(summary.recordCount, 2);
    assert.strictEqual(summary.overall.promptTokens, 2100);
    assert.strictEqual(summary.overall.completionTokens, 1100);
    assert.strictEqual(summary.overall.totalTokens, 3200);
    assert.strictEqual(summary.byPhase.tool_decision.totalTokens, 3200);
  });

  // -------------------------------------------------------------------------
  // Test 12: Flag OFF preserves exact legacy behavior
  // -------------------------------------------------------------------------
  test("Test 12: DAXIOM_USAGE_MARK=0 preserves exact legacy behavior", () => {
    process.env.DAXIOM_USAGE_MARK = "0";
    assert.strictEqual(isUsageMarkEnabled(), false);

    const usageTracker = new UsageTracker();
    usageTracker.reset(true);

    // Call recordUsage with no rawUsage
    const recEst = usageTracker.recordUsage(
      "m",
      [{ role: "user", content: "hello world" }],
      { content: "response text", toolCalls: [] },
      "explain",
    );

    assert.strictEqual(recEst.estimated, true);
    assert.strictEqual(recEst.usageMark, undefined, "No usageMark should be attached when flag is OFF");
    assert.ok(recEst.promptTokens > 0);
    assert.ok(recEst.completionTokens > 0);

    // Call recordUsage with rawUsage
    const recReal = usageTracker.recordUsage(
      "m",
      [],
      { content: "hi", toolCalls: [] },
      "explain",
      { prompt_tokens: 42, completion_tokens: 18 },
    );

    assert.strictEqual(recReal.estimated, false);
    assert.strictEqual(recReal.usageMark, undefined, "No usageMark should be attached when flag is OFF");
    assert.strictEqual(recReal.promptTokens, 42);
    assert.strictEqual(recReal.completionTokens, 18);
  });

  // -------------------------------------------------------------------------
  // Test 13: Streaming final chunk usage propagation
  // -------------------------------------------------------------------------
  test("Test 13: streaming final chunk usage is received by AssistantTurn and UsageMark", () => {
    process.env.DAXIOM_USAGE_MARK = "1";
    const usageTracker = new UsageTracker();
    usageTracker.reset(true);

    // Simulate an AssistantTurn resulting from a stream that had a final usage chunk
    const streamedTurn: AssistantTurn = {
      content: "Done processing",
      toolCalls: [],
      finishReason: "stop",
      usage: {
        prompt_tokens: 350,
        completion_tokens: 120,
        total_tokens: 470,
        prompt_tokens_details: { cached_tokens: 50 },
      },
    };

    const rec = usageTracker.recordUsage("streaming-model", [], streamedTurn, "edit");

    assert.strictEqual(rec.estimated, false);
    assert.ok(rec.usageMark);
    assert.strictEqual(rec.usageMark.source, "provider");
    assert.strictEqual(rec.usageMark.promptTokens, 350);
    assert.strictEqual(rec.usageMark.completionTokens, 120);
    assert.strictEqual(rec.usageMark.cachedTokens, 50);
  });

  // -------------------------------------------------------------------------
  // Test 14: Streaming without usage graceful fallback
  // -------------------------------------------------------------------------
  test("Test 14: streaming without usage falls back gracefully to calibrated/raw estimate", () => {
    process.env.DAXIOM_USAGE_MARK = "1";
    const usageTracker = new UsageTracker();
    usageTracker.reset(true);

    // Stream finished without any usage chunk
    const streamedTurn: AssistantTurn = {
      content: "No usage reported here",
      toolCalls: [],
      finishReason: "stop",
      usage: undefined,
    };

    const rec = usageTracker.recordUsage(
      "streaming-no-usage",
      [{ role: "user", content: "Query without stream usage" }],
      streamedTurn,
      "tool_decision",
    );

    assert.strictEqual(rec.estimated, true);
    assert.ok(rec.usageMark);
    assert.strictEqual(rec.usageMark.source, "estimate");
    assert.ok(rec.promptTokens > 0);
    assert.ok(rec.completionTokens > 0);
  });

  // -------------------------------------------------------------------------
  // Test 15: Reasoning token preservation
  // -------------------------------------------------------------------------
  test("Test 15: reasoning tokens preserved when reported and undefined when absent", () => {
    process.env.DAXIOM_USAGE_MARK = "1";
    const usageTracker = new UsageTracker();
    usageTracker.reset(true);

    // When reported
    const turnWithReasoning: AssistantTurn = {
      content: "Thinking finished",
      toolCalls: [],
      finishReason: "stop",
      usage: {
        prompt_tokens: 500,
        completion_tokens: 400,
        completion_tokens_details: { reasoning_tokens: 250 },
      },
    };
    const rec1 = usageTracker.recordUsage("reasoning-model", [], turnWithReasoning, "tool_decision");
    assert.ok(rec1.usageMark);
    assert.strictEqual(rec1.usageMark.reasoningTokens, 250);

    // When absent
    const turnWithoutReasoning: AssistantTurn = {
      content: "Direct answer",
      toolCalls: [],
      finishReason: "stop",
      usage: {
        prompt_tokens: 300,
        completion_tokens: 100,
      },
    };
    const rec2 = usageTracker.recordUsage("reasoning-model", [], turnWithoutReasoning, "tool_decision");
    assert.ok(rec2.usageMark);
    assert.strictEqual(rec2.usageMark.reasoningTokens, undefined);
  });

  // -------------------------------------------------------------------------
  // Test 16: Multi-turn Deterministic Replay Benchmark & Accuracy Evaluation
  // -------------------------------------------------------------------------
  test("Test 16: multi-turn deterministic replay benchmark measures error reduction after calibration", () => {
    process.env.DAXIOM_USAGE_MARK = "1";
    const tracker = new CalibrationTracker(0.2); // alpha = 0.2

    // 10-turn multi-turn deterministic replay with actual vs heuristic tokens
    // Ground truth: actual tokens are ~15% higher than heuristic estimate
    const replayTurns = [
      { estP: 300, actP: 345, estC: 80, actC: 96 },
      { estP: 450, actP: 518, estC: 120, actC: 144 },
      { estP: 600, actP: 690, estC: 150, actC: 180 },
      { estP: 800, actP: 920, estC: 200, actC: 240 },
      { estP: 1000, actP: 1150, estC: 250, actC: 300 },
      { estP: 1200, actP: 1380, estC: 300, actC: 360 },
      { estP: 1400, actP: 1610, estC: 350, actC: 420 },
      { estP: 1600, actP: 1840, estC: 400, actC: 480 },
      { estP: 1800, actP: 2070, estC: 450, actC: 540 },
      { estP: 2000, actP: 2300, estC: 500, actC: 600 },
    ];

    // Train the calibrator on the first 5 turns
    for (let i = 0; i < 5; i++) {
      const turn = replayTurns[i];
      resolveUsageMark(
        {
          model: "benchmark-model",
          provider: "test-provider",
          estimatedPromptTokens: turn.estP,
          estimatedCompletionTokens: turn.estC,
          actualPromptTokens: turn.actP,
          actualCompletionTokens: turn.actC,
        },
        tracker,
      );
    }

    const trainedState = tracker.getState("test-provider", "benchmark-model");
    assert.ok(trainedState);
    assert.strictEqual(trainedState.sampleCount, 5);
    // Factor has moved toward 1.15
    assert.ok(trainedState.promptFactor > 1.05 && trainedState.promptFactor <= 1.16);

    // Evaluate error on remaining 5 turns if provider usage was missing (testing calibrated estimate vs raw estimate)
    let rawPromptErrorSum = 0;
    let calibratedPromptErrorSum = 0;

    for (let i = 5; i < 10; i++) {
      const turn = replayTurns[i];
      // Raw error
      rawPromptErrorSum += Math.abs(turn.estP - turn.actP);

      // Calibrated mark
      const calMark = resolveUsageMark(
        {
          model: "benchmark-model",
          provider: "test-provider",
          estimatedPromptTokens: turn.estP,
          estimatedCompletionTokens: turn.estC,
          // Actual usage absent -> uses calibrated estimate
        },
        tracker,
      );

      assert.strictEqual(calMark.source, "calibrated-estimate");
      calibratedPromptErrorSum += Math.abs(calMark.promptTokens - turn.actP);
    }

    const avgRawError = rawPromptErrorSum / 5;
    const avgCalibratedError = calibratedPromptErrorSum / 5;

    // Calibrated estimation should strictly reduce mean absolute error
    assert.ok(
      avgCalibratedError < avgRawError,
      `Calibrated error (${avgCalibratedError}) should be lower than raw error (${avgRawError})`,
    );
  });
});
