/**
 * Canonical provider configuration for DAXIOM.
 *
 * This is the single source of truth for the evaluation model identifier
 * and the two supported provider endpoints. Nothing else in the codebase
 * should duplicate these strings.
 */

/** The canonical DeepSeek evaluation model used across DAXIOM. */
export const CANONICAL_MODEL = "deepseek/deepseek-v4.1-flash";

/** A provider configuration record. */
export interface ProviderConfig {
  /** Human-readable name shown in the TUI. */
  name: string;
  /** Base URL for chat/completions endpoint (with trailing slash). */
  baseUrl: string;
  /**
   * Model identifier sent to this specific provider.
   * May differ from CANONICAL_MODEL for provider-specific namespacing.
   */
  model: string;
}

/**
 * OpenRouter provider — uses the canonical model string directly.
 * OpenRouter accepts "deepseek/deepseek-v4.1-flash" as-is.
 */
export const OPENROUTER_PROVIDER: ProviderConfig = {
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1/",
  model: CANONICAL_MODEL,
};

/**
 * AWS Bedrock provider — OpenAI-compatible proxy endpoint.
 * The model identifier may require a provider-specific mapping; this is
 * isolated here and never surfaces through the rest of the agent.
 *
 * AWS Bedrock's OpenAI-compatible layer accepts the same "provider/model"
 * format that OpenRouter uses, so we keep it identical for now. If Bedrock
 * requires a different identifier (e.g. an ARN), update ONLY this constant.
 */
export const AWS_BEDROCK_PROVIDER: ProviderConfig = {
  name: "AWS Bedrock",
  baseUrl: "https://bedrock-runtime.ap-south-1.amazonaws.com/openai/v1/",
  model: CANONICAL_MODEL,
};

/** Ordered list of providers tried during startup detection. */
export const PROVIDER_PRIORITY: ProviderConfig[] = [
  OPENROUTER_PROVIDER,
  AWS_BEDROCK_PROVIDER,
];
