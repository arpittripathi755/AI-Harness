/**
 * Adaptive per-phase token budgeting for LLM completions.
 *
 * Placed in src/llm/ alongside LLMClient.ts and ProviderClient.ts because it manages
 * request-time execution token budgeting for LLM calls, keeping models.ts focused on static model metadata.
 */

import { getModelByApiId, resolveMaxTokens } from "../shared/models";

export type CallPhase = "tool_decision" | "edit" | "explain" | "plan";

export const PHASE_BUDGET: Record<CallPhase, number> = {
  tool_decision: 1024,
  edit: 4096,
  explain: 1536,
  plan: 2048,
};

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
 * Resolution order (each step can only lower the value, never raise it):
 * 1. Start with `override` if provided and positive, otherwise `PHASE_BUDGET[phase]`.
 * 2. Cap by the env ceiling (MAX_TOKENS / AI_MAX_TOKENS) when set. Env becomes a hard CEILING, not the default.
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

