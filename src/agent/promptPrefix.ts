import * as crypto from "crypto";
import type { ChatMessage, ToolDefinition } from "../llm/types";
import { estimateTokens, estimateMessagesTokens } from "../llm/contextBudget";

/**
 * Feature flag for Phase 4: Stable Prompt Prefix.
 * When ON, the system prompt and tool definitions are kept strictly immutable
 * across turns, while dynamic working memory and task state are attached
 * as an ephemeral message at the tail of the request.
 */
export function isStablePromptPrefixEnabled(): boolean {
  const val =
    process.env.DAXIOM_STABLE_PROMPT_PREFIX ??
    process.env.DAXIOM_STABLE_CACHE_PREFIX;
  return val === "1" || val === "true";
}

/**
 * Recursively stringifies an object with keys sorted alphabetically.
 * Ensures deterministic serialization across different object key insertion orders.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJsonStringify(item)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries: string[] = [];
  for (const key of sortedKeys) {
    const val = obj[key];
    if (val !== undefined) {
      entries.push(`${JSON.stringify(key)}:${canonicalJsonStringify(val)}`);
    }
  }
  return "{" + entries.join(",") + "}";
}

/**
 * Canonicalizes tool definitions to ensure deterministic property ordering.
 * Tool order in the array is preserved to maintain semantic intent.
 */
export function canonicalizeToolDefinitions(
  tools: ToolDefinition[] | undefined,
): ToolDefinition[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: tool.type,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters
        ? (JSON.parse(canonicalJsonStringify(tool.function.parameters)) as Record<string, unknown>)
        : undefined,
    },
  }));
}

/**
 * Smallest clean abstraction representing the stable prefix of a model request.
 */
export interface StablePromptPrefix {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  model: string;
  provider?: string;
  serialized: string;
  hash: string;
  bytes: number;
  estimatedTokens: number;
}

export type PrefixInvalidationReason =
  | "initial"
  | "system_prompt"
  | "tool_schema"
  | "model"
  | "provider"
  | "capability_profile";

export interface PrefixStats {
  prefixHash: string;
  prefixBytes: number;
  prefixEstimatedTokens: number;
  suffixBytes: number;
  suffixEstimatedTokens: number;
  totalEstimatedTokens: number;
  invalidationReason?: PrefixInvalidationReason;
}

/**
 * Tracks prefix stability and invalidation reasons across consecutive requests.
 */
export class PromptPrefixTracker {
  private lastHash: string | null = null;
  private lastSystemPrompt: string | null = null;
  private lastToolsSerialized: string | null = null;
  private lastModel: string | null = null;
  private lastProvider: string | null = null;
  private requestCount = 0;
  private hashChangeCount = 0;

  recordRequest(
    currentHash: string,
    systemPrompt: string,
    toolsSerialized: string,
    model: string,
    provider: string,
    stats: Omit<PrefixStats, "invalidationReason">,
  ): PrefixStats {
    this.requestCount++;
    let reason: PrefixInvalidationReason | undefined;

    if (this.lastHash === null) {
      reason = "initial";
    } else if (currentHash !== this.lastHash) {
      this.hashChangeCount++;
      if (this.lastSystemPrompt !== systemPrompt) {
        reason = "system_prompt";
      } else if (this.lastToolsSerialized !== toolsSerialized) {
        reason = "tool_schema";
      } else if (this.lastModel !== model) {
        reason = "model";
      } else if (this.lastProvider !== provider) {
        reason = "provider";
      } else {
        reason = "capability_profile";
      }

      if (process.env.DEBUG_TOKEN_BUDGET === "1") {
        console.debug(
          `[StablePromptPrefix] PREFIX_CHANGED reason=${reason} oldHash=${this.lastHash.slice(0, 12)} newHash=${currentHash.slice(0, 12)}`,
        );
      }
    }

    if (process.env.DEBUG_TOKEN_BUDGET === "1") {
      console.debug(
        `[StablePromptPrefix] request #${this.requestCount} prefixHash=${currentHash.slice(0, 12)} ` +
          `prefixBytes=${stats.prefixBytes} prefixTokens=${stats.prefixEstimatedTokens} ` +
          `suffixBytes=${stats.suffixBytes} suffixTokens=${stats.suffixEstimatedTokens} ` +
          `totalTokens=${stats.totalEstimatedTokens}`,
      );
    }

    this.lastHash = currentHash;
    this.lastSystemPrompt = systemPrompt;
    this.lastToolsSerialized = toolsSerialized;
    this.lastModel = model;
    this.lastProvider = provider;

    return { ...stats, invalidationReason: reason };
  }

  get statsSummary() {
    return {
      totalRequests: this.requestCount,
      hashChanges: this.hashChangeCount,
      stabilityRate:
        this.requestCount > 1
          ? ((this.requestCount - 1 - this.hashChangeCount) / (this.requestCount - 1)) * 100
          : 100,
    };
  }

  reset(): void {
    this.lastHash = null;
    this.lastSystemPrompt = null;
    this.lastToolsSerialized = null;
    this.lastModel = null;
    this.lastProvider = null;
    this.requestCount = 0;
    this.hashChangeCount = 0;
  }
}

/**
 * Combines dynamic working memory and orchestrator phase info into a single formatted block.
 */
export function formatDynamicTaskContext(
  workingMemorySection?: string,
  phaseBlock?: string,
): string {
  const parts: string[] = [];
  if (workingMemorySection && workingMemorySection.trim()) {
    parts.push(workingMemorySection.trim());
  }
  if (phaseBlock && phaseBlock.trim()) {
    parts.push(phaseBlock.trim());
  }
  return parts.join("\n\n");
}

export interface PartitionPromptOptions {
  stableSystemPrompt: string;
  tools?: ToolDefinition[];
  model: string;
  provider?: string;
  history: ChatMessage[];
  dynamicContext?: string;
  tracker?: PromptPrefixTracker;
}

export interface PartitionPromptResult {
  stablePrefix: StablePromptPrefix;
  outgoingMessages: ChatMessage[];
  stats: PrefixStats;
}

/**
 * Partitions a prompt request into a deterministic stable prefix and a dynamic suffix.
 * The conversation history is preserved immutably.
 */
export function partitionPrompt(options: PartitionPromptOptions): PartitionPromptResult {
  const canonicalTools = canonicalizeToolDefinitions(options.tools);
  const toolsSerialized = canonicalTools ? canonicalJsonStringify(canonicalTools) : "[]";

  const prefixObject = {
    model: options.model,
    provider: options.provider ?? "default",
    system: options.stableSystemPrompt,
    tools: canonicalTools ?? [],
  };

  const serialized = canonicalJsonStringify(prefixObject);
  const hash = crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
  const prefixBytes = Buffer.byteLength(serialized, "utf8");

  const systemTokens = estimateTokens(options.stableSystemPrompt);
  const toolsTokens = canonicalTools ? Math.ceil(toolsSerialized.length / 3.5) : 0;
  const prefixEstimatedTokens = systemTokens + toolsTokens + 4; // overhead

  const stablePrefix: StablePromptPrefix = {
    messages: [{ role: "system", content: options.stableSystemPrompt }],
    tools: canonicalTools,
    model: options.model,
    provider: options.provider ?? "default",
    serialized,
    hash,
    bytes: prefixBytes,
    estimatedTokens: prefixEstimatedTokens,
  };

  // Build outgoingMessages: immutable copy of history
  const outgoingMessages: ChatMessage[] = [...options.history];

  // If dynamicContext is present and the last message in history is not already a user message,
  // append it as an ephemeral user message at the tail.
  if (options.dynamicContext && options.dynamicContext.trim().length > 0) {
    const lastMsg = outgoingMessages[outgoingMessages.length - 1];
    if (lastMsg && lastMsg.role !== "user") {
      outgoingMessages.push({
        role: "user",
        content: `[CURRENT TASK CONTEXT]\n${options.dynamicContext.trim()}`,
      });
    }
  }

  // Calculate suffix statistics
  const suffixMessages = outgoingMessages.slice(1);
  const suffixSerialized = JSON.stringify(suffixMessages);
  const suffixBytes = Buffer.byteLength(suffixSerialized, "utf8");
  const suffixEstimatedTokens = estimateMessagesTokens(suffixMessages);
  const totalEstimatedTokens = prefixEstimatedTokens + suffixEstimatedTokens;

  let stats: PrefixStats = {
    prefixHash: hash,
    prefixBytes,
    prefixEstimatedTokens,
    suffixBytes,
    suffixEstimatedTokens,
    totalEstimatedTokens,
  };

  if (options.tracker) {
    stats = options.tracker.recordRequest(
      hash,
      options.stableSystemPrompt,
      toolsSerialized,
      options.model,
      options.provider ?? "default",
      stats,
    );
  }

  return {
    stablePrefix,
    outgoingMessages,
    stats,
  };
}
