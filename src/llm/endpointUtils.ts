/**
 * Endpoint URL construction utilities (Phase 7 — OpenRouter endpoint correctness).
 *
 * Centralises the single defensive rule:
 *   baseUrl (with or without trailing slash) + path → well-formed URL.
 *
 * DESIGN TARGET:
 *   buildEndpointUrl("https://openrouter.ai/api/v1",  "chat/completions")
 *     → "https://openrouter.ai/api/v1/chat/completions"
 *   buildEndpointUrl("https://openrouter.ai/api/v1/", "chat/completions")
 *     → "https://openrouter.ai/api/v1/chat/completions"
 *   buildEndpointUrl("https://openrouter.ai/api/v1//", "chat/completions")
 *     → "https://openrouter.ai/api/v1/chat/completions"
 *
 * CONTRACT (both sides):
 *   - `baseUrl` MUST NOT already contain the path segment.
 *     e.g. do not pass "https://openrouter.ai/api/v1/chat/completions" as baseUrl.
 *   - `path` MUST be the plain path segment ("chat/completions"), not a full URL.
 *
 * Security: this function does not log, print, or expose any part of the URL
 * that could include credentials.
 */

/**
 * Build a provider endpoint URL, defensively normalising trailing slashes.
 *
 * @param baseUrl  The provider base URL, with or without a trailing slash.
 *                 All trailing slashes are stripped before joining.
 * @param path     The path segment to append (e.g. "chat/completions").
 *                 Leading slashes are stripped before joining.
 * @returns        A properly joined URL with exactly one slash between base and path.
 */
export function buildEndpointUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, ""); // strip ALL trailing slashes
  const p    = path.replace(/^\/+/, "");    // strip ALL leading slashes
  return `${base}/${p}`;
}
