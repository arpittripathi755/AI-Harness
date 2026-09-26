import * as https from "https";
import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolError } from "../types";

interface ParsedIssueRef {
  owner: string;
  repo: string;
  issueNumber: number;
  isPr?: boolean;
}

function parseIssueUrl(raw: string): ParsedIssueRef | null {
  const trimmed = raw.trim();

  // Pattern: https://github.com/:owner/:repo/(issues|pull)/:number
  const urlMatch = trimmed.match(
    /github\.com\/([^/\s]+)\/([^/\s#]+)\/(issues|pull)\/(\d+)/i,
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2].replace(/\.git$/i, ""),
      isPr: urlMatch[3].toLowerCase() === "pull",
      issueNumber: parseInt(urlMatch[4], 10),
    };
  }

  // Pattern: :owner/:repo#:number
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s#]+)#(\d+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      issueNumber: parseInt(shortMatch[3], 10),
    };
  }

  return null;
}

function httpsGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/json,*/*",
          ...headers,
        },
        timeout: 15_000,
      },
      (res) => {
        // Handle HTTP redirects
        if (
          res.statusCode &&
          [301, 302, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          return resolve(httpsGet(res.headers.location, headers));
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({ statusCode: res.statusCode || 200, data }),
        );
      },
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    req.on("error", (err) => reject(err));
  });
}

function cleanHtmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const fetchGithubIssueTool: Tool = {
  name: "fetch_github_issue",
  description:
    "Fetch the complete description, requirements, error logs, and discussions for a GitHub " +
    "issue or pull request. Accepts a full GitHub URL (e.g. 'https://github.com/owner/repo/issues/123') " +
    "or repo and issue number. Returns the issue body, comments, and the repo clone URL.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "Full GitHub issue or PR URL (e.g. 'https://github.com/owner/repo/issues/123').",
      },
      repo: {
        type: "string",
        description: "Optional repository in 'owner/repo' format.",
      },
      issue_number: {
        type: "integer",
        description: "Optional issue or pull request number.",
      },
    },
  },

  async execute(args, _ctx: ToolContext): Promise<ToolResult> {
    let owner = "";
    let repo = "";
    let issueNumber = 0;
    let isPr = false;

    if (typeof args.url === "string" && args.url.trim()) {
      const parsed = parseIssueUrl(args.url);
      if (parsed) {
        owner = parsed.owner;
        repo = parsed.repo;
        issueNumber = parsed.issueNumber;
        isPr = !!parsed.isPr;
      }
    }

    if (!owner && typeof args.repo === "string") {
      const parts = args.repo.trim().split("/");
      if (parts.length === 2) {
        owner = parts[0];
        repo = parts[1].replace(/\.git$/i, "");
      }
    }

    if (!issueNumber && typeof args.issue_number === "number") {
      issueNumber = args.issue_number;
    }

    if (!owner || !repo || !issueNumber) {
      throw new ToolError(
        "Could not determine GitHub repository and issue number. Please provide a valid URL like 'https://github.com/owner/repo/issues/123'.",
      );
    }

    const cloneUrl = `https://github.com/${owner}/${repo}.git`;
    const issueWebUrl = `https://github.com/${owner}/${repo}/${isPr ? "pull" : "issues"}/${issueNumber}`;

    // Attempt 1: GitHub REST API
    const apiToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const apiHeaders: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };
    if (apiToken) {
      apiHeaders["Authorization"] = `Bearer ${apiToken.trim()}`;
    }

    let title = "";
    let body = "";
    let state = "open";
    let author = "";
    let labels: string[] = [];
    const commentsList: Array<{ user: string; body: string }> = [];

    let apiSucceeded = false;
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
      const res = await httpsGet(apiUrl, apiHeaders);
      if (res.statusCode === 200) {
        const issueData = JSON.parse(res.data);
        title = issueData.title || "";
        body = issueData.body || "";
        state = issueData.state || "open";
        author = issueData.user?.login || "";
        labels = (issueData.labels || []).map((l: any) => l.name || l);
        apiSucceeded = true;

        // Also fetch comments if any
        if (issueData.comments > 0) {
          try {
            const commentsRes = await httpsGet(
              `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=10`,
              apiHeaders,
            );
            if (commentsRes.statusCode === 200) {
              const commentsData = JSON.parse(commentsRes.data);
              for (const c of commentsData) {
                if (c.body) {
                  commentsList.push({
                    user: c.user?.login || "user",
                    body: c.body,
                  });
                }
              }
            }
          } catch {
            // comments fetch error is non-fatal
          }
        }
      }
    } catch {
      // API call failed, fall back to web scraping
    }

    // Attempt 2: Fallback to scraping the public web page directly
    if (!apiSucceeded) {
      try {
        const webRes = await httpsGet(issueWebUrl);
        if (webRes.statusCode === 200) {
          const html = webRes.data;

          // Extract title
          const titleMatch =
            html.match(/<bdi class="js-issue-title[^>]*>([\s\S]*?)<\/bdi>/i) ||
            html.match(/<meta property="og:title" content="([^"]+)"/i) ||
            html.match(/<title>([\s\S]*?)<\/title>/i);
          if (titleMatch) {
            title = cleanHtmlText(titleMatch[1]).replace(/ · GitHub$/i, "");
          }

          // Extract og:description
          const ogDescMatch = html.match(
            /<meta property="og:description" content="([^"]+)"/i,
          );
          const metaDesc = ogDescMatch ? ogDescMatch[1] : "";

          // Extract comment bodies from rendered markdown containers
          const commentBlocks = [
            ...html.matchAll(
              /class="[^"]*(?:comment-body|markdown-body)[^"]*"[^>]*>([\s\S]*?)<\/td>/gi,
            ),
          ];

          if (commentBlocks.length > 0) {
            body = cleanHtmlText(commentBlocks[0][1]);
            for (let i = 1; i < Math.min(commentBlocks.length, 6); i++) {
              const cleaned = cleanHtmlText(commentBlocks[i][1]);
              if (cleaned) {
                commentsList.push({ user: `Commenter #${i}`, body: cleaned });
              }
            }
          } else if (metaDesc) {
            body = metaDesc;
          }
        }
      } catch (err: any) {
        throw new ToolError(
          `Failed to fetch GitHub issue from both API and web page: ${err.message}`,
        );
      }
    }

    if (!title && !body) {
      throw new ToolError(
        `Could not retrieve issue #${issueNumber} from https://github.com/${owner}/${repo}. Please check the URL.`,
      );
    }

    const docSections: string[] = [
      `# ${isPr ? "Pull Request" : "Issue"} #${issueNumber}: ${title || "Untitled"}`,
      `**Repository:** \`${owner}/${repo}\``,
      `**Git Clone URL:** \`${cloneUrl}\``,
      `**URL:** ${issueWebUrl}`,
      `**State:** ${state.toUpperCase()}${author ? ` | **Author:** @${author}` : ""}${labels.length ? ` | **Labels:** ${labels.join(", ")}` : ""}`,
      "\n## Issue Description\n",
      body || "(No description body provided in issue)",
    ];

    if (commentsList.length > 0) {
      docSections.push(`\n## Discussion Comments (${commentsList.length})`);
      for (const comment of commentsList) {
        docSections.push(
          `\n### Comment by @${comment.user}:\n${comment.body}`,
        );
      }
    }

    docSections.push(
      "\n---",
      "**Recommended Next Step:**",
      `1. Use \`fetch_repo\` with \`url: "${cloneUrl}"\` to clone this repository and switch into it.`,
      "2. Search the codebase for the relevant files using `search_workspace` or `list_files`.",
      "3. Inspect and edit files with `read_file`, `edit_file`, and `multi_edit`.",
      "4. Run tests or verification commands with `run_command`.",
    );

    return {
      content: docSections.join("\n"),
      summary: `Fetched issue #${issueNumber}: ${title.slice(0, 60)}${title.length > 60 ? "…" : ""}`,
    };
  },
};
