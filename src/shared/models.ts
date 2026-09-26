/**
 * Central Model Registry — the single source of truth mapping user-facing display
 * names to Lightning API model IDs. Imported by BOTH bundles: the webview shows
 * `displayName`, the extension sends `apiModelId`. Add/remove a model here only.
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
  {
    displayName: "ultra",
    apiModelId: "nvidia/nemotron-3-ultra-550b-a55b",
    // Text-only model; omit images rather than risk a 400.
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

/** Default evaluation model (text-only, supportsVision: false). */
export const DEFAULT_MODEL_ID = "nvidia/nemotron-3-ultra-550b-a55b";

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
  if (!apiModelId) {
    return DEFAULT_MODEL_ID;
  }
  if (MODELS.some((m) => m.apiModelId === apiModelId)) {
    return apiModelId;
  }
  if (
    apiModelId === "ultra" ||
    apiModelId === "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b"
  ) {
    return "nvidia/nemotron-3-ultra-550b-a55b";
  }
  if (
    apiModelId === "deepseek-v4-pro" ||
    apiModelId === "deepseek-ai/deepseek-v4-pro"
  ) {
    return "deepseek-v4-pro";
  }
  if (
    apiModelId === "deepseek-flash" ||
    apiModelId === "deepseek-ai/deepseek-v4.1-flash" ||
    apiModelId === "deepseek v4"
  ) {
    return "deepseek-flash";
  }
  return DEFAULT_MODEL_ID;
}
