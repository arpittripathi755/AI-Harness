import * as assert from "assert";
import {
  MODELS,
  DEFAULT_MODEL_ID,
  getModelByApiId,
  modelSupportsTools,
  modelSupportsVision,
  modelApi,
  isOpenRouterModelId,
  isRegisteredModelId,
  resolveModelId,
  DEFAULT_MAX_TOKENS,
  resolveMaxTokens,
  getMaxTokens,
  getModelMaxTokens,
  getModelDisplayName,
} from "../shared/models";

suite("OpenRouter Model Registry", () => {
  test("contains only namespaced OpenRouter model IDs (provider/model-name)", () => {
    assert.ok(MODELS.length > 0, "MODELS registry should not be empty");
    for (const model of MODELS) {
      assert.match(
        model.apiModelId,
        /^[^/\s]+\/[^/\s]+$/,
        `Model ID '${model.apiModelId}' must match provider/model-name format`,
      );
    }
  });

  test("legacy models from old backends are completely removed", () => {
    const legacyIds = [
      "ultra",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b",
      "deepseek-flash",
      "deepseek-v4-pro",
    ];
    for (const legacy of legacyIds) {
      const found = MODELS.find((m) => m.apiModelId === legacy);
      assert.strictEqual(
        found,
        undefined,
        `Legacy model ID '${legacy}' must not be present in MODELS registry`,
      );
    }
  });

  test("contains verified DeepSeek models", () => {
    const expectedDeepSeek = [
      "deepseek/deepseek-v4.1-flash",
      "deepseek/deepseek-v4-pro",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-chat",
      "deepseek/deepseek-r1",
    ];
    for (const id of expectedDeepSeek) {
      const found = MODELS.find((m) => m.apiModelId === id);
      assert.ok(found, `Expected DeepSeek model '${id}' to be in MODELS`);
      assert.strictEqual(found?.provider, "DeepSeek");
      assert.strictEqual(found?.supportsTools, true);
      assert.ok((found?.contextLength ?? 0) > 0, `Model '${id}' must have contextLength`);
    }
  });

  test("contains verified Qwen models", () => {
    const expectedQwen = [
      "qwen/qwen3-coder",
      "qwen/qwen3-coder-plus",
      "qwen/qwen3-coder-flash",
      "qwen/qwen3.8-flash",
      "qwen/qwen-2.5-72b-instruct",
      "qwen/qwen-plus",
    ];
    for (const id of expectedQwen) {
      const found = MODELS.find((m) => m.apiModelId === id);
      assert.ok(found, `Expected Qwen model '${id}' to be in MODELS`);
      assert.strictEqual(found?.provider, "Qwen");
      assert.strictEqual(found?.supportsTools, true);
      assert.ok((found?.contextLength ?? 0) > 0, `Model '${id}' must have contextLength`);
    }
  });

  test("display names are human-friendly and distinct from apiModelIds", () => {
    for (const model of MODELS) {
      assert.ok(model.displayName.length > 0, "Display name must not be empty");
      // Display name should not just be the raw namespaced ID
      assert.notStrictEqual(
        model.displayName,
        model.apiModelId,
        `Display name should be human-friendly, got '${model.displayName}' matching apiModelId`,
      );
    }
  });

  test("all registered models support tool calling", () => {
    for (const model of MODELS) {
      assert.strictEqual(
        modelSupportsTools(model.apiModelId),
        true,
        `Model '${model.apiModelId}' must support tools for Daxiom agent workflows`,
      );
    }
  });

  test("DEFAULT_MODEL_ID is valid and exists in MODELS", () => {
    assert.strictEqual(DEFAULT_MODEL_ID, "deepseek/deepseek-v4.1-flash");
    const found = MODELS.find((m) => m.apiModelId === DEFAULT_MODEL_ID);
    assert.ok(found, "DEFAULT_MODEL_ID must exist in MODELS registry");
  });

  test("resolveModelId falls back to DEFAULT_MODEL_ID for empty input", () => {
    assert.strictEqual(resolveModelId(undefined), DEFAULT_MODEL_ID);
    assert.strictEqual(resolveModelId(""), DEFAULT_MODEL_ID);
    assert.strictEqual(resolveModelId("   "), DEFAULT_MODEL_ID);
  });

  test("resolveModelId correctly resolves DeepSeek aliases", () => {
    assert.strictEqual(resolveModelId("deepseek-v4.1-flash"), "deepseek/deepseek-v4.1-flash");
    assert.strictEqual(resolveModelId("deepseek-flash"), "deepseek/deepseek-v4-flash");
    assert.strictEqual(resolveModelId("deepseek-v4-flash"), "deepseek/deepseek-v4-flash");
    assert.strictEqual(resolveModelId("deepseek-v4-pro"), "deepseek/deepseek-v4-pro");
    assert.strictEqual(resolveModelId("deepseek-chat"), "deepseek/deepseek-chat");
    assert.strictEqual(resolveModelId("deepseek-v3"), "deepseek/deepseek-chat");
    assert.strictEqual(resolveModelId("deepseek-r1"), "deepseek/deepseek-r1");
  });

  test("resolveModelId correctly resolves Qwen aliases", () => {
    assert.strictEqual(resolveModelId("qwen3-coder"), "qwen/qwen3-coder");
    assert.strictEqual(resolveModelId("qwen-coder"), "qwen/qwen3-coder");
    assert.strictEqual(resolveModelId("qwen3-coder-plus"), "qwen/qwen3-coder-plus");
    assert.strictEqual(resolveModelId("qwen3-coder-flash"), "qwen/qwen3-coder-flash");
    assert.strictEqual(resolveModelId("qwen3.8-flash"), "qwen/qwen3.8-flash");
    assert.strictEqual(resolveModelId("qwen-2.5-72b"), "qwen/qwen-2.5-72b-instruct");
    assert.strictEqual(resolveModelId("qwen-plus"), "qwen/qwen-plus");
  });

  test("resolveModelId preserves explicit custom OpenRouter model IDs", () => {
    assert.strictEqual(resolveModelId("openai/gpt-4o"), "openai/gpt-4o");
    assert.strictEqual(
      resolveModelId("anthropic/claude-3.5-sonnet"),
      "anthropic/claude-3.5-sonnet",
    );
    assert.strictEqual(
      resolveModelId("meta-llama/llama-3.3-70b-instruct"),
      "meta-llama/llama-3.3-70b-instruct",
    );
  });

  test("isOpenRouterModelId correctly validates OpenRouter identifier format", () => {
    assert.strictEqual(isOpenRouterModelId("deepseek/deepseek-v4.1-flash"), true);
    assert.strictEqual(isOpenRouterModelId("qwen/qwen3-coder"), true);
    assert.strictEqual(isOpenRouterModelId("openai/gpt-4o"), true);
    assert.strictEqual(isOpenRouterModelId("invalid-no-slash"), false);
    assert.strictEqual(isOpenRouterModelId("/no-org"), false);
    assert.strictEqual(isOpenRouterModelId("no-model/"), false);
  });

  test("isRegisteredModelId distinguishes registered vs custom models", () => {
    assert.strictEqual(isRegisteredModelId("deepseek/deepseek-v4.1-flash"), true);
    assert.strictEqual(isRegisteredModelId("qwen/qwen3-coder"), true);
    assert.strictEqual(isRegisteredModelId("deepseek-chat"), true); // via alias
    assert.strictEqual(isRegisteredModelId("custom/unregistered-model"), false);
  });
});

suite("Token Budget Configuration", () => {
  const originalMaxTokens = process.env.MAX_TOKENS;
  const originalAiMaxTokens = process.env.AI_MAX_TOKENS;

  teardown(() => {
    if (originalMaxTokens === undefined) {
      delete process.env.MAX_TOKENS;
    } else {
      process.env.MAX_TOKENS = originalMaxTokens;
    }
    if (originalAiMaxTokens === undefined) {
      delete process.env.AI_MAX_TOKENS;
    } else {
      process.env.AI_MAX_TOKENS = originalAiMaxTokens;
    }
  });

  test("DEFAULT_MAX_TOKENS is 16384", () => {
    assert.strictEqual(DEFAULT_MAX_TOKENS, 16384);
  });

  test("resolveMaxTokens returns DEFAULT_MAX_TOKENS when undefined", () => {
    delete process.env.MAX_TOKENS;
    delete process.env.AI_MAX_TOKENS;
    assert.strictEqual(resolveMaxTokens(undefined), 16384);
  });

  test("resolveMaxTokens accepts valid custom positive number", () => {
    assert.strictEqual(resolveMaxTokens(8192), 8192);
    assert.strictEqual(resolveMaxTokens(4096), 4096);
  });

  test("resolveMaxTokens safely falls back on invalid values (0, negative, NaN, non-integer)", () => {
    assert.strictEqual(resolveMaxTokens(0), 16384);
    assert.strictEqual(resolveMaxTokens(-1), 16384);
    assert.strictEqual(resolveMaxTokens(-100), 16384);
    assert.strictEqual(resolveMaxTokens(NaN), 16384);
    assert.strictEqual(resolveMaxTokens(Infinity), 16384);
  });

  test("getMaxTokens reads MAX_TOKENS environment variable", () => {
    process.env.MAX_TOKENS = "8192";
    delete process.env.AI_MAX_TOKENS;
    assert.strictEqual(getMaxTokens(), 8192);
  });

  test("getMaxTokens reads AI_MAX_TOKENS environment variable", () => {
    delete process.env.MAX_TOKENS;
    process.env.AI_MAX_TOKENS = "4096";
    assert.strictEqual(getMaxTokens(), 4096);
  });

  test("getMaxTokens safely falls back to default on invalid env strings", () => {
    process.env.MAX_TOKENS = "abc";
    assert.strictEqual(getMaxTokens(), 16384);

    process.env.MAX_TOKENS = "-500";
    assert.strictEqual(getMaxTokens(), 16384);

    process.env.MAX_TOKENS = "0";
    assert.strictEqual(getMaxTokens(), 16384);
  });

  test("getModelMaxTokens respects model maxOutputTokens when smaller", () => {
    // Registered models default to DEFAULT_MAX_TOKENS if no maxOutputTokens is set
    assert.strictEqual(getModelMaxTokens("deepseek/deepseek-v4.1-flash", 16384), 16384);
    // Custom override
    assert.strictEqual(getModelMaxTokens("deepseek/deepseek-v4.1-flash", 8192), 8192);
  });
});

suite("Model Display and Name Resolution", () => {
  test("Test 1: deepseek/deepseek-v4.1-flash displays 'DeepSeek V4.1 Flash'", () => {
    assert.strictEqual(
      getModelDisplayName("deepseek/deepseek-v4.1-flash"),
      "DeepSeek V4.1 Flash",
    );
  });

  test("Test 2: qwen/<model> displays 'Qwen <model name>'", () => {
    assert.strictEqual(
      getModelDisplayName("qwen/qwen3-coder"),
      "Qwen3 Coder 480B",
    );
    assert.strictEqual(
      getModelDisplayName("qwen/qwen3-coder-plus"),
      "Qwen3 Coder Plus",
    );
    assert.strictEqual(
      getModelDisplayName("qwen/qwen3-coder-flash"),
      "Qwen3 Coder Flash",
    );
    assert.strictEqual(
      getModelDisplayName("qwen/qwen3.8-flash"),
      "Qwen3.8 Flash",
    );
    assert.strictEqual(
      getModelDisplayName("qwen/qwen-2.5-72b-instruct"),
      "Qwen2.5 72B Instruct",
    );
    assert.strictEqual(
      getModelDisplayName("qwen/qwen-plus"),
      "Qwen Plus",
    );
  });

  test("Test 3: Unknown model provider/unknown-model displays exact API ID without DeepSeek fallback", () => {
    assert.strictEqual(
      getModelDisplayName("provider/unknown-model"),
      "provider/unknown-model",
    );
    assert.strictEqual(
      getModelDisplayName("meta-llama/llama-3.3-70b-instruct"),
      "meta-llama/llama-3.3-70b-instruct",
    );
    assert.strictEqual(
      getModelDisplayName("qwen/custom-experimental-model"),
      "qwen/custom-experimental-model",
    );
  });

  test("Model aliases resolve to appropriate human-friendly display names", () => {
    assert.strictEqual(
      getModelDisplayName("qwen3-coder"),
      "Qwen3 Coder 480B",
    );
    assert.strictEqual(
      getModelDisplayName("deepseek-chat"),
      "DeepSeek V3",
    );
    assert.strictEqual(
      getModelDisplayName("deepseek-r1"),
      "DeepSeek R1",
    );
  });

  test("Undefined/empty input defaults to canonical model display name", () => {
    assert.strictEqual(
      getModelDisplayName(undefined),
      "DeepSeek V4.1 Flash",
    );
    assert.strictEqual(
      getModelDisplayName(""),
      "DeepSeek V4.1 Flash",
    );
  });
});


