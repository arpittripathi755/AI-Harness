import type {
  AssistantTurn,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatMessage,
  StreamEvent,
  ToolCall,
  ToolDefinition,
} from "./types";
import { DEFAULT_MAX_TOKENS, getModelMaxTokens, modelApi, resolveModelId } from "../shared/models";
import { streamResponses } from "./responses";
import { fetchWithRetry } from "./http";
import { ProviderClient } from "./ProviderClient";
import { type CallPhase, getPhaseMaxTokens, getReasoningFloor } from "./tokenBudget";
import { buildEndpointUrl } from "./endpointUtils";
import {
  getAffordableTokens,
  invalidateKeyInfoCache,
  MIN_RETRY_AFFORDABLE_TOKENS,
  recordModelAffordability,
} from "./affordability";
import { classify402 } from "./classify402";

export interface LLMClientOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxTokens?: number;
}

export interface StreamOptions {
  signal?: AbortSignal;
  tools?: ToolDefinition[];
  /** Notified when a request is retried after a rate limit / transient error. */
  onRetry?: (waitMs: number, attempt: number) => void;
  maxTokens?: number;
  /** Phase of the turn for adaptive token budgeting. */
  phase?: CallPhase;
  /** Optional model override for this stream request. */
  model?: string;
}

/**
 * Minimal OpenAI-compatible chat client built on native `fetch` — deliberately
 * NOT the Anthropic/openai SDK. Targets any endpoint exposing
 * `POST {baseUrl}chat/completions` with SSE streaming (e.g. Lightning AI).
 */
export class LLMClient {
  private model: string;
  private maxTokens?: number;
  /** Optional delegate; when set, all stream() calls route through this. */
  private providerClient: ProviderClient | undefined;

  constructor(private readonly opts: LLMClientOptions) {
    this.model = opts.model;
    this.maxTokens = opts.maxTokens;
    this.opts.baseUrl = this.normalizeEndpoint(opts.baseUrl, opts.apiKey);
    if (this.opts.baseUrl.includes("openrouter.ai") || opts.apiKey?.startsWith("sk-or-v1-")) {
      this.providerClient = new ProviderClient(
        {
          name: "OpenRouter",
          baseUrl: this.opts.baseUrl,
          model: this.model,
        },
        opts.apiKey,
      );
    }
  }

  /**
   * Create an LLMClient that delegates streaming to a ProviderClient.
   * The canonical model from the provider is used for all metadata lookups.
   */
  static fromProviderClient(
    providerClient: ProviderClient,
    apiKey: string,
    maxTokens?: number,
  ): LLMClient {
    const instance = new LLMClient({
      baseUrl: providerClient.providerBaseUrl,
      model: providerClient.model,
      apiKey,
      maxTokens,
    });
    instance.providerClient = providerClient;
    return instance;
  }

  private normalizeEndpoint(baseUrl: string, apiKey: string): string {
    const trimmed = (baseUrl || "").trim();
    if (apiKey?.startsWith("nvapi-") && (trimmed.includes("lightning.ai") || !trimmed)) {
      return "https://integrate.api.nvidia.com/v1/";
    }
    if (apiKey?.startsWith("sk-or-v1-") && (trimmed.includes("lightning.ai") || !trimmed)) {
      return "https://openrouter.ai/api/v1/";
    }
    return trimmed;
  }

  /** Change the model used for subsequent requests (live, no restart). */
  setModel(model: string): void {
    this.model = model;
    this.providerClient?.setModel(model);
  }

  /** Update the maximum tokens generated per request. */
  setMaxTokens(maxTokens: number): void {
    this.maxTokens = maxTokens;
  }

  /** Update the base URL / API key for subsequent requests. */
  setEndpoint(baseUrl: string, apiKey: string): void {
    this.opts.baseUrl = this.normalizeEndpoint(baseUrl, apiKey);
    this.opts.apiKey = apiKey;
    if (this.providerClient) {
      this.providerClient.setBaseUrl(baseUrl);
    } else if (this.opts.baseUrl.includes("openrouter.ai") || apiKey?.startsWith("sk-or-v1-")) {
      this.providerClient = new ProviderClient(
        {
          name: "OpenRouter",
          baseUrl: this.opts.baseUrl,
          model: this.model,
        },
        apiKey,
      );
    }
  }

  getModel(): string {
    return this.providerClient ? this.providerClient.model : this.model;
  }

  getBaseUrl(): string {
    return this.providerClient ? this.providerClient.providerBaseUrl : this.opts.baseUrl;
  }

  /**
   * Translate the model ID if required by the target provider to prevent errors.
   * - DeepSeek official API (api.deepseek.com) requires 'deepseek-chat' / 'deepseek-reasoner'.
   * - Lightning AI (lightning.ai) uses its hosted catalog IDs.
   * - NVIDIA NIM (api.nvidia.com) uses its hosted catalog IDs.
   */
  private resolveModelForEndpoint(model: string, baseUrl: string): string {
    const isOpenRouterEndpoint = baseUrl.includes("openrouter.ai");
    if (isOpenRouterEndpoint) {
      return resolveModelId(model);
    }

    const isNvidiaEndpoint = baseUrl.includes("api.nvidia.com");
    if (isNvidiaEndpoint) {
      if (
        model === "ultra" ||
        model === "nemotron" ||
        model === "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b" ||
        model === "lightning-ai/nvidia/nemotron-3-ultra-550b-a55b" ||
        model === "nvidia/nemotron-3-ultra-550b-a55b"
      ) {
        return "nvidia/nemotron-3-ultra-550b-a55b";
      }
      if (
        model === "deepseek-flash" ||
        model === "deepseek-v4-pro" ||
        model === "deepseek/deepseek-v4.1-flash" ||
        model === "deepseek-ai/deepseek-v4.1-flash"
      ) {
        return "deepseek-ai/deepseek-v4.1-flash";
      }
    }

    const isDeepSeekEndpoint = baseUrl.includes("api.deepseek.com");
    if (isDeepSeekEndpoint) {
      if (
        model === "deepseek-v4-pro" ||
        model === "deepseek-flash" ||
        model === "deepseek/deepseek-v4.1-flash" ||
        model === "deepseek-ai/deepseek-v4.1-flash" ||
        model === "nvidia/nemotron-3-ultra-550b-a55b" ||
        model === "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b" ||
        model === "lightning-ai/nvidia/nemotron-3-ultra-550b-a55b" ||
        model === "ultra" ||
        model === "nemotron"
      ) {
        return "deepseek-chat";
      }
    }

    const isLightningEndpoint = baseUrl.includes("lightning.ai");
    if (isLightningEndpoint) {
      if (model === "deepseek-flash" || model === "deepseek-v4-pro") {
        return "deepseek-ai/deepseek-v4.1-flash";
      }
      if (
        model === "ultra" ||
        model === "nemotron" ||
        model === "nvidia/nemotron-3-ultra-550b-a55b"
      ) {
        return "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b";
      }
    }

    return resolveModelId(model);
  }

  /**
   * Stream one assistant turn. Yields `{type:'text'}` deltas as text arrives and
   * accumulates any streamed tool-call fragments. When the stream ends, the
   * generator RETURNS the assembled {@link AssistantTurn} (content + tool calls).
   */
  async *stream(
    messages: ChatMessage[],
    { signal, tools, onRetry, maxTokens, phase, model }: StreamOptions = {},
  ): AsyncGenerator<StreamEvent, AssistantTurn, unknown> {
    const activeModel = model ?? this.model;
    let effectiveMaxTokens: number;
    if (phase) {
      // Only pass override if caller explicitly specified maxTokens
      effectiveMaxTokens = getPhaseMaxTokens(phase, activeModel, maxTokens);
      if (this.maxTokens !== undefined) {
        effectiveMaxTokens = Math.min(effectiveMaxTokens, this.maxTokens);
      }
    } else {
      const base = maxTokens ?? this.maxTokens ?? DEFAULT_MAX_TOKENS;
      effectiveMaxTokens = getModelMaxTokens(activeModel, base);
    }

    // Delegate to ProviderClient when one is active (dual-provider path)
    if (this.providerClient) {
      return yield* this.providerClient.stream(messages, {
        signal,
        tools,
        onRetry,
        maxTokens: effectiveMaxTokens,
        phase,
        model: activeModel,
      });
    }

    // Models that require the OpenAI Responses API (e.g. GPT-5.5) use a separate
    // adapter. The chat/completions path below is unchanged for every other model.
    if (modelApi(activeModel) === "responses") {
      return yield* streamResponses({
        baseUrl: this.opts.baseUrl,
        apiKey: this.opts.apiKey,
        model: activeModel,
        messages,
        tools,
        signal,
        onRetry,
      });
    }

    const effectiveModel = this.resolveModelForEndpoint(
      activeModel,
      this.opts.baseUrl,
    );

    // Affordability pre-clamp for OpenRouter
    if (this.opts.baseUrl.includes("openrouter.ai") && this.opts.apiKey) {
      const floor = (phase === "tool_decision" || phase === "edit") ? getReasoningFloor() : 0;
      try {
        const affordable = await getAffordableTokens(effectiveModel, this.opts.apiKey, this.opts.baseUrl);
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
      }
    }

    const body: ChatCompletionRequest = {
      model: effectiveModel,
      messages,
      stream: true,
      max_tokens: effectiveMaxTokens,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    let response = await fetchWithRetry(
      buildEndpointUrl(this.opts.baseUrl, "chat/completions"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      { signal, onRetry },
    );

    if (response.status === 402 || (!response.ok && !response.body)) {
      const detail = await safeReadText(response);
      if (response.status === 402) {
        invalidateKeyInfoCache();
        const classified = classify402(detail, response.headers, this.opts.apiKey);
        if (classified.kind === "max_tokens_unaffordable") {
          const affordable = classified.affordableTokens!;
          recordModelAffordability(effectiveModel, affordable, this.opts.apiKey);
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
          const retryResponse = await fetchWithRetry(
            buildEndpointUrl(this.opts.baseUrl, "chat/completions"),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.opts.apiKey}`,
              },
              body: JSON.stringify(retryBody),
            },
            { signal, onRetry, retries: 0 },
          );
          if (retryResponse.ok && retryResponse.body) {
            response = retryResponse;
          } else {
            const retryDetail = await safeReadText(retryResponse);
            throw new Error(
              `Request failed (402 Payment Required) after retry: ${retryDetail.replace(this.opts.apiKey, "[REDACTED]") || retryResponse.statusText}`,
            );
          }
        }
      }
      if (!response.ok || !response.body) {
        throw new Error(
          `Request failed (${response.status} ${response.statusText})` +
            (detail ? `: ${detail}` : ""),
        );
      }
    }

    if (!response.body) {
      throw new Error("Response body is empty");
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
            if (chunk === DONE) {
              return { content, toolCalls: toolAcc.finalize(), finishReason, usage: providerUsage };
            }
            if (chunk.usage) {
              providerUsage = chunk.usage;
            }
            const choice = chunk.choices?.[0];
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
}

/**
 * Accumulates streamed tool-call fragments keyed by their `index`. OpenAI streams
 * tool calls as partials: the first fragment carries id/name, later fragments
 * append `arguments`. Non-streamed endpoints send a single complete fragment —
 * both cases collapse to the same result.
 */
class ToolCallAccumulator {
  private readonly byIndex = new Map<
    number,
    { id: string; name: string; args: string }
  >();

  add(
    fragments: NonNullable<
      import("./types").ChatCompletionDelta["tool_calls"]
    >,
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

/** Sentinel returned when the endpoint signals `data: [DONE]`. */
const DONE = Symbol("done");

/** Parse one SSE event block into zero or more chunks (or the DONE sentinel). */
function parseSseEvent(rawEvent: string): Array<ChatCompletionChunk | typeof DONE> {
  const out: Array<ChatCompletionChunk | typeof DONE> = [];
  for (const line of rawEvent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice("data:".length).trim();
    if (data === "[DONE]") {
      out.push(DONE);
      continue;
    }
    try {
      out.push(JSON.parse(data) as ChatCompletionChunk);
    } catch {
      // Ignore keep-alive comments / non-JSON lines.
    }
  }
  return out;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}
