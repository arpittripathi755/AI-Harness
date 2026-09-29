/**
 * ProviderClient — dual-provider LLM client for DAXIOM.
 *
 * Architecture:
 *   Agent Loop
 *       │
 *   ProviderClient (this file)
 *       │
 *   ┌───┴───┐
 *   │       │
 * OpenRouter  AWSBedrock
 *   Adapter     Adapter
 *
 * The agent only calls ProviderClient.stream(). Provider-specific auth and
 * model-ID mapping are isolated inside each adapter. Credentials are read
 * from the AI_API_KEY environment variable — never hard-coded or logged.
 */

import type {
  AssistantTurn,
  ChatMessage,
  StreamEvent,
  ToolDefinition,
  ChatCompletionRequest,
  ChatCompletionChunk,
  ToolCall,
  ChatCompletionDelta,
} from "./types";
import {
  CANONICAL_MODEL,
  PROVIDER_PRIORITY,
  getModelMaxTokens,
  type ProviderConfig,
} from "./providers";
import { fetchWithRetry } from "./http";
import { type CallPhase, getPhaseMaxTokens, getReasoningFloor } from "./tokenBudget";
import {
  getAffordableTokens,
  fetchKeyInfo,
  fetchModelPrices,
  invalidateKeyInfoCache,
  AFFORDABILITY_SAFETY_MARGIN,
  MIN_RETRY_AFFORDABLE_TOKENS,
} from "./affordability";
import { classify402 } from "./classify402";
import { withGate } from "./singleFlight";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface StreamOptions {
  signal?: AbortSignal;
  tools?: ToolDefinition[];
  maxTokens?: number;
  phase?: CallPhase;
  onRetry?: (waitMs: number, attempt: number) => void;
  /** Optional model override for this stream request. */
  model?: string;
}

export interface ProviderStatus {
  name: string;
  available: boolean;
  error?: string;
}

export interface ProviderDetectionResult {
  statuses: ProviderStatus[];
  activeProvider: ProviderConfig | null;
}

// ---------------------------------------------------------------------------
// Per-provider adapters (all private to this module)
// ---------------------------------------------------------------------------

/**
 * Build request headers for OpenRouter.
 * OpenRouter uses standard Bearer auth plus a required HTTP-Referer header.
 */
function openRouterHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": "https://github.com/daxiom",
    "X-Title": "DAXIOM",
  };
}

/**
 * Build request headers for AWS Bedrock's OpenAI-compatible endpoint.
 * Bedrock's /openai/v1 proxy accepts the same Bearer token format used by
 * API Gateway / Bedrock API keys; no SigV4 signing required on this path.
 */
function awsBedrockHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function buildHeaders(
  provider: ProviderConfig,
  apiKey: string,
): Record<string, string> {
  if (provider.baseUrl.includes("openrouter.ai")) {
    return openRouterHeaders(apiKey);
  }
  if (provider.baseUrl.includes("bedrock-runtime")) {
    return awsBedrockHeaders(apiKey);
  }
  // Generic OpenAI-compatible fallback
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

// ---------------------------------------------------------------------------
// Probe a provider with a minimal chat/completions request.
// ---------------------------------------------------------------------------

/**
 * Make a lightweight authenticated request to determine whether a provider
 * is accessible and the API key is accepted.
 *
 * Uses a non-streaming single-token request so we can inspect the HTTP status
 * without consuming a full streaming response.
 *
 * Returns null on success, or an error string on failure.
 */
async function probeProvider(
  provider: ProviderConfig,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `${provider.baseUrl}chat/completions`;
  const body = JSON.stringify({
    model: provider.model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
    stream: false,
  });

  let response: Response;
  try {
    response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: buildHeaders(provider, apiKey),
        body,
      },
      { retries: 0, signal },
    );
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return "Request aborted";
    }
    // Network-level error (ECONNREFUSED, DNS, etc.)
    return `Network error: ${err?.message ?? String(err)}`;
  }

  if (response.ok) {
    return null; // success
  }

  // Read body for details but NEVER include the API key in the error message
  let detail = "";
  try {
    const text = await response.text();
    detail = text.slice(0, 200).replace(apiKey, "[REDACTED]");
  } catch {
    /* ignore read failures */
  }

  if (response.status === 401 || response.status === 403) {
    return `${provider.name} authentication failed (${response.status} ${response.statusText}). Check your OpenRouter API key.`;
  }
  if (
    response.status === 404 ||
    detail.toLowerCase().includes("model not found") ||
    detail.toLowerCase().includes("no endpoints found")
  ) {
    return `Model not found on ${provider.name}: ${provider.model}. Please select a valid OpenRouter model.`;
  }
  if (response.status === 429) {
    return `${provider.name} rate limit exceeded (429 Rate Limited). Please try again later or check your credits.`;
  }

  return `${provider.name} request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`;
}

// ---------------------------------------------------------------------------
// SSE streaming helpers (shared between adapters)
// ---------------------------------------------------------------------------

const DONE_SENTINEL = Symbol("done");

function parseSseEvent(
  rawEvent: string,
): Array<ChatCompletionChunk | typeof DONE_SENTINEL> {
  const out: Array<ChatCompletionChunk | typeof DONE_SENTINEL> = [];
  for (const line of rawEvent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice("data:".length).trim();
    if (data === "[DONE]") {
      out.push(DONE_SENTINEL);
      continue;
    }
    try {
      out.push(JSON.parse(data) as ChatCompletionChunk);
    } catch {
      /* skip keep-alive / non-JSON lines */
    }
  }
  return out;
}

class ToolCallAccumulator {
  private readonly byIndex = new Map<
    number,
    { id: string; name: string; args: string }
  >();

  add(
    fragments: NonNullable<ChatCompletionDelta["tool_calls"]>,
  ): void {
    for (const frag of fragments) {
      const entry = this.byIndex.get(frag.index) ?? {
        id: "",
        name: "",
        args: "",
      };
      if (frag.id) {
        entry.id = frag.id;
      }
      if (frag.function?.name) {
        entry.name = frag.function.name;
      }
      if (frag.function?.arguments) {
        entry.args += frag.function.arguments;
      }
      this.byIndex.set(frag.index, entry);
    }
  }

  finalize(): ToolCall[] {
    return [...this.byIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, e]) => ({
        id: e.id || `call_${index}`,
        type: "function" as const,
        function: { name: e.name, arguments: e.args || "{}" },
      }))
      .filter((c) => c.function.name);
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

/**
 * Stream a chat/completions request for a given provider config.
 * Yields StreamEvents (text deltas) and returns the completed AssistantTurn.
 */
// ---------------------------------------------------------------------------
// Cancelable sleep helper (internal to this module)
// ---------------------------------------------------------------------------

function sleepCancelable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    if (signal) {
      signal.addEventListener("abort", onAbort);
    }
  });
}

// ---------------------------------------------------------------------------
// Reservation fraction guard (Phase 4)
// ---------------------------------------------------------------------------

/** Default: request must not consume more than 50% of remaining balance. */
const DEFAULT_MAX_RESERVATION_FRACTION = 0.5;
const MIN_GUARDED_MAX_TOKENS = 512;

function getMaxReservationFraction(): number {
  const raw = process.env.MAX_RESERVATION_FRACTION;
  if (!raw) {
    return DEFAULT_MAX_RESERVATION_FRACTION;
  }
  const v = parseFloat(raw);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : DEFAULT_MAX_RESERVATION_FRACTION;
}

/**
 * Optionally lower maxTokens so the estimated reservation is within the
 * configured fraction of the key's remaining balance.
 * Fails open on any error — never throws.
 */
async function clampForReservation(
  apiModelId: string,
  apiKey: string,
  baseUrl: string,
  requestedMaxTokens: number,
  floor = 0,
): Promise<number> {
  try {
    const [keyInfo, prices] = await Promise.all([
      fetchKeyInfo(apiKey, baseUrl),
      fetchModelPrices(baseUrl),
    ]);
    if (!keyInfo || keyInfo.limitRemaining === null || keyInfo.limitRemaining <= 0) {
      return requestedMaxTokens; // unlimited or unknown — leave as-is
    }
    const completionPrice =
      prices?.[apiModelId] ??
      (prices
        ? (Object.values(prices).reduce((a: number, b: number) => a + b, 0) /
          Math.max(Object.keys(prices).length, 1) || null)
        : null);
    if (!completionPrice || completionPrice <= 0) {
      return requestedMaxTokens; // no pricing data
    }

    if (floor > 0) {
      const totalAffordable = Math.floor(
        (keyInfo.limitRemaining * AFFORDABILITY_SAFETY_MARGIN) / completionPrice,
      );
      if (totalAffordable < floor) {
        throw new Error(
          `OpenRouter balance is too low: can only afford ${totalAffordable} tokens ` +
            `(minimum required for reasoning is ${floor}). ` +
            `Please add credits at https://openrouter.ai/settings/credits.`,
        );
      }
    }

    const fraction = getMaxReservationFraction();
    const affordableBudget = keyInfo.limitRemaining * fraction;
    const maxAffordableTokens = Math.floor(affordableBudget / completionPrice);
    const minGuarded = floor > 0 ? floor : MIN_GUARDED_MAX_TOKENS;

    if (maxAffordableTokens < requestedMaxTokens) {
      if (process.env.DEBUG_TOKEN_BUDGET === "1") {
        console.debug(
          `[Reservation] Lowering max_tokens from ${requestedMaxTokens} → ${Math.max(minGuarded, maxAffordableTokens)} ` +
          `(balance $${keyInfo.limitRemaining.toFixed(4)}, fraction ${fraction}, price $${completionPrice}/tok)`,
        );
      }
    }
    return Math.max(minGuarded, Math.min(requestedMaxTokens, maxAffordableTokens));
  } catch (err) {
    if (floor > 0 && err instanceof Error && err.message.includes("OpenRouter balance is too low")) {
      throw err;
    }
    return requestedMaxTokens; // Fail open
  }
}

// ---------------------------------------------------------------------------
// Core streaming function with gate + classify402 + in-flight retry
// ---------------------------------------------------------------------------

const MAX_IN_FLIGHT_RETRIES = 2;

async function* streamFromProvider(
  provider: ProviderConfig,
  apiKey: string,
  messages: ChatMessage[],
  { signal, tools, maxTokens, phase, onRetry, model }: StreamOptions = {},
): AsyncGenerator<StreamEvent, AssistantTurn, unknown> {
  const targetModel = model ?? provider.model;
  let effectiveMaxTokens = phase
    ? getPhaseMaxTokens(phase, targetModel, maxTokens)
    : getModelMaxTokens(targetModel, maxTokens);

  // Affordability pre-clamp (existing behavior)
  if (provider.baseUrl.includes("openrouter.ai") && apiKey) {
    const floor = (phase === "tool_decision" || phase === "edit") ? getReasoningFloor() : 0;
    try {
      const affordable = await getAffordableTokens(targetModel, apiKey, provider.baseUrl);
      if (Number.isFinite(affordable)) {
        if (floor > 0 && affordable < floor) {
          throw new Error(
            `OpenRouter balance is too low: can only afford ${affordable} tokens ` +
              `(minimum required for reasoning is ${floor}). ` +
              `Please add credits at https://openrouter.ai/settings/credits.`,
          );
        }
        if (affordable > 0) {
          effectiveMaxTokens = Math.min(effectiveMaxTokens, affordable);
        }
      }
    } catch (err) {
      if (floor > 0 && err instanceof Error && err.message.includes("OpenRouter balance is too low")) {
        throw err;
      }
      // Fail open on other affordability errors
    }

    // Phase 4: reservation fraction guard
    effectiveMaxTokens = await clampForReservation(
      targetModel,
      apiKey,
      provider.baseUrl,
      effectiveMaxTokens,
      floor,
    );
  }

  const body: ChatCompletionRequest = {
    model: targetModel,
    messages,
    stream: true,
    max_tokens: effectiveMaxTokens,
  };
  // TODO: Prompt Caching Breakpoint
  // When OpenRouter / Anthropic structured cache_control markers (e.g. { type: "ephemeral" })
  // are supported in request message content blocks, attach cache_control to the stable prefix
  // message here to trigger provider-side KV prompt caching.
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  // Phase 3: single-flight gate — acquire before sending the initial request.
  // The gate is released as soon as we have a settled Response (ok or error),
  // so the stream body can be consumed without holding the gate.
  let response = await withGate(() =>
    fetchWithRetry(
      `${provider.baseUrl}chat/completions`,
      {
        method: "POST",
        headers: buildHeaders(provider, apiKey),
        body: JSON.stringify(body),
      },
      { signal, onRetry },
    )
  );

  // Phase 1 + 2: classify 402s and handle in-flight budget retries
  if (response.status === 402 || (!response.ok && !response.body)) {
    const detail = await safeReadText(response);

    if (response.status === 402) {
      invalidateKeyInfoCache();
      const classified = classify402(detail, response.headers, apiKey);

      if (classified.kind === "max_tokens_unaffordable") {
        // ── Existing behavior: single retry with floor(N * 0.9) ──────────
        const affordable = classified.affordableTokens!;
        const floor = (phase === "tool_decision" || phase === "edit") ? getReasoningFloor() : 0;
        const minRequired = floor > 0 ? floor : MIN_RETRY_AFFORDABLE_TOKENS;
        if (affordable < minRequired) {
          throw new Error(
            `OpenRouter balance is too low: can only afford ${affordable} tokens ` +
              `(minimum required is ${minRequired}). ` +
              `Please add credits at https://openrouter.ai/settings/credits.` +
              `${classified.message ? ` Detail: ${classified.message}` : ""}`,
          );
        }
        const retryTokens = Math.floor(affordable * 0.9);
        const retryBody: ChatCompletionRequest = { ...body, max_tokens: retryTokens };
        const retryResponse = await withGate(() =>
          fetchWithRetry(
            `${provider.baseUrl}chat/completions`,
            {
              method: "POST",
              headers: buildHeaders(provider, apiKey),
              body: JSON.stringify(retryBody),
            },
            { signal, onRetry, retries: 0 },
          )
        );
        if (retryResponse.ok && retryResponse.body) {
          response = retryResponse;
        } else {
          const retryDetail = await safeReadText(retryResponse);
          const safeRetryDetail = retryDetail.replace(apiKey, "[REDACTED]");
          throw new Error(
            `${provider.name} request failed (402 Payment Required) after retry: ` +
              `${safeRetryDetail || retryResponse.statusText}`,
          );
        }
      } else if (classified.kind === "in_flight_budget") {
        // ── New: in-flight budget retry with Retry-After + halved tokens ─
        let currentMaxTokens = body.max_tokens ?? effectiveMaxTokens;
        let lastResponse: Response = response;

        for (let attempt = 1; attempt <= MAX_IN_FLIGHT_RETRIES; attempt++) {
          const waitSecs = classified.retryAfterSeconds ?? 20;
          onRetry?.(
            waitSecs * 1000,
            attempt,
          );
          // Show visible status (surfaced to UI via onRetry callback)
          console.log(
            `[DAXIOM] OpenRouter in-flight budget full; waiting ${waitSecs}s, ` +
              `then retrying (attempt ${attempt}/${MAX_IN_FLIGHT_RETRIES})...`,
          );

          // Cancelable wait
          await sleepCancelable(waitSecs * 1000, signal);

          // Halve max_tokens on retry (min 512) to lower the reservation
          currentMaxTokens = Math.max(512, Math.floor(currentMaxTokens / 2));
          const retryBody: ChatCompletionRequest = {
            ...body,
            max_tokens: currentMaxTokens,
          };

          lastResponse = await withGate(() =>
            fetchWithRetry(
              `${provider.baseUrl}chat/completions`,
              {
                method: "POST",
                headers: buildHeaders(provider, apiKey),
                body: JSON.stringify(retryBody),
              },
              { signal, onRetry, retries: 0 },
            )
          );

          if (lastResponse.ok && lastResponse.body) {
            response = lastResponse;
            break;
          }

          // Still failing — reclassify to see if it's still in-flight
          if (lastResponse.status === 402) {
            const retryDetail = await safeReadText(lastResponse);
            const retryClassified = classify402(retryDetail, lastResponse.headers, apiKey);
            if (retryClassified.kind === "in_flight_budget" && attempt < MAX_IN_FLIGHT_RETRIES) {
              // Update wait time from new response and loop again
              Object.assign(classified, { retryAfterSeconds: retryClassified.retryAfterSeconds });
              continue;
            }
          }

          if (attempt >= MAX_IN_FLIGHT_RETRIES) {
            // Exhausted retries — surface clear actionable message
            throw new Error(
              `OpenRouter in-flight budget cap reached after ${MAX_IN_FLIGHT_RETRIES} retries. ` +
                `Your account's in-flight limit is likely too low. ` +
                `Adding even a small amount of credit raises the ceiling: ` +
                `https://openrouter.ai/settings/credits . ` +
                `Your session is intact — re-run the last step to try again.`,
            );
          }
        }
      } else {
        // ── Class 3: insufficient_credits — no retry ─────────────────────
        throw new Error(
          `${provider.name} credit check failed (402 Payment Required). ` +
            `Please add credits at https://openrouter.ai/settings/credits.` +
            `${classified.message ? ` Detail: ${classified.message}` : ""}`,
        );
      }
    }
  }

  if (!response.ok || !response.body) {
    const detail = await safeReadText(response);
    const safeDetail = detail.replace(apiKey, "[REDACTED]");
    let errMessage = "";
    try {
      const parsed = JSON.parse(detail);
      if (parsed.error?.message) {
        errMessage = parsed.error.message.replace(apiKey, "[REDACTED]");
      }
    } catch {
      errMessage = safeDetail;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `${provider.name} authentication failed (${response.status} ${response.statusText}). Check your OpenRouter API key.${errMessage ? ` Detail: ${errMessage}` : ""}`,
      );
    }
    if (
      response.status === 404 ||
      errMessage.toLowerCase().includes("model not found") ||
      errMessage.toLowerCase().includes("no endpoints found")
    ) {
      throw new Error(
        `Model not found on ${provider.name}: ${provider.model}. Please select a valid OpenRouter model (run /models).${errMessage ? ` Detail: ${errMessage}` : ""}`,
      );
    }
    if (response.status === 429) {
      throw new Error(
        `${provider.name} rate limit exceeded (429 Rate Limited). Please try again later or check your OpenRouter credits.${errMessage ? ` Detail: ${errMessage}` : ""}`,
      );
    }

    throw new Error(
      `${provider.name} request failed (${response.status} ${response.statusText})` +
        (errMessage ? `: ${errMessage}` : ""),
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolAcc = new ToolCallAccumulator();
  let finishReason: string | null = null;
  let providerUsage: AssistantTurn["usage"] | undefined;

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel().catch(() => {});
        break;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const chunk of parseSseEvent(rawEvent)) {
          if (chunk === DONE_SENTINEL) {
            return { content, toolCalls: toolAcc.finalize(), finishReason, usage: providerUsage };
          }
          if ((chunk as ChatCompletionChunk).usage) {
            providerUsage = (chunk as ChatCompletionChunk).usage;
          }
          const choice = (chunk as ChatCompletionChunk).choices?.[0];
          if (!choice) {
            continue;
          }
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const piece = choice.delta?.content;
          if (piece) {
            content += piece;
            yield { type: "text", delta: piece };
          }
          if (choice.delta?.tool_calls) {
            toolAcc.add(choice.delta.tool_calls);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content, toolCalls: toolAcc.finalize(), finishReason, usage: providerUsage };
}

// ---------------------------------------------------------------------------
// ProviderClient — the single object the agent loop talks to
// ---------------------------------------------------------------------------

/**
 * Manages a single active provider selected at startup with automatic
 * fallback to the secondary provider on transient failures.
 *
 * The agent does NOT know which provider is active — it only calls `.stream()`.
 */
export class ProviderClient {
  /** The canonical model identifier (never changes). */
  readonly canonicalModel = CANONICAL_MODEL;

  private activeProvider: ProviderConfig;
  private fallbackProvider: ProviderConfig | null;
  private readonly apiKey: string;

  /** Whether a provider switch occurred during the current session. */
  private didFallback = false;

  constructor(
    activeProvider: ProviderConfig,
    apiKey: string,
    fallbackProvider: ProviderConfig | null = null,
  ) {
    this.activeProvider = activeProvider;
    this.apiKey = apiKey;
    this.fallbackProvider = fallbackProvider;
  }

  get providerName(): string {
    return this.activeProvider.name;
  }

  get providerBaseUrl(): string {
    return this.activeProvider.baseUrl;
  }

  get model(): string {
    return this.activeProvider.model;
  }

  /** Update the active model live in the current session. */
  setModel(model: string): void {
    this.activeProvider = { ...this.activeProvider, model };
    if (this.fallbackProvider) {
      this.fallbackProvider = { ...this.fallbackProvider, model };
    }
  }

  /** Update the provider endpoint live in the current session. */
  setBaseUrl(baseUrl: string): void {
    let normalized = baseUrl.trim();
    if (!normalized.endsWith("/")) {
      normalized += "/";
    }
    let name = "Custom";
    if (normalized.includes("openrouter.ai")) {
      name = "OpenRouter";
    } else if (normalized.includes("bedrock-runtime")) {
      name = "AWS Bedrock";
    }
    this.activeProvider = {
      name,
      baseUrl: normalized,
      model: this.activeProvider.model,
    };
    this.fallbackProvider = null;
    this.didFallback = false;
  }

  /**
   * Stream one assistant turn, automatically falling back to the secondary
   * provider on a transient network/provider failure.
   *
   * Fallback is conservative: once a switch occurs in a session it does not
   * switch back, and tool executions are NOT duplicated.
   */
  async *stream(
    messages: ChatMessage[],
    opts: StreamOptions = {},
  ): AsyncGenerator<StreamEvent, AssistantTurn, unknown> {
    try {
      return yield* streamFromProvider(
        this.activeProvider,
        this.apiKey,
        messages,
        opts,
      );
    } catch (primaryErr: any) {
      // Do not attempt fallback for aborted requests or auth failures
      if (opts.signal?.aborted) {
        throw primaryErr;
      }

      const isAuthError =
        primaryErr?.message?.includes("401") ||
        primaryErr?.message?.includes("403") ||
        primaryErr?.message?.includes("Unauthorized") ||
        primaryErr?.message?.includes("Forbidden") ||
        primaryErr?.message?.includes("authentication failed");

      const isModelNotFoundError =
        primaryErr?.message?.includes("404") ||
        primaryErr?.message?.includes("Model not found") ||
        primaryErr?.message?.includes("No endpoints found");

      if (isAuthError || isModelNotFoundError || !this.fallbackProvider || this.didFallback) {
        throw primaryErr;
      }

      // Switch providers and retry — once per session
      console.error(
        `[DAXIOM] ${this.activeProvider.name} unavailable (${primaryErr.message}). ` +
          `Falling back to ${this.fallbackProvider.name}...`,
      );

      this.didFallback = true;
      const prev = this.activeProvider;
      this.activeProvider = this.fallbackProvider;
      this.fallbackProvider = prev; // Swap so subsequent failures hit the original

      return yield* streamFromProvider(
        this.activeProvider,
        this.apiKey,
        messages,
        opts,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Provider detection — called once at startup
// ---------------------------------------------------------------------------

/**
 * Detect which providers are reachable with the given API key.
 *
 * Makes a lightweight authenticated probe to each provider in PROVIDER_PRIORITY
 * order. Returns the detection result including provider statuses and the
 * selected active ProviderClient.
 *
 * @param apiKey  The credential from AI_API_KEY.
 * @param signal  Optional AbortSignal to cancel probing.
 */
export async function detectProviders(
  apiKey: string,
  signal?: AbortSignal,
  customBaseUrl?: string,
  customModel?: string,
): Promise<ProviderDetectionResult> {
  const statuses: ProviderStatus[] = [];
  const workingProviders: ProviderConfig[] = [];

  let priorityList: ProviderConfig[] = [...PROVIDER_PRIORITY];
  if (customBaseUrl) {
    let normalized = customBaseUrl.trim();
    if (!normalized.endsWith("/")) {
      normalized += "/";
    }
    let name = "Custom Provider";
    if (normalized.includes("openrouter.ai")) {
      name = "OpenRouter";
    } else if (normalized.includes("bedrock-runtime")) {
      name = "AWS Bedrock";
    }
    const customProvider: ProviderConfig = {
      name,
      baseUrl: normalized,
      model: customModel || CANONICAL_MODEL,
    };
    priorityList = [
      customProvider,
      ...PROVIDER_PRIORITY.filter((p) => p.baseUrl !== normalized),
    ];
  } else if (customModel) {
    priorityList = priorityList.map((p) => ({ ...p, model: customModel }));
  }

  for (const provider of priorityList) {
    const err = await probeProvider(provider, apiKey, signal);
    if (err === null) {
      statuses.push({ name: provider.name, available: true });
      workingProviders.push(provider);
    } else {
      statuses.push({ name: provider.name, available: false, error: err });
    }
  }

  if (workingProviders.length === 0) {
    return { statuses, activeProvider: null };
  }

  return {
    statuses,
    activeProvider: workingProviders[0],
  };
}

/**
 * Build a ProviderClient from a detection result.
 * Throws a descriptive error if no provider was available.
 */
export function buildProviderClient(
  result: ProviderDetectionResult,
  apiKey: string,
): ProviderClient {
  if (!result.activeProvider) {
    const details = result.statuses
      .map((s) => `  • ${s.name}: ${s.error ?? "unknown error"}`)
      .join("\n");
    throw new Error(
      `No LLM provider is available. Check your AI_API_KEY and network:\n${details}`,
    );
  }

  // Find a verified fallback (the next available provider after the primary)
  const fallback =
    result.statuses
      .filter((s) => s.available && s.name !== result.activeProvider!.name)
      .map((s) => PROVIDER_PRIORITY.find((p) => p.name === s.name))
      .find(Boolean) ?? null;

  return new ProviderClient(result.activeProvider, apiKey, fallback ?? null);
}
