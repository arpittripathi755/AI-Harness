/**
 * Central Model Registry — the single source of truth mapping user-facing display
 * names to Lightning API model IDs. Imported by BOTH bundles: the webview shows
 * `displayName`, the extension sends `apiModelId`. Add/remove a model here only.
 *
 * The canonical evaluation model is "deepseek/deepseek-v4.1-flash". It is kept in
 * sync with CANONICAL_MODEL in src/llm/providers.ts — do not change one without
 * the other.
 */

export interface ModelInfo {
  /** Shown in the UI dropdown. */
  displayName: string;
  /** Sent as the `model` field to the Lightning chat/completions API. */
  apiModelId: string;
  /**
   * Whether this model supports function/tool calling via the chat/completions
   * API on this endpoint. Defaults to true. Some models (e.g. GPT-5.5) only
   * support tools via a different API and would 400 if we sent `tools`, so we
   * run them as plain chat instead. Set false to disable tool use for a model.
   */
  supportsTools?: boolean;
  /**
   * Whether this model accepts image inputs (vision). Defaults to true. When
   * false, attached images are omitted from the request rather than 400ing.
   */
  supportsVision?: boolean;
  /**
   * Which endpoint API to use. "chat" = /chat/completions (default), "responses"
   * = OpenAI /v1/responses (required by some models like GPT-5.5 for tool use).
   */
  api?: "chat" | "responses";
}

export const MODELS: ModelInfo[] = [
  /**
   * Canonical evaluation model — matches CANONICAL_MODEL in src/llm/providers.ts.
   * This MUST remain "deepseek/deepseek-v4.1-flash".
   */
  {
    displayName: "deepseek/deepseek-v4.1-flash",
    apiModelId: "deepseek/deepseek-v4.1-flash",
    supportsVision: false,
  },
  {
    displayName: "ultra",
    apiModelId: "nvidia/nemotron-3-ultra-550b-a55b",
    supportsVision: false,
  },
  {
    displayName: "deepseek-v4-pro",
    apiModelId: "deepseek-v4-pro",
    supportsVision: false,
  },
  {
    displayName: "deepseek-flash",
    apiModelId: "deepseek-flash",
    supportsVision: false,
  },
];

/**
 * Default evaluation model — the canonical DeepSeek model.
 * Must stay in sync with CANONICAL_MODEL in src/llm/providers.ts.
 */
export const DEFAULT_MODEL_ID = "deepseek/deepseek-v4.1-flash";

export function getModelByApiId(apiModelId: string): ModelInfo | undefined {
  const resolved = resolveModelId(apiModelId);
  return MODELS.find((m) => m.apiModelId === resolved || m.apiModelId === apiModelId);
}

/** Whether a model supports function/tool calling on this endpoint (default true). */
export function modelSupportsTools(apiModelId: string): boolean {
  return getModelByApiId(apiModelId)?.supportsTools !== false;
}

/** Whether a model accepts image inputs (default true). */
export function modelSupportsVision(apiModelId: string): boolean {
  return getModelByApiId(apiModelId)?.supportsVision !== false;
}

/** Which endpoint API a model uses ("chat" by default). */
export function modelApi(apiModelId: string): "chat" | "responses" {
  return getModelByApiId(apiModelId)?.api ?? "chat";
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
  // Aliases for the canonical evaluation model
  if (
    trimmed === "deepseek-v4.1-flash" ||
    trimmed === "deepseek-flash" ||
    trimmed === "deepseek-ai/deepseek-v4.1-flash" ||
    trimmed === "deepseek v4"
  ) {
    return "deepseek/deepseek-v4.1-flash";
  }
  if (
    trimmed === "ultra" ||
    trimmed === "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b"
  ) {
    return "nvidia/nemotron-3-ultra-550b-a55b";
  }
  if (
    trimmed === "deepseek-v4-pro" ||
    trimmed === "deepseek-ai/deepseek-v4-pro"
  ) {
    return "deepseek-v4-pro";
  }
  // If an explicit model name was supplied, respect it rather than overwriting
  return trimmed;
}
