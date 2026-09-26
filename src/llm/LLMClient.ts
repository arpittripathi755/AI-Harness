import type {
  AssistantTurn,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatMessage,
  StreamEvent,
  ToolCall,
  ToolDefinition,
} from "./types";
import { modelApi } from "../shared/models";
import { streamResponses } from "./responses";
import { fetchWithRetry } from "./http";

export interface LLMClientOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface StreamOptions {
  signal?: AbortSignal;
  tools?: ToolDefinition[];
  /** Notified when a request is retried after a rate limit / transient error. */
  onRetry?: (waitMs: number, attempt: number) => void;
}

/**
 * Minimal OpenAI-compatible chat client built on native `fetch` — deliberately
 * NOT the Anthropic/openai SDK. Targets any endpoint exposing
 * `POST {baseUrl}chat/completions` with SSE streaming (e.g. Lightning AI).
 */
export class LLMClient {
  private model: string;

  constructor(private readonly opts: LLMClientOptions) {
    this.model = opts.model;
  }

  /** Change the model used for subsequent requests (live, no restart). */
  setModel(model: string): void {
    this.model = model;
  }

  /** Update the base URL / API key for subsequent requests. */
  setEndpoint(baseUrl: string, apiKey: string): void {
    this.opts.baseUrl = baseUrl;
    this.opts.apiKey = apiKey;
  }

  /**
   * Stream one assistant turn. Yields `{type:'text'}` deltas as text arrives and
   * accumulates any streamed tool-call fragments. When the stream ends, the
   * generator RETURNS the assembled {@link AssistantTurn} (content + tool calls).
   */
  async *stream(
    messages: ChatMessage[],
    { signal, tools, onRetry }: StreamOptions = {},
  ): AsyncGenerator<StreamEvent, AssistantTurn, unknown> {
    // Models that require the OpenAI Responses API (e.g. GPT-5.5) use a separate
    // adapter. The chat/completions path below is unchanged for every other model.
    if (modelApi(this.model) === "responses") {
      return yield* streamResponses({
        baseUrl: this.opts.baseUrl,
        apiKey: this.opts.apiKey,
        model: this.model,
        messages,
        tools,
        signal,
        onRetry,
      });
    }

    const body: ChatCompletionRequest = {
      model: this.model,
      messages,
      stream: true,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const response = await fetchWithRetry(
      `${this.opts.baseUrl}chat/completions`,
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

    if (!response.ok || !response.body) {
      const detail = await safeReadText(response);
      throw new Error(
        `Request failed (${response.status} ${response.statusText})` +
          (detail ? `: ${detail}` : ""),
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let content = "";
    const toolAcc = new ToolCallAccumulator();
    let finishReason: string | null = null;

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
              return { content, toolCalls: toolAcc.finalize(), finishReason };
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

    return { content, toolCalls: toolAcc.finalize(), finishReason };
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
