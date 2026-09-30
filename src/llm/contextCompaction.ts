/**
 * Phase 6: Context Compaction with TaskMemory Anchor.
 *
 * Introduces token-budget-aware context compaction that:
 *   1. Measures current conversation token usage against a configurable threshold.
 *   2. When the threshold is exceeded, rebuilds history with a TaskMemory anchor
 *      replacing the bulk of old conversation turns.
 *   3. Preserves: system prompt, TaskMemory anchor, recent turns, active tool
 *      call/result pairs, and the current user request.
 *   4. Fails open — any failure retains the original history.
 *
 * Feature Flag: DAXIOM_CONTEXT_COMPACTION (default: OFF)
 *
 * Thresholds (all labeled per measurement status):
 *   COMPACTION_HIGH_WATERMARK: 0.75 — DESIGN TARGET (unmeasured)
 *   COMPACTION_TARGET:         0.45 — DESIGN TARGET (unmeasured)
 *   RECENT_TURNS_WINDOW:       4    — DESIGN TARGET (unmeasured)
 */

import { estimateMessagesTokens, estimateTokens } from "./contextBudget";
import type { ChatMessage } from "./types";

// ---------------------------------------------------------------------------
// Feature Flag
// ---------------------------------------------------------------------------

/**
 * Check whether context compaction is enabled.
 * DAXIOM_CONTEXT_COMPACTION must be "1" or "true" to enable.
 * Default: OFF.
 */
export function isContextCompactionEnabled(): boolean {
  const proc = typeof globalThis !== "undefined" ? (globalThis as any).process : undefined;
  const val = proc?.env?.DAXIOM_CONTEXT_COMPACTION?.trim();
  return val === "1" || val === "true";
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * High-watermark fraction of input token budget that triggers compaction.
 * DESIGN TARGET: 0.75 (75%). Unmeasured — chosen conservatively.
 */
export const DEFAULT_COMPACTION_HIGH_WATERMARK = 0.75; // DESIGN TARGET

/**
 * Target fraction of input token budget after compaction.
 * DESIGN TARGET: 0.45 (45%). Unmeasured. Must be < HIGH_WATERMARK.
 */
export const DEFAULT_COMPACTION_TARGET = 0.45; // DESIGN TARGET

/**
 * Number of most-recent turn-groups to always preserve verbatim.
 * DESIGN TARGET: 4 groups. Unmeasured.
 */
export const DEFAULT_RECENT_TURNS_WINDOW = 4; // DESIGN TARGET

/**
 * Maximum passes of compaction per turn (loop protection).
 */
export const MAX_COMPACTION_PASSES = 1;

/**
 * Read the high-watermark fraction from DAXIOM_COMPACTION_HIGH_WATERMARK.
 * Falls back to DEFAULT_COMPACTION_HIGH_WATERMARK on invalid/unset.
 */
export function getCompactionHighWatermark(): number {
  const proc = typeof globalThis !== "undefined" ? (globalThis as any).process : undefined;
  const raw = proc?.env?.DAXIOM_COMPACTION_HIGH_WATERMARK?.trim();
  if (!raw) {
    return DEFAULT_COMPACTION_HIGH_WATERMARK;
  }
  const val = Number(raw);
  if (Number.isFinite(val) && val > 0 && val < 1) {
    return val;
  }
  return DEFAULT_COMPACTION_HIGH_WATERMARK;
}

/**
 * Read the target fraction from DAXIOM_COMPACTION_TARGET.
 * Falls back to DEFAULT_COMPACTION_TARGET on invalid/unset.
 */
export function getCompactionTarget(): number {
  const proc = typeof globalThis !== "undefined" ? (globalThis as any).process : undefined;
  const raw = proc?.env?.DAXIOM_COMPACTION_TARGET?.trim();
  if (!raw) {
    return DEFAULT_COMPACTION_TARGET;
  }
  const val = Number(raw);
  if (Number.isFinite(val) && val > 0 && val < 1) {
    return val;
  }
  return DEFAULT_COMPACTION_TARGET;
}

// ---------------------------------------------------------------------------
// Compaction Metrics
// ---------------------------------------------------------------------------

export interface CompactionMetrics {
  /** Why compaction was triggered or not. */
  compactionReason: string;
  /** Whether compaction actually ran and succeeded. */
  compactionSucceeded: boolean;
  /** Estimated input tokens before compaction. */
  beforeTokens: number;
  /** Estimated input tokens after compaction (same as before if not triggered). */
  afterTokens: number;
  /** Absolute token savings. */
  tokensSaved: number;
  /** Fraction of tokens saved (0 if not triggered or failed). */
  reductionRatio: number;
  /** Number of messages before compaction. */
  messagesBefore: number;
  /** Number of messages after compaction. */
  messagesAfter: number;
  /** Estimated token count of the TaskMemory anchor. */
  taskMemorySize: number;
}

// ---------------------------------------------------------------------------
// Message Grouping (tool-call/result pair integrity)
// ---------------------------------------------------------------------------

/**
 * An atomic unit of conversation that must not be split.
 */
export interface MessageGroup {
  messages: ChatMessage[];
  /** Tool call IDs declared by the assistant message in this group. */
  pendingToolCallIds: Set<string>;
  /** Whether this group has any tool result messages. */
  hasToolResults: boolean;
}

/**
 * Group non-system messages into atomic MessageGroups that preserve
 * tool-call / tool-result pairing.
 *
 * Rules:
 *  - A user message always forms its own group.
 *  - An assistant message starts a new group; any subsequent tool messages
 *    (with matching tool_call_id) are appended to the same group.
 */
export function groupMessages(nonSystemMessages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentGroup: ChatMessage[] = [];
  let currentPendingIds = new Set<string>();

  const flush = (): void => {
    if (currentGroup.length > 0) {
      groups.push({
        messages: currentGroup,
        pendingToolCallIds: new Set(currentPendingIds),
        hasToolResults: currentGroup.some((m) => m.role === "tool"),
      });
      currentGroup = [];
      currentPendingIds = new Set();
    }
  };

  for (const msg of nonSystemMessages) {
    if (msg.role === "user") {
      flush();
      groups.push({ messages: [msg], pendingToolCallIds: new Set(), hasToolResults: false });
    } else if (msg.role === "assistant") {
      flush();
      currentGroup.push(msg);
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.id) {
            currentPendingIds.add(tc.id);
          }
        }
      }
    } else if (msg.role === "tool") {
      // Belongs to current assistant group
      currentGroup.push(msg);
    } else {
      // Unknown role — flush and add standalone
      flush();
      groups.push({ messages: [msg], pendingToolCallIds: new Set(), hasToolResults: false });
    }
  }

  flush();
  return groups;
}

/**
 * Validate that no tool result exists without its corresponding assistant tool_call.
 */
export function validateToolCallPairIntegrity(messages: ChatMessage[]): boolean {
  const declaredIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id) {
          declaredIds.add(tc.id);
        }
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === "tool" && msg.tool_call_id) {
      if (!declaredIds.has(msg.tool_call_id)) {
        return false; // orphaned tool result
      }
    }
  }

  return true;
}

/**
 * Validate the full compacted message array.
 * Returns null on success, or an error string on failure.
 */
export function validateCompactedHistory(
  compacted: ChatMessage[],
  expectedSystemContent: string,
): string | null {
  if (compacted.length === 0) {
    return "Empty message array after compaction";
  }
  if (compacted[0].role !== "system") {
    return "System prompt missing (not at index 0)";
  }
  if (typeof compacted[0].content !== "string" || !compacted[0].content.trim()) {
    return "System prompt is empty";
  }
  if (compacted[0].content !== expectedSystemContent) {
    return "System prompt content was mutated during compaction";
  }
  if (!validateToolCallPairIntegrity(compacted)) {
    return "Tool call/result pair integrity violated";
  }
  // No empty assistant message (provider rejects them)
  for (const msg of compacted) {
    if (msg.role === "assistant" && !msg.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
      return "Empty assistant message found (no content, no tool calls)";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Compaction Entry Point
// ---------------------------------------------------------------------------

export interface CompactWithTaskMemoryOptions {
  messages: ChatMessage[];
  inputBudgetTokens: number;
  /** Formatted TaskMemory anchor text (injected as a user message in the dynamic suffix). */
  taskMemoryAnchor: string;
  /** High-watermark fraction — default: DEFAULT_COMPACTION_HIGH_WATERMARK (DESIGN TARGET). */
  highWatermark?: number;
  /** Target fraction after compaction — default: DEFAULT_COMPACTION_TARGET (DESIGN TARGET). */
  target?: number;
  /** Number of recent turn-groups to preserve — default: DEFAULT_RECENT_TURNS_WINDOW (DESIGN TARGET). */
  recentTurnsWindow?: number;
}

export interface CompactWithTaskMemoryResult {
  messages: ChatMessage[];
  metrics: CompactionMetrics;
}

/**
 * Compact conversation history, injecting a TaskMemory anchor.
 *
 * Algorithm:
 *   1. Measure tokens. If below high-watermark, return unchanged.
 *   2. Group non-system messages into atomic turn-groups.
 *   3. Protect the `recentTurnsWindow` newest groups.
 *   4. Build: [system] + [TaskMemory anchor (user msg)] + [recent groups].
 *   5. Validate. On failure, fail open to original.
 *   6. Remeasure and report metrics.
 *
 * Guarantees:
 *   - Never mutates the input array.
 *   - Fails open on any error.
 *   - Does not loop (MAX_COMPACTION_PASSES = 1).
 *   - Does not alter the stable Phase 4 system prefix content.
 */
export function compactHistoryWithTaskMemory(
  opts: CompactWithTaskMemoryOptions,
): CompactWithTaskMemoryResult {
  const {
    messages,
    inputBudgetTokens,
    taskMemoryAnchor,
    highWatermark = DEFAULT_COMPACTION_HIGH_WATERMARK,
    target = DEFAULT_COMPACTION_TARGET,
    recentTurnsWindow = DEFAULT_RECENT_TURNS_WINDOW,
  } = opts;

  const beforeTokens = estimateMessagesTokens(messages);
  const messagesBefore = messages.length;

  const makeNoop = (reason: string): CompactWithTaskMemoryResult => ({
    messages: [...messages],
    metrics: {
      compactionReason: reason,
      compactionSucceeded: false,
      beforeTokens,
      afterTokens: beforeTokens,
      tokensSaved: 0,
      reductionRatio: 0,
      messagesBefore,
      messagesAfter: messagesBefore,
      taskMemorySize: 0,
    },
  });

  // 1. Threshold check
  const hwThreshold = Math.floor(inputBudgetTokens * highWatermark);
  if (beforeTokens <= hwThreshold) {
    return makeNoop("below-threshold");
  }

  const systemMsg = messages[0];
  if (!systemMsg || systemMsg.role !== "system" || typeof systemMsg.content !== "string") {
    if (process.env.DEBUG_TOKEN_BUDGET === "1") {
      console.debug("[ContextCompaction] No system message at index 0; skipping");
    }
    return makeNoop("no-system-message");
  }

  const originalSystemContent = systemMsg.content;

  try {
    const nonSystem = messages.slice(1);
    const groups = groupMessages(nonSystem);

    if (groups.length === 0) {
      return makeNoop("insufficient-groups");
    }

    // 2. Protect recent window
    const windowSize = Math.min(recentTurnsWindow, groups.length);
    const recentGroups = groups.slice(groups.length - windowSize);
    const recentMessages = recentGroups.flatMap((g) => g.messages);

    // 3. Build TaskMemory anchor (user message, in the DYNAMIC suffix)
    const anchorMsg: ChatMessage = {
      role: "user",
      content: taskMemoryAnchor,
    };
    const taskMemorySize = estimateTokens(taskMemoryAnchor);

    // 4. Build candidate
    const candidate: ChatMessage[] = [systemMsg, anchorMsg, ...recentMessages];

    // 5. Validate
    const err = validateCompactedHistory(candidate, originalSystemContent);
    if (err) {
      if (process.env.DEBUG_TOKEN_BUDGET === "1") {
        console.debug(`[ContextCompaction] Validation failed (${err}); failing open`);
      }
      return makeNoop(`validation-failed:${err}`);
    }

    const afterTokens = estimateMessagesTokens(candidate);
    const tokensSaved = Math.max(0, beforeTokens - afterTokens);
    const reductionRatio = beforeTokens > 0 ? tokensSaved / beforeTokens : 0;

    const metrics: CompactionMetrics = {
      compactionReason: "high-watermark",
      compactionSucceeded: true,
      beforeTokens,
      afterTokens,
      tokensSaved,
      reductionRatio,
      messagesBefore,
      messagesAfter: candidate.length,
      taskMemorySize,
    };

    if (process.env.DEBUG_TOKEN_BUDGET === "1") {
      const targetThreshold = Math.floor(inputBudgetTokens * target);
      const aboveTarget = afterTokens > targetThreshold;
      console.log(
        `[ContextCompaction] compacted: ${beforeTokens}→${afterTokens} tokens ` +
        `(${(reductionRatio * 100).toFixed(1)}% reduction, ` +
        `${messagesBefore}→${candidate.length} msgs, ` +
        `taskMemory=${taskMemorySize} tok, ` +
        `aboveTarget=${aboveTarget})`,
      );
    }

    return { messages: candidate, metrics };
  } catch (err) {
    if (process.env.DEBUG_TOKEN_BUDGET === "1") {
      console.debug("[ContextCompaction] Unexpected error; failing open", err);
    }
    return makeNoop(`error:${String(err)}`);
  }
}
