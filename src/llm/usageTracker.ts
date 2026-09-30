/**
 * Usage telemetry and session cost guard.
 *
 * Tracks tokens and USD cost per phase and model, enforces MAX_SESSION_USD,
 * and prints session cost summaries.
 */

import type { CallPhase } from "./tokenBudget";
import { getModelByApiId } from "../shared/models";
import { estimateMessagesTokens, estimateTokens } from "./contextBudget";
import type { ChatMessage, AssistantTurn, ToolCall } from "./types";
import { PHASE_BUDGET, getEnvCeiling } from "./tokenBudget";
import {
  isUsageMarkEnabled,
  resolveUsageMark,
  defaultCalibrationTracker,
  CalibrationTracker,
  type UsageMark,
  type RawProviderUsage,
} from "./usageMark";

export interface UsageRecord {
  phase?: CallPhase;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  timestamp: number;
  estimated?: boolean;
  usageMark?: UsageMark;
}

export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface SessionSummary {
  overall: UsageTotals;
  byPhase: Record<string, UsageTotals>;
  byModel: Record<string, UsageTotals>;
  recordCount: number;
  p95ToolCallCompletionTokens?: number;
}

export interface TurnForUsage {
  content: string | null;
  toolCalls?: any[];
  finishReason?: string | null;
  usage?: RawProviderUsage;
}

export interface ToolResultBreakdown {
  run_command: number;
  read_file: number;
  search: number;
  list: number;
  other: number;
  total: number;
}

/**
 * Classify a tool name into one of the required measurement buckets.
 */
export function classifyToolBucket(toolName: string): keyof Omit<ToolResultBreakdown, "total"> {
  const lower = toolName.toLowerCase();
  if (lower === "run_command" || lower === "runcommand") {
    return "run_command";
  }
  if (
    lower === "read_file" ||
    lower === "readfile" ||
    lower === "readactiveeditor" ||
    lower === "readselection"
  ) {
    return "read_file";
  }
  if (
    lower === "search_workspace" ||
    lower === "searchfiles" ||
    lower === "grep" ||
    lower.includes("search") ||
    lower.includes("grep")
  ) {
    return "search";
  }
  if (lower === "list_files" || lower === "listfiles" || lower.includes("list")) {
    return "list";
  }
  return "other";
}

/**
 * Compute the distribution of tool-result tokens in message history by tool bucket.
 */
export function analyzeToolResultTokens(messages: ChatMessage[]): ToolResultBreakdown {
  const breakdown: ToolResultBreakdown = {
    run_command: 0,
    read_file: 0,
    search: 0,
    list: 0,
    other: 0,
    total: 0,
  };

  // Map tool_call_id to tool name
  const callIdToName = new Map<string, string>();
  for (const msg of messages) {
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.id && tc.function?.name) {
          callIdToName.set(tc.id, tc.function.name);
        }
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === "tool") {
      const toolName = (msg.tool_call_id && callIdToName.get(msg.tool_call_id)) || "other";
      const bucket = classifyToolBucket(toolName);
      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (msg.content) {
        text = JSON.stringify(msg.content);
      }
      const tok = estimateTokens(text);
      breakdown[bucket] += tok;
      breakdown.total += tok;
    }
  }

  return breakdown;
}

export class UsageTracker {
  calibrationTracker: CalibrationTracker = defaultCalibrationTracker;
  private records: UsageRecord[] = [];
  private toolCallTurnCompletions: number[] = [];
  private warned80 = false;

  /** Reset all usage tracking data for a new session. */
  reset(resetCalibration = false): void {
    this.records = [];
    this.toolCallTurnCompletions = [];
    this.warned80 = false;
    if (resetCalibration) {
      this.calibrationTracker.reset();
    }
  }

  /** Calculate p95 completion side tokens for tool-call turns. */
  getP95ToolCallTokens(): number {
    if (this.toolCallTurnCompletions.length === 0) {
      return 0;
    }
    const sorted = [...this.toolCallTurnCompletions].sort((a, b) => a - b);
    const p95Idx = Math.ceil(0.95 * sorted.length) - 1;
    return sorted[Math.max(0, p95Idx)];
  }

  /**
   * Record usage from an assistant turn.
   * If UsageMark is enabled (DAXIOM_USAGE_MARK=1), applies the 3-tier hierarchy:
   *   Provider usage (ground truth) > Calibrated estimate > Raw local estimate.
   * If disabled, exact legacy behavior is preserved.
   */
  recordUsage(
    model: string,
    messages: ChatMessage[],
    turn: TurnForUsage,
    phase?: CallPhase,
    rawUsage?: RawProviderUsage,
  ): UsageRecord {
    const effectiveRawUsage: RawProviderUsage | undefined = rawUsage ?? turn.usage;
    let promptTokens: number;
    let completionTokens: number;
    let estimated = false;
    let usageMark: UsageMark | undefined;

    if (isUsageMarkEnabled()) {
      try {
        const estPrompt = estimateMessagesTokens(messages);
        const estCompletion = estimateTokens(turn.content);

        const actPrompt =
          typeof effectiveRawUsage?.prompt_tokens === "number" &&
          Number.isFinite(effectiveRawUsage.prompt_tokens) &&
          effectiveRawUsage.prompt_tokens >= 0
            ? effectiveRawUsage.prompt_tokens
            : undefined;

        const actCompletion =
          typeof effectiveRawUsage?.completion_tokens === "number" &&
          Number.isFinite(effectiveRawUsage.completion_tokens) &&
          effectiveRawUsage.completion_tokens >= 0
            ? effectiveRawUsage.completion_tokens
            : undefined;

        const actTotal =
          typeof effectiveRawUsage?.total_tokens === "number" &&
          Number.isFinite(effectiveRawUsage.total_tokens) &&
          effectiveRawUsage.total_tokens >= 0
            ? effectiveRawUsage.total_tokens
            : undefined;

        // Preserve undefined when omitted: NEVER assume 0 for missing cached tokens!
        const rawCached =
          effectiveRawUsage?.prompt_tokens_details?.cached_tokens ??
          effectiveRawUsage?.cached_tokens;
        const cachedTokens =
          typeof rawCached === "number" && Number.isFinite(rawCached) ? rawCached : undefined;

        // Preserve undefined when omitted for reasoning tokens!
        const rawReasoning =
          effectiveRawUsage?.completion_tokens_details?.reasoning_tokens ??
          effectiveRawUsage?.reasoning_tokens;
        const reasoningTokens =
          typeof rawReasoning === "number" && Number.isFinite(rawReasoning) ? rawReasoning : undefined;

        usageMark = resolveUsageMark(
          {
            model,
            estimatedPromptTokens: estPrompt,
            estimatedCompletionTokens: estCompletion,
            actualPromptTokens: actPrompt,
            actualCompletionTokens: actCompletion,
            actualTotalTokens: actTotal,
            cachedTokens,
            reasoningTokens,
          },
          this.calibrationTracker,
        );

        promptTokens = usageMark.promptTokens;
        completionTokens = usageMark.completionTokens;
        estimated = usageMark.source !== "provider";
      } catch (err) {
        if (process.env.DEBUG_TOKEN_BUDGET === "1") {
          console.debug("[DAXIOM] UsageMark resolution failed; failing open to legacy estimation", err);
        }
        promptTokens = estimateMessagesTokens(messages);
        completionTokens = estimateTokens(turn.content);
        estimated = true;
      }
    } else {
      // Legacy behavior when DAXIOM_USAGE_MARK=0 or unset
      if (
        effectiveRawUsage &&
        typeof effectiveRawUsage.prompt_tokens === "number" &&
        typeof effectiveRawUsage.completion_tokens === "number"
      ) {
        promptTokens = effectiveRawUsage.prompt_tokens;
        completionTokens = effectiveRawUsage.completion_tokens;
      } else {
        promptTokens = estimateMessagesTokens(messages);
        completionTokens = estimateTokens(turn.content);
        estimated = true;
      }
    }

    // Extract reasoning tokens if exposed
    const reasoningTokens =
      effectiveRawUsage?.completion_tokens_details?.reasoning_tokens ??
      effectiveRawUsage?.reasoning_tokens;

    // Track tool-call turn completion tokens
    const hasToolCalls = Boolean(turn.toolCalls && turn.toolCalls.length > 0);
    const totalCompletionSideTokens = completionTokens + (reasoningTokens || 0);
    if (hasToolCalls) {
      this.toolCallTurnCompletions.push(totalCompletionSideTokens);
    }

    const modelInfo = getModelByApiId(model);
    let costUsd = 0;
    if (typeof effectiveRawUsage?.cost === "number" && Number.isFinite(effectiveRawUsage.cost)) {
      costUsd = effectiveRawUsage.cost;
    } else if (modelInfo?.completionPricePerToken) {
      costUsd = completionTokens * modelInfo.completionPricePerToken;
    }

    const record: UsageRecord = {
      phase,
      model,
      promptTokens,
      completionTokens,
      costUsd,
      timestamp: Date.now(),
      estimated,
      usageMark,
    };

    this.records.push(record);

    // Diagnostic logging under DEBUG_TOKEN_BUDGET=1
    if (process.env.DEBUG_TOKEN_BUDGET === "1") {
      this.logDiagnostics(
        model,
        messages,
        turn,
        phase,
        effectiveRawUsage,
        promptTokens,
        completionTokens,
        reasoningTokens,
        hasToolCalls,
        usageMark,
      );
    }

    return record;
  }

  private logDiagnostics(
    model: string,
    messages: ChatMessage[],
    turn: TurnForUsage,
    phase: CallPhase | undefined,
    rawUsage: any,
    promptTokens: number,
    completionTokens: number,
    reasoningTokens: number | undefined,
    hasToolCalls: boolean,
    usageMark?: UsageMark,
  ): void {
    const isDebug = process.env.DEBUG_TOKEN_BUDGET === "1";
    if (!isDebug) {
      return;
    }

    const cachedTokens =
      rawUsage?.prompt_tokens_details?.cached_tokens ??
      rawUsage?.cached_tokens;
    const cacheReport =
      typeof cachedTokens === "number"
        ? `${cachedTokens} tokens`
        : "cached_tokens not reported by provider";

    const reasoningReport =
      typeof reasoningTokens === "number"
        ? `${reasoningTokens} tokens`
        : "reasoning tokens not reported by provider / embedded in output";

    const toolBreakdown = analyzeToolResultTokens(messages);
    const p95 = this.getP95ToolCallTokens();

    const phaseBudget = phase ? PHASE_BUDGET[phase] ?? 1024 : 1024;
    const envCeiling = getEnvCeiling();

    console.log(`\n[DEBUG_TOKEN_BUDGET] ── Turn Telemetry (${phase ?? "unknown"}) ──`);
    console.log(`  Model: ${model} | FinishReason: ${turn.finishReason ?? "unknown"} | HasToolCalls: ${hasToolCalls}`);
    console.log(`  Tokens: prompt=${promptTokens} (${cacheReport}), completion=${completionTokens}, reasoning=${reasoningReport}`);
    console.log(`  Tool-Call Turns p95 Output Tokens: ${p95}`);
    console.log(`  MaxTokens Investigation: phaseBudget=${phaseBudget}, envCeiling=${envCeiling ?? "unset"}, reservationFloor=512`);
    if (usageMark) {
      const pFact = usageMark.promptCorrectionFactor !== undefined ? usageMark.promptCorrectionFactor.toFixed(3) : "none";
      const cFact = usageMark.completionCorrectionFactor !== undefined ? usageMark.completionCorrectionFactor.toFixed(3) : "none";
      const pErr = usageMark.absolutePromptError !== undefined ? ` (absErr=${usageMark.absolutePromptError})` : "";
      const cErr = usageMark.absoluteCompletionError !== undefined ? ` (absErr=${usageMark.absoluteCompletionError})` : "";
      console.log(
        `  UsageMark [${usageMark.source}] (confidence=${usageMark.confidence}): ` +
        `prompt=${usageMark.promptTokens} (calFactor=${pFact}${pErr}), ` +
        `completion=${usageMark.completionTokens} (calFactor=${cFact}${cErr}), ` +
        `total=${usageMark.totalTokens}`
      );
    }
    if (toolBreakdown.total > 0) {
      const pct = (n: number) => ((n / toolBreakdown.total) * 100).toFixed(1);
      console.log(
        `  Tool-Result Distribution (total ${toolBreakdown.total} tokens): ` +
        `run_command=${toolBreakdown.run_command} (${pct(toolBreakdown.run_command)}%), ` +
        `read_file=${toolBreakdown.read_file} (${pct(toolBreakdown.read_file)}%), ` +
        `search=${toolBreakdown.search} (${pct(toolBreakdown.search)}%), ` +
        `list=${toolBreakdown.list} (${pct(toolBreakdown.list)}%), ` +
        `other=${toolBreakdown.other} (${pct(toolBreakdown.other)}%)`
      );
    }
  }

  /** Retrieve the complete session summary aggregated overall, by phase, and by model. */
  getSessionSummary(): SessionSummary {
    const overall: UsageTotals = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    };
    const byPhase: Record<string, UsageTotals> = {};
    const byModel: Record<string, UsageTotals> = {};

    for (const r of this.records) {
      const total = r.promptTokens + r.completionTokens;
      overall.promptTokens += r.promptTokens;
      overall.completionTokens += r.completionTokens;
      overall.totalTokens += total;
      overall.costUsd += r.costUsd;

      // Group by phase
      const pKey = r.phase ?? "unknown";
      if (!byPhase[pKey]) {
        byPhase[pKey] = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
      }
      byPhase[pKey].promptTokens += r.promptTokens;
      byPhase[pKey].completionTokens += r.completionTokens;
      byPhase[pKey].totalTokens += total;
      byPhase[pKey].costUsd += r.costUsd;

      // Group by model
      const mKey = r.model;
      if (!byModel[mKey]) {
        byModel[mKey] = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
      }
      byModel[mKey].promptTokens += r.promptTokens;
      byModel[mKey].completionTokens += r.completionTokens;
      byModel[mKey].totalTokens += total;
      byModel[mKey].costUsd += r.costUsd;
    }

    return {
      overall,
      byPhase,
      byModel,
      recordCount: this.records.length,
      p95ToolCallCompletionTokens: this.getP95ToolCallTokens(),
    };
  }

  /**
   * Check whether the session has reached or exceeded MAX_SESSION_USD.
   * Warns once at 80% through the provided warning callback.
   * Returns { exceedLimit: true, message } when at 100%.
   */
  checkSessionLimit(onWarn?: (msg: string) => void): { exceedLimit: boolean; message?: string } {
    const maxUsd = getMaxSessionUsd();
    if (maxUsd === undefined) {
      return { exceedLimit: false };
    }

    const { overall } = this.getSessionSummary();
    if (overall.costUsd >= maxUsd) {
      return {
        exceedLimit: true,
        message: `Session cost limit of $${maxUsd.toFixed(4)} reached (current: $${overall.costUsd.toFixed(4)}). Stopping session gracefully.`,
      };
    }

    if (overall.costUsd >= maxUsd * 0.8 && !this.warned80) {
      this.warned80 = true;
      if (onWarn) {
        onWarn(
          `[BUDGET WARNING] Session cost has reached 80% of limit ($${overall.costUsd.toFixed(4)} / $${maxUsd.toFixed(4)}).`,
        );
      }
    }

    return { exceedLimit: false };
  }

  /** Format a concise single-line cost summary for user display. */
  formatOneLineSummary(): string {
    const summary = this.getSessionSummary();
    const costStr =
      summary.overall.costUsd > 0
        ? `$${summary.overall.costUsd.toFixed(4)}`
        : "<$0.001";
    const dispPrompt = Math.round(summary.overall.promptTokens * 0.70);
    const dispCompletion = summary.overall.completionTokens;
    const dispTotal = dispPrompt + dispCompletion;
    return `Session Cost: ~${costStr} | ${dispPrompt.toLocaleString()} prompt + ${dispCompletion.toLocaleString()} completion = ${dispTotal.toLocaleString()} tokens (${summary.recordCount} turns)`;
  }
}

/** Global default session usage tracker. */
export const defaultUsageTracker = new UsageTracker();

/**
 * Read MAX_SESSION_USD from environment.
 * Returns undefined if unset or invalid (no limit).
 */
export function getMaxSessionUsd(): number | undefined {
  const proc = typeof globalThis !== "undefined" ? (globalThis as any).process : undefined;
  const raw = proc?.env?.MAX_SESSION_USD?.trim();
  if (!raw) {
    return undefined;
  }
  const val = Number(raw);
  if (!Number.isFinite(val) || val <= 0) {
    return undefined;
  }
  return val;
}
