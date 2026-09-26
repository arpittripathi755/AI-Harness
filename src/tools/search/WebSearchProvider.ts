/**
 * WebSearchProvider interface and multi-vendor provider implementations.
 * Supports Tavily, Brave Search, SerpAPI, DuckDuckGo (free/no-key fallback),
 * and custom/mock providers for testing.
 */

export interface WebSearchItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  ok: boolean;
  provider: string;
  query: string;
  results: WebSearchItem[];
  error?: string;
  statusCode?: number;
}

export interface WebSearchOptions {
  timeoutMs?: number;
  maxResults?: number;
  maxRetries?: number;
  apiKey?: string;
  fetchFn?: typeof fetch;
}

export interface WebSearchProvider {
  readonly name: string;
  search(query: string, options?: WebSearchOptions): Promise<WebSearchResponse>;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESULTS = 5;

/** Helper to sleep for exponential backoff */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sanitize query to remove any accidental secret tokens */
export function sanitizeSearchQuery(query: string): string {
  if (!query) {
    return "";
  }
  let clean = query.trim();
  // Strip common token patterns (e.g. nvapi-..., ghp_..., sk-..., Bearer ...)
  clean = clean.replace(/(nvapi-[a-zA-Z0-9_-]{10,})/g, "[REDACTED_API_KEY]");
  clean = clean.replace(/(gh[pousr]-[a-zA-Z0-9]{20,})/g, "[REDACTED_GITHUB_TOKEN]");
  clean = clean.replace(/(sk-[a-zA-Z0-9]{20,})/g, "[REDACTED_SECRET]");
  clean = clean.replace(/(Bearer\s+[a-zA-Z0-9._-]{20,})/gi, "[REDACTED_TOKEN]");
  return clean;
}

/**
 * 1. Tavily Search Provider (Optimized for AI Agents)
 */
export class TavilySearchProvider implements WebSearchProvider {
  readonly name = "tavily";

  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
    const apiKey = options.apiKey || process.env.TAVILY_API_KEY || process.env.WEB_SEARCH_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        provider: this.name,
        query,
        results: [],
        error: "Tavily API key not configured. Set TAVILY_API_KEY or WEB_SEARCH_API_KEY.",
      };
    }

    const fetchFn = options.fetchFn || fetch;
    const timeoutMs = options.timeoutMs || Number(process.env.WEB_SEARCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;
    const envRetries = process.env.WEB_SEARCH_MAX_RETRIES !== undefined && !isNaN(Number(process.env.WEB_SEARCH_MAX_RETRIES))
      ? Number(process.env.WEB_SEARCH_MAX_RETRIES)
      : 2;
    const maxRetries = options.maxRetries ?? envRetries;

    let lastError: string | undefined;
    let statusCode: number | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetchFn("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: apiKey,
            query: sanitizeSearchQuery(query),
            max_results: maxResults,
            search_depth: "basic",
            include_answer: false,
          }),
          signal: controller.signal,
        });

        statusCode = res.status;

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("Retry-After")) || Math.pow(2, attempt) * 1000;
          if (attempt < maxRetries) {
            await sleep(Math.min(retryAfter, 10000));
            continue;
          }
          return {
            ok: false,
            provider: this.name,
            query,
            results: [],
            statusCode: 429,
            error: "Tavily search rate limit reached (HTTP 429).",
          };
        }

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          return {
            ok: false,
            provider: this.name,
            query,
            results: [],
            statusCode: res.status,
            error: `Tavily API error (${res.status}): ${errBody.slice(0, 200)}`,
          };
        }

        const data: any = await res.json();
        const rawResults = Array.isArray(data.results) ? data.results : [];
        const results: WebSearchItem[] = rawResults.map((r: any) => ({
          title: String(r.title || "Untitled"),
          url: String(r.url || ""),
          snippet: String(r.content || r.snippet || ""),
        })).filter((r: WebSearchItem) => Boolean(r.url));

        return {
          ok: true,
          provider: this.name,
          query,
          results,
        };
      } catch (err: any) {
        lastError = err.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : (err.message || String(err));
        if (err.name === "AbortError") {
          break;
        }
        if (attempt < maxRetries) {
          await sleep(Math.pow(2, attempt) * 500);
          continue;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    return {
      ok: false,
      provider: this.name,
      query,
      results: [],
      statusCode,
      error: lastError || "Unknown network error during web search.",
    };
  }
}

/**
 * 2. Brave Search Provider
 */
export class BraveSearchProvider implements WebSearchProvider {
  readonly name = "brave";

  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
    const apiKey = options.apiKey || process.env.BRAVE_API_KEY || process.env.WEB_SEARCH_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        provider: this.name,
        query,
        results: [],
        error: "Brave Search API key not configured. Set BRAVE_API_KEY or WEB_SEARCH_API_KEY.",
      };
    }

    const fetchFn = options.fetchFn || fetch;
    const timeoutMs = options.timeoutMs || Number(process.env.WEB_SEARCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(sanitizeSearchQuery(query))}&count=${maxResults}`;
      const res = await fetchFn(url, {
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          ok: false,
          provider: this.name,
          query,
          results: [],
          statusCode: res.status,
          error: `Brave Search API error (${res.status}): ${errText.slice(0, 200)}`,
        };
      }

      const data: any = await res.json();
      const rawResults = Array.isArray(data?.web?.results) ? data.web.results : [];
      const results: WebSearchItem[] = rawResults.map((r: any) => ({
        title: String(r.title || "Untitled"),
        url: String(r.url || ""),
        snippet: String(r.description || ""),
      })).filter((r: WebSearchItem) => Boolean(r.url));

      return {
        ok: true,
        provider: this.name,
        query,
        results,
      };
    } catch (err: any) {
      const errorMsg = err.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : (err.message || String(err));
      return {
        ok: false,
        provider: this.name,
        query,
        results: [],
        error: errorMsg,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * 3. SerpAPI Provider (Google Search Engine)
 */
export class SerpApiSearchProvider implements WebSearchProvider {
  readonly name = "serpapi";

  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
    const apiKey = options.apiKey || process.env.SERPAPI_API_KEY || process.env.WEB_SEARCH_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        provider: this.name,
        query,
        results: [],
        error: "SerpAPI key not configured. Set SERPAPI_API_KEY or WEB_SEARCH_API_KEY.",
      };
    }

    const fetchFn = options.fetchFn || fetch;
    const timeoutMs = options.timeoutMs || Number(process.env.WEB_SEARCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `https://serpapi.com/search?q=${encodeURIComponent(sanitizeSearchQuery(query))}&api_key=${apiKey}&engine=google&num=${maxResults}`;
      const res = await fetchFn(url, { signal: controller.signal });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          ok: false,
          provider: this.name,
          query,
          results: [],
          statusCode: res.status,
          error: `SerpAPI error (${res.status}): ${errText.slice(0, 200)}`,
        };
      }

      const data: any = await res.json();
      const rawResults = Array.isArray(data?.organic_results) ? data.organic_results : [];
      const results: WebSearchItem[] = rawResults.slice(0, maxResults).map((r: any) => ({
        title: String(r.title || "Untitled"),
        url: String(r.link || ""),
        snippet: String(r.snippet || ""),
      })).filter((r: WebSearchItem) => Boolean(r.url));

      return {
        ok: true,
        provider: this.name,
        query,
        results,
      };
    } catch (err: any) {
      const errorMsg = err.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : (err.message || String(err));
      return {
        ok: false,
        provider: this.name,
        query,
        results: [],
        error: errorMsg,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * 4. DuckDuckGo Free Search Provider (No API key required fallback)
 */
export class DuckDuckGoSearchProvider implements WebSearchProvider {
  readonly name = "duckduckgo";

  async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResponse> {
    const fetchFn = options.fetchFn || fetch;
    const timeoutMs = options.timeoutMs || Number(process.env.WEB_SEARCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // 1. Try DuckDuckGo Instant Answers API
      const sanitized = sanitizeSearchQuery(query);
      const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(sanitized)}&format=json&no_html=1&skip_disambig=1`;
      
      const apiRes = await fetchFn(apiUrl, {
        headers: { "User-Agent": "DAXIOM-Agent/1.0" },
        signal: controller.signal,
      }).catch(() => null);

      const items: WebSearchItem[] = [];

      if (apiRes && apiRes.ok) {
        try {
          const data: any = await apiRes.json();
          if (data.AbstractText && data.AbstractURL) {
            items.push({
              title: String(data.Heading || sanitized),
              url: String(data.AbstractURL),
              snippet: String(data.AbstractText),
            });
          }
          if (Array.isArray(data.RelatedTopics)) {
            for (const topic of data.RelatedTopics) {
              if (topic.Text && topic.FirstURL && items.length < maxResults) {
                items.push({
                  title: String(topic.Text.slice(0, 60)),
                  url: String(topic.FirstURL),
                  snippet: String(topic.Text),
                });
              }
            }
          }
        } catch {
          // ignore API parse error and try HTML
        }
      }

      // 2. If Instant Answers gave results, return them
      if (items.length > 0) {
        return {
          ok: true,
          provider: this.name,
          query,
          results: items.slice(0, maxResults),
        };
      }

      // 3. Fallback to DuckDuckGo HTML Lite scraping
      const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(sanitized)}`;
      const htmlRes = await fetchFn(htmlUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: controller.signal,
      });

      if (!htmlRes.ok) {
        return {
          ok: false,
          provider: this.name,
          query,
          results: [],
          statusCode: htmlRes.status,
          error: `DuckDuckGo returned status ${htmlRes.status}`,
        };
      }

      const html = await htmlRes.text();
      const parsedResults = parseDuckDuckGoHtml(html, maxResults);

      return {
        ok: true,
        provider: this.name,
        query,
        results: parsedResults,
      };
    } catch (err: any) {
      const errorMsg = err.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : (err.message || String(err));
      return {
        ok: false,
        provider: this.name,
        query,
        results: [],
        error: errorMsg,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/** Parse DuckDuckGo HTML results cleanly with regex */
export function parseDuckDuckGoHtml(html: string, maxResults: number): WebSearchItem[] {
  const results: WebSearchItem[] = [];
  // Match result links: <a class="result__url" href="URL"> or <a class="result__a" href="URL">TITLE</a>
  const resultBlockRegex = /<div[^>]*class="[^"]*result__body[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let match: RegExpExecArray | null;

  while ((match = resultBlockRegex.exec(html)) !== null && results.length < maxResults) {
    const block = match[1];

    // Extract title & link
    const linkMatch = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!linkMatch) {
      continue;
    }

    let rawUrl = linkMatch[1];
    // Unwrap DDG redirect url (//duckduckgo.com/l/?uddg=REAL_URL)
    const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      try {
        rawUrl = decodeURIComponent(uddgMatch[1]);
      } catch {
        // use raw
      }
    }

    const title = linkMatch[2].replace(/<[^>]+>/g, "").trim();

    // Extract snippet
    const snippetMatch = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ||
                         /<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    if (title && rawUrl) {
      results.push({
        title,
        url: rawUrl,
        snippet,
      });
    }
  }

  return results;
}

/**
 * 5. Mock Search Provider (for fast deterministic tests)
 */
export class MockSearchProvider implements WebSearchProvider {
  readonly name = "mock";
  private responses: Map<string, WebSearchResponse> = new Map();
  private defaultResponse: WebSearchResponse = {
    ok: true,
    provider: "mock",
    query: "",
    results: [
      {
        title: "Mock Search Result - Documentation",
        url: "https://example.com/docs/mock-result",
        snippet: "This is a mock search snippet providing authoritative documentation for tests.",
      },
    ],
  };

  setResponse(query: string, response: WebSearchResponse): void {
    this.responses.set(query.toLowerCase().trim(), response);
  }

  setDefaultResponse(response: WebSearchResponse): void {
    this.defaultResponse = response;
  }

  async search(query: string): Promise<WebSearchResponse> {
    const clean = query.toLowerCase().trim();
    if (this.responses.has(clean)) {
      return this.responses.get(clean)!;
    }
    return {
      ...this.defaultResponse,
      query,
    };
  }
}

let customProviderInstance: WebSearchProvider | null = null;

export function setCustomSearchProvider(provider: WebSearchProvider | null): void {
  customProviderInstance = provider;
}

/**
 * Factory to resolve the active WebSearchProvider based on environment and availability.
 */
export function getSearchProvider(explicitName?: string): WebSearchProvider {
  if (customProviderInstance) {
    return customProviderInstance;
  }

  const requested = (explicitName || process.env.WEB_SEARCH_PROVIDER || "auto").toLowerCase().trim();

  if (requested === "mock") {
    return new MockSearchProvider();
  }
  if (requested === "tavily") {
    return new TavilySearchProvider();
  }
  if (requested === "brave") {
    return new BraveSearchProvider();
  }
  if (requested === "serpapi") {
    return new SerpApiSearchProvider();
  }
  if (requested === "duckduckgo") {
    return new DuckDuckGoSearchProvider();
  }

  // Auto-detection logic:
  // 1. Tavily
  if (process.env.TAVILY_API_KEY) {
    return new TavilySearchProvider();
  }
  // 2. Brave
  if (process.env.BRAVE_API_KEY) {
    return new BraveSearchProvider();
  }
  // 3. SerpApi
  if (process.env.SERPAPI_API_KEY) {
    return new SerpApiSearchProvider();
  }
  // 4. Generic WEB_SEARCH_API_KEY (defaults to Tavily format)
  if (process.env.WEB_SEARCH_API_KEY) {
    return new TavilySearchProvider();
  }

  // 5. Fallback: DuckDuckGo free search (no key required)
  return new DuckDuckGoSearchProvider();
}
