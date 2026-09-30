/**
 * UsageMark: Hybrid Token Estimation and Calibration Layer (Phase 5).
 *
 * Implements a 3-tier hierarchy for token accounting:
 *   1. Provider-reported usage (Ground Truth, source="provider", confidence="high")
 *   2. Calibrated local estimate (source="calibrated-estimate", confidence="medium")
 *   3. Raw local heuristic estimate (source="estimate", confidence="low")
 *
 * Feature Flag: DAXIOM_USAGE_MARK (default: OFF).
 * When disabled (0, false, off), legacy behavior is preserved with zero overhead.
 */

// ---------------------------------------------------------------------------
// Feature Flag & Configuration
// ---------------------------------------------------------------------------

/**
 * Check whether UsageMark hybrid token estimation is enabled.
 * Accepts: '1', 'true', 'on' (case-insensitive) as enabled.
 * Defaults to disabled ('0', 'false', 'off', or unset).
 */
export function isUsageMarkEnabled(): boolean {
  const proc = typeof globalThis !== "undefined" ? (globalThis as any).process : undefined;
  const val = proc?.env?.DAXIOM_USAGE_MARK?.trim().toLowerCase();
  return val === "1" || val === "true" || val === "on";
}

/**
 * Calibration parameters and bounds.
 *
 * DESIGN TARGET: Default alpha (0.2) provides conservative exponential smoothing,
 * preventing a single anomalous payload from drastically skewing estimates.
 *
 * DESIGN TARGET: Bounds [0.5, 2.0] restrict the correction factor to a 2x window,
 * ensuring stability against pathological edge cases.
 */
export const DEFAULT_CALIBRATION_ALPHA = 0.2; // DESIGN TARGET
export const MIN_CORRECTION_FACTOR = 0.5;      // DESIGN TARGET
export const MAX_CORRECTION_FACTOR = 2.0;      // DESIGN TARGET

// ---------------------------------------------------------------------------
// Types & Contracts
// ---------------------------------------------------------------------------

export type UsageSource = "provider" | "calibrated-estimate" | "estimate";
export type UsageConfidence = "high" | "medium" | "low";

export interface RawProviderUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
  [key: string]: unknown;
}

export interface UsageObservation {
  requestId?: string;
  turnId?: string;
  provider?: string;
  model: string;

  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  estimatedTotalTokens?: number;

  actualPromptTokens?: number;
  actualCompletionTokens?: number;
  actualTotalTokens?: number;

  cachedTokens?: number;
  reasoningTokens?: number;

  timestamp?: number;
}

export interface UsageMark {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;

  source: UsageSource;
  confidence: UsageConfidence;

  cachedTokens?: number;
  reasoningTokens?: number;

  requestId?: string;
  provider?: string;
  model: string;

  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  estimatedTotalTokens: number;

  actualPromptTokens?: number;
  actualCompletionTokens?: number;
  actualTotalTokens?: number;

  promptCorrectionFactor?: number;
  completionCorrectionFactor?: number;

  absolutePromptError?: number;
  relativePromptError?: number;

  absoluteCompletionError?: number;
  relativeCompletionError?: number;

  absoluteTotalError?: number;
  relativeTotalError?: number;
}

export interface CalibrationState {
  promptFactor: number;
  completionFactor: number;
  sampleCount: number;
  lastUpdated: number;
}

export interface CalibrationStats {
  identities: Record<string, CalibrationState>;
  totalObservations: number;
}

// ---------------------------------------------------------------------------
// Calibration Identity & Bounded Tracker
// ---------------------------------------------------------------------------

/**
 * Construct an isolated calibration identity key for a provider + model pair.
 * Ensures models from different providers (or different models from the same provider)
 * never share or poison each other's calibration factors.
 */
export function getCalibrationIdentity(provider?: string, model?: string): string {
  const p = (provider || "default").trim().toLowerCase();
  const m = (model || "unknown").trim().toLowerCase();
  return `${p}::${m}`;
}

/**
 * Clamp a number to [min, max].
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Safely compute relative error: |estimated - actual| / actual.
 * Returns undefined if actual is 0, non-positive, or non-finite (avoid division by zero).
 */
export function computeRelativeError(estimated: number, actual: number): number | undefined {
  if (!Number.isFinite(actual) || actual <= 0) {
    return undefined;
  }
  if (!Number.isFinite(estimated) || estimated < 0) {
    return undefined;
  }
  return Math.abs(estimated - actual) / actual;
}

/**
 * Calibration Tracker: maintains bounded exponential moving average factors
 * segregated by provider + model identity.
 */
export class CalibrationTracker {
  private readonly states = new Map<string, CalibrationState>();
  private totalObs = 0;
  private readonly alpha: number;
  private readonly minFactor: number;
  private readonly maxFactor: number;

  constructor(
    alpha: number = DEFAULT_CALIBRATION_ALPHA,
    minFactor: number = MIN_CORRECTION_FACTOR,
    maxFactor: number = MAX_CORRECTION_FACTOR,
  ) {
    this.alpha = alpha;
    this.minFactor = minFactor;
    this.maxFactor = maxFactor;
  }

  /** Reset all calibration states. */
  reset(): void {
    this.states.clear();
    this.totalObs = 0;
  }

  /** Retrieve the current calibration state for an identity, or undefined if uncalibrated. */
  getState(provider?: string, model?: string): Readonly<CalibrationState> | undefined {
    const key = getCalibrationIdentity(provider, model);
    const s = this.states.get(key);
    return s ? { ...s } : undefined;
  }

  /** Explicitly inject or override calibration state (useful for tests and initialization). */
  setState(provider: string | undefined, model: string, state: Partial<CalibrationState>): void {
    const key = getCalibrationIdentity(provider, model);
    const existing = this.states.get(key) ?? {
      promptFactor: 1.0,
      completionFactor: 1.0,
      sampleCount: 0,
      lastUpdated: Date.now(),
    };
    this.states.set(key, {
      promptFactor: state.promptFactor ?? existing.promptFactor,
      completionFactor: state.completionFactor ?? existing.completionFactor,
      sampleCount: state.sampleCount ?? existing.sampleCount,
      lastUpdated: state.lastUpdated ?? Date.now(),
    });
  }

  /**
   * Update calibration factors based on a completed observation with provider usage.
   * Rejects invalid, non-positive, or malformed observations (minimum data requirements).
   */
  update(observation: UsageObservation): void {
    try {
      const {
        provider,
        model,
        estimatedPromptTokens,
        estimatedCompletionTokens,
        actualPromptTokens,
        actualCompletionTokens,
      } = observation;

      if (!model) {
        return;
      }

      const key = getCalibrationIdentity(provider, model);
      const state = this.states.get(key) ?? {
        promptFactor: 1.0,
        completionFactor: 1.0,
        sampleCount: 0,
        lastUpdated: Date.now(),
      };

      let updated = false;

      // Minimum Data Requirement: only update prompt factor if both estimated and actual are strictly positive numbers
      if (
        typeof estimatedPromptTokens === "number" &&
        Number.isFinite(estimatedPromptTokens) &&
        estimatedPromptTokens > 0 &&
        typeof actualPromptTokens === "number" &&
        Number.isFinite(actualPromptTokens) &&
        actualPromptTokens > 0
      ) {
        const observedRatio = actualPromptTokens / estimatedPromptTokens;
        const newPromptFactor = state.promptFactor * (1 - this.alpha) + observedRatio * this.alpha;
        state.promptFactor = clamp(newPromptFactor, this.minFactor, this.maxFactor);
        updated = true;
      }

      // Minimum Data Requirement: only update completion factor if both estimated and actual are strictly positive numbers
      if (
        typeof estimatedCompletionTokens === "number" &&
        Number.isFinite(estimatedCompletionTokens) &&
        estimatedCompletionTokens > 0 &&
        typeof actualCompletionTokens === "number" &&
        Number.isFinite(actualCompletionTokens) &&
        actualCompletionTokens > 0
      ) {
        const observedRatio = actualCompletionTokens / estimatedCompletionTokens;
        const newCompletionFactor = state.completionFactor * (1 - this.alpha) + observedRatio * this.alpha;
        state.completionFactor = clamp(newCompletionFactor, this.minFactor, this.maxFactor);
        updated = true;
      }

      if (updated) {
        state.sampleCount += 1;
        state.lastUpdated = Date.now();
        this.states.set(key, state);
        this.totalObs += 1;
      }
    } catch {
      // Fail open: calibration failure must never crash the harness
    }
  }

  /** Retrieve summary statistics for all tracked identities. */
  getStats(): CalibrationStats {
    const identities: Record<string, CalibrationState> = {};
    for (const [k, v] of this.states.entries()) {
      identities[k] = { ...v };
    }
    return {
      identities,
      totalObservations: this.totalObs,
    };
  }
}

/** Global default calibration tracker. */
export const defaultCalibrationTracker = new CalibrationTracker();

// ---------------------------------------------------------------------------
// UsageMark Resolution Hierarchy
// ---------------------------------------------------------------------------

/**
 * Resolve a UsageMark from an observation and optional calibration tracker.
 *
 * Decision Tree:
 *   1. Is valid provider usage present?
 *      YES -> Source: 'provider', confidence: 'high'. Use provider numbers directly.
 *             Update calibration tracker with observed ratio.
 *      NO  -> Is calibration history available for this identity?
 *             YES -> Source: 'calibrated-estimate', confidence: 'medium'.
 *                    Apply bounded correction factor.
 *             NO  -> Source: 'estimate', confidence: 'low'.
 *                    Use raw local heuristic estimate.
 */
export function resolveUsageMark(
  observation: UsageObservation,
  tracker: CalibrationTracker = defaultCalibrationTracker,
): UsageMark {
  try {
    const {
      requestId,
      provider,
      model,
      estimatedPromptTokens,
      estimatedCompletionTokens,
      actualPromptTokens,
      actualCompletionTokens,
      actualTotalTokens,
      cachedTokens,
      reasoningTokens,
    } = observation;

    const estPrompt = Math.max(0, Math.round(Number.isFinite(estimatedPromptTokens) ? estimatedPromptTokens : 0));
    const estCompl = Math.max(0, Math.round(Number.isFinite(estimatedCompletionTokens) ? estimatedCompletionTokens : 0));
    const estTotal = observation.estimatedTotalTokens !== undefined && Number.isFinite(observation.estimatedTotalTokens)
      ? Math.max(0, Math.round(observation.estimatedTotalTokens))
      : estPrompt + estCompl;

    // Validate provider actual usage
    const hasValidActualPrompt =
      typeof actualPromptTokens === "number" &&
      Number.isFinite(actualPromptTokens) &&
      actualPromptTokens >= 0;
    const hasValidActualCompl =
      typeof actualCompletionTokens === "number" &&
      Number.isFinite(actualCompletionTokens) &&
      actualCompletionTokens >= 0;

    const hasProviderUsage = hasValidActualPrompt && hasValidActualCompl;

    if (hasProviderUsage) {
      // ── Level 1: Provider Ground Truth ─────────────────────────────────
      const promptTok = actualPromptTokens!;
      const complTok = actualCompletionTokens!;
      const totalTok =
        typeof actualTotalTokens === "number" && Number.isFinite(actualTotalTokens) && actualTotalTokens >= 0
          ? actualTotalTokens
          : promptTok + complTok;

      // Update calibration tracker
      tracker.update(observation);

      const calState = tracker.getState(provider, model);
      const promptFactor = calState?.promptFactor ?? 1.0;
      const complFactor = calState?.completionFactor ?? 1.0;

      const absPromptErr = Math.abs(estPrompt - promptTok);
      const relPromptErr = computeRelativeError(estPrompt, promptTok);

      const absComplErr = Math.abs(estCompl - complTok);
      const relComplErr = computeRelativeError(estCompl, complTok);

      const absTotalErr = Math.abs(estTotal - totalTok);
      const relTotalErr = computeRelativeError(estTotal, totalTok);

      return {
        promptTokens: promptTok,
        completionTokens: complTok,
        totalTokens: totalTok,
        source: "provider",
        confidence: "high",
        cachedTokens,
        reasoningTokens,
        requestId,
        provider,
        model,
        estimatedPromptTokens: estPrompt,
        estimatedCompletionTokens: estCompl,
        estimatedTotalTokens: estTotal,
        actualPromptTokens: promptTok,
        actualCompletionTokens: complTok,
        actualTotalTokens: totalTok,
        promptCorrectionFactor: promptFactor,
        completionCorrectionFactor: complFactor,
        absolutePromptError: absPromptErr,
        relativePromptError: relPromptErr,
        absoluteCompletionError: absComplErr,
        relativeCompletionError: relComplErr,
        absoluteTotalError: absTotalErr,
        relativeTotalError: relTotalErr,
      };
    }

    // Provider usage is absent or malformed.
    // Check if we have calibration history for this provider + model identity.
    const calState = tracker.getState(provider, model);

    if (calState && calState.sampleCount > 0) {
      // ── Level 2: Calibrated Local Estimate ─────────────────────────────
      const promptTok = Math.max(1, Math.round(estPrompt * calState.promptFactor));
      const complTok = estCompl > 0
        ? Math.max(1, Math.round(estCompl * calState.completionFactor))
        : 0;
      const totalTok = promptTok + complTok;

      return {
        promptTokens: promptTok,
        completionTokens: complTok,
        totalTokens: totalTok,
        source: "calibrated-estimate",
        confidence: "medium",
        cachedTokens: undefined, // Provider omitted -> strictly undefined
        reasoningTokens: undefined,
        requestId,
        provider,
        model,
        estimatedPromptTokens: estPrompt,
        estimatedCompletionTokens: estCompl,
        estimatedTotalTokens: estTotal,
        actualPromptTokens: undefined,
        actualCompletionTokens: undefined,
        actualTotalTokens: undefined,
        promptCorrectionFactor: calState.promptFactor,
        completionCorrectionFactor: calState.completionFactor,
      };
    }

    // ── Level 3: Raw Local Heuristic Estimate ────────────────────────────
    return {
      promptTokens: estPrompt,
      completionTokens: estCompl,
      totalTokens: estTotal,
      source: "estimate",
      confidence: "low",
      cachedTokens: undefined,
      reasoningTokens: undefined,
      requestId,
      provider,
      model,
      estimatedPromptTokens: estPrompt,
      estimatedCompletionTokens: estCompl,
      estimatedTotalTokens: estTotal,
      actualPromptTokens: undefined,
      actualCompletionTokens: undefined,
      actualTotalTokens: undefined,
      promptCorrectionFactor: 1.0,
      completionCorrectionFactor: 1.0,
    };
  } catch {
    // Fail open: return raw heuristic estimate on any unexpected failure
    const estPrompt = Math.max(0, Math.round(observation.estimatedPromptTokens || 0));
    const estCompl = Math.max(0, Math.round(observation.estimatedCompletionTokens || 0));
    return {
      promptTokens: estPrompt,
      completionTokens: estCompl,
      totalTokens: estPrompt + estCompl,
      source: "estimate",
      confidence: "low",
      model: observation.model || "unknown",
      estimatedPromptTokens: estPrompt,
      estimatedCompletionTokens: estCompl,
      estimatedTotalTokens: estPrompt + estCompl,
    };
  }
}
