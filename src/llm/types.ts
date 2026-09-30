/**
 * OpenAI-compatible chat types used by the LLM client.
 *
 * Milestone 2 adds function/tool calling: the `tools` request field, `tool_calls`
 * on assistant messages, and the `tool` role for results fed back to the model.
 */

export type Role = "system" | "user" | "assistant" | "tool";

/** A text part of a multimodal message. */
export interface TextPart {
  type: "text";
  text: string;
}

/** An image part of a multimodal message (OpenAI-compatible). */
export interface ImagePart {
  type: "image_url";
  image_url: { url: string };
}

export type ContentPart = TextPart | ImagePart;

/** A tool/function call requested by the model. */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded arguments (may arrive in fragments while streaming). */
    arguments: string;
  };
}

/**
 * A chat message. `content` is a string, a multimodal parts array (user turns
 * with images), or null on assistant turns that only contain tool calls.
 */
export interface ChatMessage {
  role: Role;
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** OpenAI-compatible tool (function) definition sent in the request. */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

/** Request body for POST {baseUrl}chat/completions. */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  max_tokens?: number;
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none";
}

/** Delta shape inside a streamed chunk. */
export interface ChatCompletionDelta {
  role?: Role;
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
}

/** A single streamed chunk (one `data:` SSE line) from the endpoint. */
export interface ChatCompletionChunk {
  choices: Array<{
    delta: ChatCompletionDelta;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    cached_tokens?: number;
    reasoning_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    [key: string]: unknown;
  };
}

/** Event emitted while streaming an assistant turn. */
export type StreamEvent = { type: "text"; delta: string };

/** The fully-assembled assistant turn, returned when the stream completes. */
export interface AssistantTurn {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    cached_tokens?: number;
    reasoning_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    [key: string]: unknown;
  };
}
