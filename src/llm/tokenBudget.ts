/**
 * Adaptive per-phase token budgeting for LLM completions.
 *
 * Placed in src/llm/ alongside LLMClient.ts and ProviderClient.ts because it manages
 * request-time execution token budgeting for LLM calls, keeping models.ts focused on static model metadata.
 */

import { getModelByApiId, resolveMaxTokens } from "../shared/models";

export type CallPhase = "tool_decision" | "edit" | "explain" | "plan";

export const PHASE_BUDGET: Record<CallPhase, number> = {
  tool_decision: 2048,  // raised: model needs room to reason + emit tool calls
  edit: 4096,
  explain: 2048,        // raised: summary turns were being cut off
  plan: 2048,
};

/**
 * Initial derived reasoning floor (2,560 tokens), calibrated from Phase 0 empirical
 * p95 measurement of 2,110 tokens on tool-call turns plus a ~20% safety margin (approximately 2,110 * 1.2).
 * Note: this is a configurable derived starting configuration, not a universal guarantee of correctness.
 */
export const DERIVED_REASONING_FLOOR = 2560;

/**
 * Read the minimum reasoning floor from DAXIOM_MIN_REASONING_FLOOR.
 * Returns 0 if unset, "0", or "false" (disabled by default).
 * When "1" or "true", returns DERIVED_REASONING_FLOOR (2560).
 * If a valid positive integer is provided, returns that value.
 */
export function getReasoningFloor(): number {
  const proc = typeof globalThis !== "undefined" ? (globalThis as any).process : undefined;
  const raw = proc?.env?.DAXIOM_MIN_REASONING_FLOOR?.trim();
  if (!raw || raw === "0" || raw === "false") {
    return 0;
  }
  if (raw === "1" || raw === "true") {
    return DERIVED_REASONING_FLOOR;
  }
  const val = Number(raw);
  if (Number.isFinite(val) && val > 0 && Number.isInteger(val)) {
    return val;
  }
  return 0;
}

/**
 * Read the hard ceiling from environment variables (MAX_TOKENS / AI_MAX_TOKENS).
 * Returns undefined if unset or invalid (invalid values do not establish a ceiling).
 */
export function getEnvCeiling(): number | undefined {
  const proc = typeof globalThis !== "undefined" ? (globalThis as any).process : undefined;
  const raw = proc?.env?.MAX_TOKENS?.trim() || proc?.env?.AI_MAX_TOKENS?.trim();
  if (!raw) {
    return undefined;
  }
  const val = Number(raw);
  if (!Number.isFinite(val) || val <= 0 || !Number.isInteger(val)) {
    return undefined;
  }
  return val;
}

/**
 * Compute the maximum completion tokens for a given call phase.
 *
 * Resolution order:
 * 1. Start with `override` if provided and positive, otherwise `PHASE_BUDGET[phase]`.
 *    If floor is active and phase is tool_decision or edit and override is unset, apply floor.
 * 2. Cap by the env ceiling (MAX_TOKENS / AI_MAX_TOKENS) when set.
 * 3. Cap by the model's maxOutputTokens if specified in model metadata.
 * 4. Validate through resolveMaxTokens so bad values never crash.
 */
export function getPhaseMaxTokens(
  phase: CallPhase,
  apiModelId: string,
  override?: number,
): number {
  // Step 1: Start with override if provided, otherwise phase default
  const defaultBudget = PHASE_BUDGET[phase] ?? 1024;
  let budget =
    override !== undefined && Number.isFinite(override) && override > 0
      ? override
      : defaultBudget;

  const floor = getReasoningFloor();
  if (floor > 0 && (phase === "tool_decision" || phase === "edit") && override === undefined) {
    budget = Math.max(budget, floor);
  }

  // Step 2: Cap by env ceiling if set
  const envCeiling = getEnvCeiling();
  if (envCeiling !== undefined) {
    budget = Math.min(budget, envCeiling);
  }

  // Step 3: Cap by model's maxOutputTokens
  const model = getModelByApiId(apiModelId);
  if (model?.maxOutputTokens && model.maxOutputTokens > 0) {
    budget = Math.min(budget, model.maxOutputTokens);
  }

  // Step 4: Validate through resolveMaxTokens
  return resolveMaxTokens(budget);
}

/**
 * Read optional phase -> apiModelId overrides from PHASE_MODEL_OVERRIDE env var (JSON format).
 * Returns undefined if no override is configured for the given phase.
 */
export function getPhaseModelOverride(phase: CallPhase): string | undefined {
  const proc = typeof globalThis !== "undefined" ? (globalThis as any).process : undefined;
  const raw = proc?.env?.PHASE_MODEL_OVERRIDE?.trim();
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed[phase] === "string" &&
      parsed[phase].trim()
    ) {
      return parsed[phase].trim();
    }
  } catch {
    // Malformed JSON: fail open/safe, ignore
  }
  return undefined;
}

