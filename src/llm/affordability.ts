/**
 * OpenRouter credit affordability-aware token clamping.
 *
 * Checks credit balance via https://openrouter.ai/api/v1/key and clamps completion budgets
 * so requests succeed instead of failing with HTTP 402 ("can only afford N tokens").
 */

import { getModelByApiId, resolveModelId } from "../shared/models";

export const AFFORDABILITY_SAFETY_MARGIN = 0.9;
export const KEY_CACHE_TTL_MS = 60_000;
export const MODELS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const MIN_RETRY_AFFORDABLE_TOKENS = 256;
export const AFFORDABILITY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface OpenRouterKeyInfo {
  limitRemaining: number | null;
  timestamp: number;
}

let cachedKeyInfo: { key: string; info: OpenRouterKeyInfo } | null = null;
let cachedModelPrices: { prices: Record<string, number>; timestamp: number } | null = null;

interface RecordedAffordability {
  tokens: number;
  timestamp: number;
}
const recordedModelAffordability = new Map<string, RecordedAffordability>();

function getCacheKey(apiModelId: string, apiKey?: string): string {
  const trimmedKey = (apiKey || "").trim();
  const resolved = resolveModelId(apiModelId);
  return `${trimmedKey}::${resolved}`;
}

/**
 * Record dynamic affordable token limit reported by OpenRouter (e.g. from 402 responses).
 * Cached for 5 minutes per API key and model so subsequent requests do not re-send unaffordable token counts.
 */
export function recordModelAffordability(apiModelId: string, tokens: number, apiKey?: string): void {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return;
  }
  const entry: RecordedAffordability = { tokens: Math.floor(tokens), timestamp: Date.now() };
  recordedModelAffordability.set(getCacheKey(apiModelId, apiKey), entry);
}

/**
 * Get the cached dynamic affordable token limit for a model if recorded and still valid.
 */
export function getRecordedAffordability(apiModelId: string, apiKey?: string): number | undefined {
  const key = getCacheKey(apiModelId, apiKey);
  let entry = recordedModelAffordability.get(key);
  if (!entry && apiKey) {
    const emptyKey = getCacheKey(apiModelId, "");
    entry = recordedModelAffordability.get(emptyKey);
  }
  if (!entry && !apiKey) {
    const resolved = resolveModelId(apiModelId);
    for (const [k, v] of recordedModelAffordability.entries()) {
      if (k.endsWith(`::${resolved}`)) {
        entry = v;
        break;
      }
    }
  }
  if (!entry) {
    return undefined;
  }
  if (Date.now() - entry.timestamp > AFFORDABILITY_CACHE_TTL_MS) {
    recordedModelAffordability.delete(key);
    return undefined;
  }
  return entry.tokens;
}

/**
 * Clear all affordability caches (useful in tests and key rotations).
 */
export function clearAffordabilityCache(): void {
  recordedModelAffordability.clear();
  cachedKeyInfo = null;
  cachedModelPrices = null;
}

/**
 * Invalidate the in-memory key-info cache (e.g. after receiving a 402 or key change).
 */
export function invalidateKeyInfoCache(): void {
  cachedKeyInfo = null;
}

/**
 * Invalidate the in-memory model prices cache.
 */
export function invalidateModelsCache(): void {
  cachedModelPrices = null;
}

/**
 * Fetch model catalog from OpenRouter /models and parse pricing.completion (USD per token).
 * Cached in memory for 6 hours. Fails open by returning null (never throws).
 */
export async function fetchModelPrices(
  baseUrl = "https://openrouter.ai/api/v1/",
): Promise<Record<string, number> | null> {
  const now = Date.now();
  if (cachedModelPrices && now - cachedModelPrices.timestamp < MODELS_CACHE_TTL_MS) {
    return cachedModelPrices.prices;
  }

  try {
    const root = baseUrl.replace(/\/+$/, "");
    const endpoint = `${root}/models`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "HTTP-Referer": "https://github.com/daxiom",
        "X-Title": "DAXIOM",
      },
    });

    if (!response.ok) {
      return null;
    }

    const json: any = await response.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    const prices: Record<string, number> = {};

    for (const item of data) {
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      const rawPrice = item?.pricing?.completion;
      if (id && rawPrice !== undefined && rawPrice !== null) {
        const num = typeof rawPrice === "number" ? rawPrice : Number(rawPrice);
        if (Number.isFinite(num) && num > 0) {
          prices[id] = num;
        }
      }
    }

    cachedModelPrices = { prices, timestamp: now };
    return prices;
  } catch {
    // Fail open: never break requests due to pricing catalog lookup failure
    return null;
  }
}

/**
 * Resolve completion price per token for a model:
 * 1. Checks static model metadata first (completionPricePerToken).
 * 2. If missing, queries OpenRouter runtime models catalog (pricing.completion).
 * Returns null if not found or lookup failed.
 */
export async function getModelCompletionPrice(
  apiModelId: string,
  baseUrl?: string,
): Promise<number | null> {
  const model = getModelByApiId(apiModelId);
  if (model?.completionPricePerToken && model.completionPricePerToken > 0) {
    return model.completionPricePerToken;
  }

  const prices = await fetchModelPrices(baseUrl);
  if (!prices) {
    return null;
  }
  const price = prices[apiModelId];
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * Fetch key details from OpenRouter's /api/v1/key endpoint.
 *
 * Caches in memory for 60 seconds.
 * On ANY error (network, non-200, invalid JSON), fails open by returning null (NEVER throws).
 */
export async function fetchKeyInfo(
  apiKey: string,
  baseUrl = "https://openrouter.ai/api/v1/",
): Promise<OpenRouterKeyInfo | null> {
  const trimmedKey = apiKey?.trim();
  if (!trimmedKey) {
    return null;
  }

  const now = Date.now();
  if (
    cachedKeyInfo &&
    cachedKeyInfo.key === trimmedKey &&
    now - cachedKeyInfo.info.timestamp < KEY_CACHE_TTL_MS
  ) {
    return cachedKeyInfo.info;
  }

  try {
    const root = baseUrl.replace(/\/+$/, "");
    const endpoint = `${root}/key`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
        "HTTP-Referer": "https://github.com/daxiom",
        "X-Title": "DAXIOM",
      },
    });

    if (!response.ok) {
      return null;
    }

    const json: any = await response.json();
    const limitRemaining =
      json?.data?.limit_remaining !== undefined
        ? json.data.limit_remaining
        : json?.limit_remaining !== undefined
          ? json.limit_remaining
          : null;

    const parsedLimit =
      typeof limitRemaining === "number" && Number.isFinite(limitRemaining)
        ? limitRemaining
        : null;

    const info: OpenRouterKeyInfo = {
      limitRemaining: parsedLimit,
      timestamp: now,
    };

    cachedKeyInfo = { key: trimmedKey, info };
    return info;
  } catch {
    // Fail open: never break requests due to telemetry / key probing failure
    return null;
  }
}

/**
 * Calculate the maximum affordable output tokens for a model given available credits.
 * Returns Infinity if unlimited, unknown, or if the model does not have completion pricing.
 * Consults both calculated key-balance limits and provider-reported dynamic affordability.
 */
export async function getAffordableTokens(
  apiModelId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<number> {
  let calculated = Infinity;
  const price = await getModelCompletionPrice(apiModelId, baseUrl);
  if (price && price > 0) {
    const keyInfo = await fetchKeyInfo(apiKey, baseUrl);
    if (keyInfo && keyInfo.limitRemaining !== null) {
      calculated = Math.floor(
        (keyInfo.limitRemaining * AFFORDABILITY_SAFETY_MARGIN) / price,
      );
    }
  }

  const recorded = getRecordedAffordability(apiModelId, apiKey);
  if (recorded !== undefined && Number.isFinite(recorded)) {
    calculated = Math.min(calculated, recorded);
  }

  if (Number.isFinite(calculated)) {
    return calculated > 0 ? calculated : 0;
  }
  return Infinity;
}

