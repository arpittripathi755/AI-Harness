/**
 * Token-based input context management and compaction.
 *
 * Prevents context exhaustion and reduces token spend by:
 * 1. Estimating message and text token counts without external dependencies.
 * 2. Truncating long command output preserving head and tail.
 * 3. Compacting older message history (stubbing large tool results while keeping last turns intact).
 */

import type { ChatMessage, ToolCall } from "./types";

export const DEFAULT_INPUT_TOKEN_BUDGET = 24000;
export const MESSAGE_TOKEN_OVERHEAD = 4;

/**
 * Safely parse input token budget from environment or raw value.
 * Falls back to 24,000 for invalid/non-positive/non-finite inputs.
 */
export function resolveInputTokenBudget(raw?: string | number): number {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_INPUT_TOKEN_BUDGET;
  }
  const val = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(val) || val <= 0 || !Number.isInteger(val)) {
    return DEFAULT_INPUT_TOKEN_BUDGET;
  }
  return val;
}

/** Get the configured input token budget (from INPUT_TOKEN_BUDGET or default). */
export function getInputTokenBudget(): number {
  const proc = typeof globalThis !== "undefined" ? (globalThis as any).process : undefined;
  const envVal = proc?.env?.INPUT_TOKEN_BUDGET?.trim();
  return resolveInputTokenBudget(envVal);
}

/**
 * Estimate token count for a string using standard 3.5 chars/token heuristic.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 3.5);
}

/**
 * Estimate token count for an array of ChatMessages, including message overhead
 * and structured tool calls.
 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += MESSAGE_TOKEN_OVERHEAD;
    if (typeof msg.content === "string") {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          total += estimateTokens(part.text);
        }
      }
    }
    if (msg.tool_calls) {
      for (const call of msg.tool_calls) {
        total += estimateTokens(call.function.name) + estimateTokens(call.function.arguments) + 8;
      }
    }
  }
  return total;
}

/**
 * Truncate long text preserving both head and tail.
 * Compilers and test runners put the most critical diagnostics and errors at the END,
 * hence tailChars is typically larger than headChars.
 */
export function truncateHeadTail(
  text: string,
  maxChars = 20_000,
  headChars = 6_000,
  tailChars = 12_000,
): string {
  if (text.length <= maxChars) {
    return text;
  }

  // Adjust head/tail if combined size exceeds maxChars
  let headLen = headChars;
  let tailLen = tailChars;
  if (headLen + tailLen >= maxChars) {
    const ratio = headLen / (headLen + tailLen);
    headLen = Math.floor(maxChars * ratio * 0.9);
    tailLen = Math.floor(maxChars * (1 - ratio) * 0.9);
  }

  const head = text.slice(0, headLen);
  const tail = text.slice(text.length - tailLen);
  const middle = text.slice(headLen, text.length - tailLen);
  const omittedLineCount = (middle.match(/\n/g) || []).length;

  return `${head}\n… [${omittedLineCount} lines omitted] …\n${tail}`;
}

/**
 * Build a short descriptive label for a tool call given its ID and conversation context.
 */
function findToolDescription(callId: string | undefined, messages: ChatMessage[]): string {
  if (!callId) {
    return "tool";
  }
  for (const m of messages) {
    if (m.tool_calls) {
      const found = m.tool_calls.find((c: ToolCall) => c.id === callId);
      if (found) {
        try {
          const args = JSON.parse(found.function.arguments || "{}");
          const target = args.path || args.query || args.command || "";
          return target ? `${found.function.name} ${target}` : found.function.name;
        } catch {
          return found.function.name;
        }
      }
    }
  }
  return "tool";
}

/**
 * Compact conversation history when it approaches or exceeds the input token budget.
 *
 * Rules:
 * 1. If estimated tokens <= 70% of inputBudgetTokens, return messages untouched.
 * 2. Keep the system prompt (index 0) and the last 3 items verbatim.
 * 3. Replace older tool-result contents with single-line stubs:
 *    "[tool result omitted: <name> (~<tokens> tokens). Re-read if needed.]"
 * 4. If still over budget after stubbing, drop the oldest non-system turns until under budget.
 *    NEVER split an assistant tool call from its tool results (keep them paired).
 * 5. Never mutate the original array; return a new one.
 */
export function compactHistory(
  messages: ChatMessage[],
  inputBudgetTokens = DEFAULT_INPUT_TOKEN_BUDGET,
): ChatMessage[] {
  if (messages.length <= 4) {
    return [...messages];
  }

  const currentEstimated = estimateMessagesTokens(messages);
  const threshold = Math.floor(inputBudgetTokens * 0.7);
  if (currentEstimated <= threshold) {
    return [...messages];
  }

  // Clone messages so input is never mutated
  const result: ChatMessage[] = messages.map((m) => {
    if (typeof m.content === "string") {
      return { ...m };
    }
    if (Array.isArray(m.content)) {
      return { ...m, content: [...m.content] };
    }
    return { ...m };
  });

  const protectedTailCount = 3;
  const cutoffIndex = Math.max(1, result.length - protectedTailCount);

  // Step 1: Replace older tool results with stubs
  for (let i = 1; i < cutoffIndex; i++) {
    const msg = result[i];
    if (msg.role === "tool" && typeof msg.content === "string") {
      // Don't re-stub already stubbed messages (for idempotency)
      if (msg.content.startsWith("[tool result omitted:")) {
        continue;
      }
      const tok = estimateTokens(msg.content);
      // Only stub results that are larger than a short single-line output (> 50 tokens)
      if (tok > 50) {
        const desc = findToolDescription(msg.tool_call_id, messages);
        result[i] = {
          ...msg,
          content: `[tool result omitted: ${desc} (~${tok} tokens). Re-read if needed.]`,
        };
      }
    }
  }

  if (estimateMessagesTokens(result) <= inputBudgetTokens) {
    return result;
  }

  // Step 2: Drop oldest non-system turns while keeping tool calls paired with their results
  // Group non-system messages into atomic units (user message or assistant+tool_results)
  const systemMsg = result[0]?.role === "system" ? result[0] : null;
  const nonSystem = systemMsg ? result.slice(1) : [...result];

  interface MessageGroup {
    messages: ChatMessage[];
  }

  const groups: MessageGroup[] = [];
  let currentGroup: ChatMessage[] = [];

  for (let i = 0; i < nonSystem.length; i++) {
    const m = nonSystem[i];
    if (m.role === "user") {
      if (currentGroup.length > 0) {
        groups.push({ messages: currentGroup });
        currentGroup = [];
      }
      groups.push({ messages: [m] });
    } else if (m.role === "assistant") {
      if (currentGroup.length > 0) {
        groups.push({ messages: currentGroup });
        currentGroup = [];
      }
      currentGroup.push(m);
    } else if (m.role === "tool") {
      currentGroup.push(m);
    } else {
      if (currentGroup.length > 0) {
        groups.push({ messages: currentGroup });
        currentGroup = [];
      }
      groups.push({ messages: [m] });
    }
  }
  if (currentGroup.length > 0) {
    groups.push({ messages: currentGroup });
  }

  // Drop groups from the front (oldest) until under budget, but never drop the last group
  while (groups.length > 1) {
    const flattened = [
      ...(systemMsg ? [systemMsg] : []),
      ...groups.flatMap((g) => g.messages),
    ];
    if (estimateMessagesTokens(flattened) <= inputBudgetTokens) {
      return flattened;
    }
    // Drop the oldest group
    groups.shift();
  }

  return [
    ...(systemMsg ? [systemMsg] : []),
    ...groups.flatMap((g) => g.messages),
  ];
}
