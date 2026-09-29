/**
 * Central Model Registry — the single source of truth mapping user-facing display
 * names to OpenRouter API model IDs. Imported by BOTH bundles: the webview shows
 * `displayName`, the extension and TUI send `apiModelId`. Add/remove a model here only.
 *
 * Every model registered here must use its exact OpenRouter identifier: "provider/model-name".
 *
 * The canonical evaluation model is "deepseek/deepseek-v4.1-flash". It is imported by
 * CANONICAL_MODEL in src/llm/providers.ts to maintain a single source of truth.
 */

export interface ModelInfo {
  /** Shown in the UI dropdown and TUI /models output. */
  displayName: string;
  /** Sent as the `model` field to the OpenRouter chat/completions API. */
  apiModelId: string;
  /** Provider/family group (e.g. "DeepSeek", "Qwen", "NVIDIA"). */
  provider?: "DeepSeek" | "Qwen" | "NVIDIA" | string;
  /** Context window limit in tokens. */
  contextLength?: number;
  /** Maximum output token generation limit if restricted by the model. */
  maxOutputTokens?: number;
  /**
   * Whether this model supports function/tool calling via the chat/completions
   * API on this endpoint. Defaults to true.
   */
  supportsTools?: boolean;
  /**
   * Whether this model accepts image inputs (vision). Defaults to false.
   */
  supportsVision?: boolean;
  /**
   * Cost in USD per completion token (e.g. 0.00000028 for $0.28 / 1M tokens).
   */
  completionPricePerToken?: number;
  /**
   * Which endpoint API to use. "chat" = /chat/completions (default), "responses"
   * = OpenAI /v1/responses.
   */
  api?: "chat" | "responses";
}

export const MODELS: ModelInfo[] = [
  // ==========================================
  // DeepSeek Models (Verified on OpenRouter)
  // ==========================================
  {
    displayName: "DeepSeek V4.1 Flash",
    apiModelId: "deepseek/deepseek-v4.1-flash",
    provider: "DeepSeek",
    contextLength: 1048576,
    supportsTools: true,
    supportsVision: false,
  },
  {
    displayName: "DeepSeek V4 Pro",
    apiModelId: "deepseek/deepseek-v4-pro",
    provider: "DeepSeek",
    contextLength: 1048576,
    supportsTools: true,
    supportsVision: false,
  },
  {
    displayName: "DeepSeek V4 Flash",
    apiModelId: "deepseek/deepseek-v4-flash",
    provider: "DeepSeek",
    contextLength: 1048576,
    supportsTools: true,
    supportsVision: false,
  },
  {
    displayName: "DeepSeek V3",
    apiModelId: "deepseek/deepseek-chat",
    provider: "DeepSeek",
    contextLength: 163840,
    supportsTools: true,
    supportsVision: false,
  },
  {
    displayName: "DeepSeek R1",
    apiModelId: "deepseek/deepseek-r1",
    provider: "DeepSeek",
    contextLength: 64000,
    supportsTools: true,
    supportsVision: false,
  },

  // ==========================================
  // Qwen Models (Verified on OpenRouter)
  // ==========================================
  {
    displayName: "Qwen3 Coder 480B",
    apiModelId: "qwen/qwen3-coder",
    provider: "Qwen",
    contextLength: 262144,
    supportsTools: true,
    supportsVision: false,
  },
  {
    displayName: "Qwen3 Coder Plus",
    apiModelId: "qwen/qwen3-coder-plus",
    provider: "Qwen",
    contextLength: 1000000,
    supportsTools: true,
    supportsVision: false,
  },
  {
    displayName: "Qwen3 Coder Flash",
    apiModelId: "qwen/qwen3-coder-flash",
    provider: "Qwen",
    contextLength: 1000000,
    supportsTools: true,
    supportsVision: false,
  },
  {
    displayName: "Qwen3.8 Flash",
    apiModelId: "qwen/qwen3.8-flash",
    provider: "Qwen",
    contextLength: 1000000,
    supportsTools: true,
    supportsVision: false,
  },
  {
    displayName: "Qwen2.5 72B Instruct",
    apiModelId: "qwen/qwen-2.5-72b-instruct",
    provider: "Qwen",
    contextLength: 32768,
    supportsTools: true,
    supportsVision: false,
  },
  {
    displayName: "Qwen Plus",
    apiModelId: "qwen/qwen-plus",
    provider: "Qwen",
    contextLength: 1000000,
    supportsTools: true,
    supportsVision: false,
  },

  // ==========================================
  // NVIDIA Models (Verified on OpenRouter)
  // ==========================================
  {
    displayName: "Nemotron 3 Ultra 550B",
    apiModelId: "nvidia/nemotron-3-ultra-550b-a55b",
    provider: "NVIDIA",
    contextLength: 262144,
    supportsTools: true,
    supportsVision: false,
  },
];

/**
 * Default evaluation model — the canonical DeepSeek model.
 * Single source of truth across DAXIOM.
 */
export const DEFAULT_MODEL_ID = "deepseek/deepseek-v4.1-flash";

/**
 * Sensible default token budget for assistant completions (16,384 tokens).
 * Optimizes agent turns while avoiding OpenRouter 402 "credit limit" errors.
 */
export const DEFAULT_MAX_TOKENS = 16384;

/**
 * Safely parse and validate a token budget value.
 * Falls back to DEFAULT_MAX_TOKENS (16384) for invalid, non-positive, or non-finite inputs.
 */
export function resolveMaxTokens(raw?: string | number): number {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_MAX_TOKENS;
  }
  const val = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(val) || val <= 0 || !Number.isInteger(val)) {
    return DEFAULT_MAX_TOKENS;
  }
  return val;
}

/** Get the active max_tokens budget from environment (MAX_TOKENS or AI_MAX_TOKENS) or fallback to default. */
export function getMaxTokens(override?: number): number {
  if (override !== undefined) {
    return resolveMaxTokens(override);
  }
  const proc = typeof globalThis !== "undefined" ? (globalThis as any).process : undefined;
  const envVal = proc?.env?.MAX_TOKENS?.trim() || proc?.env?.AI_MAX_TOKENS?.trim();
  return resolveMaxTokens(envVal);
}

/**
 * Determine the effective max_tokens for a given model, respecting model-specific
 * output limits (if any) and requested/environment overrides.
 */
export function getModelMaxTokens(apiModelId: string, requestedMaxTokens?: number): number {
  const base = resolveMaxTokens(requestedMaxTokens ?? getMaxTokens());
  const model = getModelByApiId(apiModelId);
  if (model?.maxOutputTokens && model.maxOutputTokens < base) {
    return model.maxOutputTokens;
  }
  return base;
}

export function getModelByApiId(apiModelId: string): ModelInfo | undefined {
  const resolved = resolveModelId(apiModelId);
  return MODELS.find((m) => m.apiModelId === resolved || m.apiModelId === apiModelId);
}

/**
 * Return the human-friendly display name for an OpenRouter model ID if registered in MODELS,
 * or return the raw model ID as-is for unregistered / custom models.
 * Never falls back to DeepSeek V4.1 Flash for unknown models.
 */
export function getModelDisplayName(apiModelId: string | undefined): string {
  const trimmed = apiModelId?.trim();
  if (!trimmed) {
    const defaultModel = getModelByApiId(DEFAULT_MODEL_ID);
    return defaultModel?.displayName ?? DEFAULT_MODEL_ID;
  }
  const resolved = resolveModelId(trimmed);
  const model = MODELS.find((m) => m.apiModelId === resolved || m.apiModelId === trimmed);
  return model?.displayName ?? trimmed;
}

/** Whether a model supports function/tool calling on this endpoint (default true). */
export function modelSupportsTools(apiModelId: string): boolean {
  return getModelByApiId(apiModelId)?.supportsTools !== false;
}

/** Whether a model accepts image inputs (default false). */
export function modelSupportsVision(apiModelId: string): boolean {
  return getModelByApiId(apiModelId)?.supportsVision === true;
}

/** Which endpoint API a model uses ("chat" by default). */
export function modelApi(apiModelId: string): "chat" | "responses" {
  return getModelByApiId(apiModelId)?.api ?? "chat";
}

/** Whether a model ID conforms to OpenRouter's namespaced format "provider/model-name". */
export function isOpenRouterModelId(modelId: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(modelId.trim());
}

/** Check if a model is explicitly in the registered list. */
export function isRegisteredModelId(apiModelId: string): boolean {
  const resolved = resolveModelId(apiModelId);
  return MODELS.some((m) => m.apiModelId === resolved);
}

/** Resolve a stored/selected api id to a valid one, falling back to the default. */
export function resolveModelId(apiModelId: string | undefined): string {
  const trimmed = apiModelId?.trim();
  if (!trimmed) {
    return DEFAULT_MODEL_ID;
  }
  if (MODELS.some((m) => m.apiModelId === trimmed)) {
    return trimmed;
  }

  // Strip legacy provider namespace prefixes if present (e.g. lightning-ai/ or openrouter/)
  let candidate = trimmed;
  while (candidate.startsWith("lightning-ai/") || candidate.startsWith("openrouter/")) {
    if (candidate.startsWith("lightning-ai/")) {
      candidate = candidate.slice("lightning-ai/".length);
    } else if (candidate.startsWith("openrouter/")) {
      candidate = candidate.slice("openrouter/".length);
    }
  }

  if (MODELS.some((m) => m.apiModelId === candidate)) {
    return candidate;
  }

  // Aliases for NVIDIA models
  if (
    candidate === "ultra" ||
    candidate === "nemotron" ||
    candidate === "nemotron-3-ultra-550b-a55b" ||
    candidate === "nvidia-nemotron-3-ultra-550b-a55b" ||
    candidate === "nvidia/nemotron-3-ultra-550b-a55b"
  ) {
    return "nvidia/nemotron-3-ultra-550b-a55b";
  }

  // Aliases for DeepSeek models
  if (
    candidate === "deepseek-v4.1-flash" ||
    candidate === "deepseek-ai/deepseek-v4.1-flash" ||
    candidate === "deepseek v4.1 flash"
  ) {
    return "deepseek/deepseek-v4.1-flash";
  }
  if (
    candidate === "deepseek-flash" ||
    candidate === "deepseek-v4-flash" ||
    candidate === "deepseek-ai/deepseek-v4-flash"
  ) {
    return "deepseek/deepseek-v4-flash";
  }
  if (
    candidate === "deepseek-v4-pro" ||
    candidate === "deepseek-ai/deepseek-v4-pro"
  ) {
    return "deepseek/deepseek-v4-pro";
  }
  if (
    candidate === "deepseek-chat" ||
    candidate === "deepseek-v3" ||
    candidate === "deepseek-ai/deepseek-chat"
  ) {
    return "deepseek/deepseek-chat";
  }
  if (candidate === "deepseek-r1" || candidate === "deepseek-ai/deepseek-r1") {
    return "deepseek/deepseek-r1";
  }

  // Aliases for Qwen models
  if (
    candidate === "qwen3-coder" ||
    candidate === "qwen-coder" ||
    candidate === "qwen/qwen3-coder-480b"
  ) {
    return "qwen/qwen3-coder";
  }
  if (candidate === "qwen3-coder-plus") {
    return "qwen/qwen3-coder-plus";
  }
  if (candidate === "qwen3-coder-flash") {
    return "qwen/qwen3-coder-flash";
  }
  if (candidate === "qwen3.8-flash") {
    return "qwen/qwen3.8-flash";
  }
  if (
    candidate === "qwen-2.5-72b" ||
    candidate === "qwen-2.5-72b-instruct" ||
    candidate === "qwen/qwen2.5-72b-instruct"
  ) {
    return "qwen/qwen-2.5-72b-instruct";
  }
  if (candidate === "qwen-plus") {
    return "qwen/qwen-plus";
  }

  // If an explicit model name was supplied (e.g. any custom OpenRouter model slug),
  // return candidate with prefixes stripped rather than falling back to default.
  return candidate;
}
