/**
 * Usage telemetry and session cost guard.
 *
 * Tracks tokens and USD cost per phase and model, enforces MAX_SESSION_USD,
 * and prints session cost summaries.
 */

import type { CallPhase } from "./tokenBudget";
import { getModelByApiId } from "../shared/models";
import { estimateMessagesTokens, estimateTokens } from "./contextBudget";
import type { ChatMessage, AssistantTurn } from "./types";

export interface UsageRecord {
  phase?: CallPhase;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  timestamp: number;
  estimated?: boolean;
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
}

export interface TurnForUsage {
  content: string | null;
  toolCalls?: any[];
  finishReason?: string | null;
}

export class UsageTracker {
  private records: UsageRecord[] = [];
  private warned80 = false;

  /** Reset all usage tracking data for a new session. */
  reset(): void {
    this.records = [];
    this.warned80 = false;
  }

  /**
   * Record usage from an assistant turn. If exact usage is available from the provider,
   * it is recorded; otherwise tokens are estimated.
   */
  recordUsage(
    model: string,
    messages: ChatMessage[],
    turn: TurnForUsage,
    phase?: CallPhase,
    rawUsage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number },
  ): UsageRecord {
    let promptTokens: number;
    let completionTokens: number;
    let estimated = false;

    if (
      rawUsage &&
      typeof rawUsage.prompt_tokens === "number" &&
      typeof rawUsage.completion_tokens === "number"
    ) {
      promptTokens = rawUsage.prompt_tokens;
      completionTokens = rawUsage.completion_tokens;
    } else {
      promptTokens = estimateMessagesTokens(messages);
      completionTokens = estimateTokens(turn.content);
      estimated = true;
    }

    const modelInfo = getModelByApiId(model);
    let costUsd = 0;
    if (typeof rawUsage?.cost === "number" && Number.isFinite(rawUsage.cost)) {
      costUsd = rawUsage.cost;
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
    };

    this.records.push(record);
    return record;
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
    return `Session Cost: ~${costStr} | ${summary.overall.promptTokens.toLocaleString()} prompt + ${summary.overall.completionTokens.toLocaleString()} completion = ${summary.overall.totalTokens.toLocaleString()} tokens (${summary.recordCount} turns)`;
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
