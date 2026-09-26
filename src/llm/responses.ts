import type {
  AssistantTurn,
  ChatMessage,
  ContentPart,
  StreamEvent,
  ToolCall,
  ToolDefinition,
} from "./types";
import { fetchWithRetry } from "./http";

/**
 * Adapter for the OpenAI **Responses** API (`/v1/responses`). Some models on the
 * Lightning endpoint (e.g. GPT-5.5) reject function tools on `/chat/completions`
 * and require this API instead. This module converts our internal chat-style
 * messages/tools into the Responses request shape and parses its streamed events
 * back into the same {@link StreamEvent}/{@link AssistantTurn} contract the rest
 * of the app already uses — so ChatSession/tools are untouched.
 */

interface RequestParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  onRetry?: (waitMs: number, attempt: number) => void;
}

/** Build the JSON body for POST {baseUrl}responses. */
function buildBody(model: string, messages: ChatMessage[], tools?: ToolDefinition[]): unknown {
  const input: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      input.push({
        role: "system",
        content: [{ type: "input_text", text: asText(msg.content) }],
      });
    } else if (msg.role === "user") {
      input.push({ role: "user", content: toInputContent(msg.content) });
    } else if (msg.role === "assistant") {
      if (msg.content) {
        input.push({
          role: "assistant",
          content: [{ type: "output_text", text: asText(msg.content) }],
        });
      }
      // Replay prior tool calls as function_call items so the model has context.
      for (const call of msg.tool_calls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
    } else if (msg.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: msg.tool_call_id,
        output: asText(msg.content),
      });
    }
  }

  const body: Record<string, unknown> = { model, input, stream: true };
  if (tools && tools.length > 0) {
    // Responses API takes a flattened function-tool shape.
    body.tools = tools.map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
    body.tool_choice = "auto";
  }
  return body;
}

function asText(content: string | ContentPart[] | null): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
  }
  return "";
}

/** Convert a user message's content into Responses `input_*` parts. */
function toInputContent(content: string | ContentPart[] | null): unknown[] {
  if (typeof content === "string") {
    return [{ type: "input_text", text: content }];
  }
  if (!Array.isArray(content)) {
    return [{ type: "input_text", text: "" }];
  }
  return content.map((part) =>
    part.type === "text"
      ? { type: "input_text", text: part.text }
      : { type: "input_image", image_url: part.image_url.url },
  );
}

/**
 * Stream a turn from the Responses API. Yields text deltas and returns the
 * assembled turn (content + tool calls), matching LLMClient.stream's contract.
 */
export async function* streamResponses(
  params: RequestParams,
): AsyncGenerator<StreamEvent, AssistantTurn, unknown> {
  const response = await fetchWithRetry(
    `${params.baseUrl}responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(buildBody(params.model, params.messages, params.tools)),
    },
    { signal: params.signal, onRetry: params.onRetry },
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
  const toolsByCallId = new Map<string, { name: string; args: string }>();
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

        const data = extractData(rawEvent);
        if (!data || data === "[DONE]") {
          continue;
        }

        let evt: ResponsesEvent;
        try {
          evt = JSON.parse(data) as ResponsesEvent;
        } catch {
          continue;
        }

        // Text deltas.
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
          content += evt.delta;
          yield { type: "text", delta: evt.delta };
        }

        // A function call item was added — register it by id.
        if (
          evt.type === "response.output_item.added" &&
          evt.item?.type === "function_call"
        ) {
          const id = evt.item.call_id ?? evt.item.id ?? "";
          toolsByCallId.set(id, {
            name: evt.item.name ?? "",
            args: evt.item.arguments ?? "",
          });
        }

        // Streamed argument fragments for a function call.
        if (
          evt.type === "response.function_call_arguments.delta" &&
          typeof evt.delta === "string"
        ) {
          const id = evt.item_id ?? "";
          const entry = toolsByCallId.get(id) ?? { name: "", args: "" };
          entry.args += evt.delta;
          toolsByCallId.set(id, entry);
        }

        // Completed function call (carries final name/arguments).
        if (
          evt.type === "response.output_item.done" &&
          evt.item?.type === "function_call"
        ) {
          const id = evt.item.call_id ?? evt.item.id ?? "";
          toolsByCallId.set(id, {
            name: evt.item.name ?? toolsByCallId.get(id)?.name ?? "",
            args: evt.item.arguments ?? toolsByCallId.get(id)?.args ?? "",
          });
        }

        if (evt.type === "response.completed") {
          finishReason = "stop";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const toolCalls: ToolCall[] = [...toolsByCallId.entries()]
    .filter(([, v]) => v.name)
    .map(([id, v]) => ({
      id: id || `call_${v.name}`,
      type: "function" as const,
      function: { name: v.name, arguments: v.args || "{}" },
    }));

  return { content, toolCalls, finishReason };
}

interface ResponsesEvent {
  type: string;
  delta?: string;
  item_id?: string;
  item?: {
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
}

function extractData(rawEvent: string): string | undefined {
  let data: string | undefined;
  for (const line of rawEvent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) {
      data = trimmed.slice("data:".length).trim();
    }
  }
  return data;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}
