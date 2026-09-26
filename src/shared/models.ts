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
    displayName: "Nemotron 550B",
    apiModelId: "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b",
    // Text-only model; omit images rather than risk a 400.
    supportsVision: false,
  },
  { displayName: "Claude Fable 5", apiModelId: "anthropic/claude-fable-5" },
  { displayName: "Claude Opus 4.8", apiModelId: "anthropic/claude-opus-4-8" },
  { displayName: "Gemini 3.5 Flash", apiModelId: "google/gemini-3.5-flash" },
  { displayName: "5.3 codex", apiModelId: "gpt-5.3-codex" },
  {
    displayName: "GPT-5.5",
    apiModelId: "openai/gpt-5.5-2026-04-23",
    // GPT-5.5 rejects function tools on chat/completions, so it uses the
    // /v1/responses API (which supports tools) instead.
    api: "responses",
  },
  { displayName: "Claude Opus 4.7", apiModelId: "anthropic/claude-opus-4-7" },
  {
    displayName: "Claude Sonnet 4.6",
    apiModelId: "anthropic/claude-sonnet-4-6",
  },
  {
    displayName: "Claude Sonnet 4.5",
    apiModelId: "anthropic/claude-sonnet-4-5-20250929",
  },
  {
    displayName: "ultra",
    apiModelId: "nvidia/nemotron-3-ultra-550b-a55b",
  },
  {
    displayName: "deepseek v4",
    apiModelId: "deepseek-ai/deepseek-v4.1-flash",
  },
  {
    displayName: "kimi",
    apiModelId: "moonshotai/kimi-k3",
  },
];

/** Default evaluation model (text-only, supportsVision: false). */
export const DEFAULT_MODEL_ID = "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b";

export function getModelByApiId(apiModelId: string): ModelInfo | undefined {
  return MODELS.find((m) => m.apiModelId === apiModelId);
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
  if (apiModelId && MODELS.some((m) => m.apiModelId === apiModelId)) {
    return apiModelId;
  }
  return DEFAULT_MODEL_ID;
}
