import * as https from "https";
import { execSync } from "child_process";
import type { Tool, ToolContext, ToolResult } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  html_url: string;
  user?: { login: string };
  labels?: Array<{ name: string }>;
  comments?: Array<{ user?: { login: string }; body: string }>;
}

/** Parse owner/repo/number from various GitHub URL formats or short "owner/repo#N". */
function parseGitHubIssueRef(ref: string): {
  owner: string;
  repo: string;
  number: number;
  cloneUrl: string;
} | null {
  // https://github.com/owner/repo/issues/123
  // https://github.com/owner/repo/pull/123
  const urlMatch = ref.match(
    /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/(?:issues|pull)\/(\d+)/i,
  );
  if (urlMatch) {
    const [, owner, repo, num] = urlMatch;
    return {
      owner,
      repo,
      number: parseInt(num, 10),
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    };
  }

  // owner/repo#123
  const shortMatch = ref.match(/^([^/\s]+)\/([^#\s]+)#(\d+)$/);
  if (shortMatch) {
    const [, owner, repo, num] = shortMatch;
    return {
      owner,
      repo,
      number: parseInt(num, 10),
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    };
  }

  return null;
}

/** Check whether the `gh` CLI is available and authenticated. */
function ghAvailable(): boolean {
  try {
    execSync("gh auth status", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    // gh might still work for public repos even without auth
    try {
      execSync("gh --version", { stdio: "pipe", timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}

/** Fetch issue via `gh` CLI (most reliable, handles auth automatically). */
function fetchViaGhCli(
  owner: string,
  repo: string,
  number: number,
): GitHubIssue | null {
  try {
    const json = execSync(
      `gh issue view ${number} --repo ${owner}/${repo} --json number,title,body,state,author,labels,comments,url`,
      { stdio: "pipe", timeout: 15000 },
    ).toString("utf-8");
    const data = JSON.parse(json);
    // gh CLI uses "author" not "user", and "url" not "html_url"
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? "",
      state: data.state ?? "open",
      html_url: data.url ?? `https://github.com/${owner}/${repo}/issues/${number}`,
      user: data.author ? { login: data.author.login } : undefined,
      labels: data.labels ?? [],
      comments: (data.comments ?? []).map((c: any) => ({
        user: c.author ? { login: c.author.login } : undefined,
        body: c.body ?? "",
      })),
    };
  } catch {
    return null;
  }
}

/** Fetch issue via GitHub REST API. */
function fetchViaRestApi(
  owner: string,
  repo: string,
  number: number,
  token?: string,
): Promise<GitHubIssue | null> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {
      "User-Agent": "Axiom-Agent/1.0",
      Accept: "application/vnd.github.v3+json",
    };
    if (token) {
      headers["Authorization"] = `token ${token}`;
    }

    const makeRequest = (url: string): Promise<string> =>
      new Promise((res, rej) => {
        const req = https.get(url, { headers }, (resp) => {
          if (resp.statusCode === 301 || resp.statusCode === 302) {
            return makeRequest(resp.headers.location!).then(res, rej);
          }
          const chunks: Buffer[] = [];
          resp.on("data", (chunk) => chunks.push(chunk));
          resp.on("end", () => res(Buffer.concat(chunks).toString("utf-8")));
        });
        req.on("error", rej);
        req.setTimeout(15000, () => {
          req.destroy();
          rej(new Error("timeout"));
        });
      });

    Promise.all([
      makeRequest(
        `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
      ),
      makeRequest(
        `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`,
      ),
    ])
      .then(([issueJson, commentsJson]) => {
        const issue = JSON.parse(issueJson) as any;
        const comments = JSON.parse(commentsJson) as any[];
        if (!issue.title) {
          resolve(null);
          return;
        }
        resolve({
          number: issue.number,
          title: issue.title,
          body: issue.body ?? "",
          state: issue.state ?? "open",
          html_url: issue.html_url,
          user: issue.user,
          labels: issue.labels ?? [],
          comments: comments.map((c) => ({ user: c.user, body: c.body })),
        });
      })
      .catch(() => resolve(null));
  });
}

/** Format issue into a markdown context block for the agent. */
function formatIssue(
  issue: GitHubIssue,
  owner: string,
  repo: string,
): string {
  const labels =
    issue.labels && issue.labels.length > 0
      ? issue.labels.map((l) => l.name).join(", ")
      : "none";
  const author = issue.user?.login ?? "unknown";

  let md = `## GitHub Issue #${issue.number}: ${issue.title}

**Repository:** ${owner}/${repo}
**URL:** ${issue.html_url}
**State:** ${issue.state}
**Author:** ${author}
**Labels:** ${labels}

### Description

${issue.body || "_No description provided._"}
`;

  if (issue.comments && issue.comments.length > 0) {
    md += `\n### Comments (${issue.comments.length})\n\n`;
    for (const c of issue.comments.slice(0, 10)) {
      md += `**${c.user?.login ?? "unknown"}:** ${c.body}\n\n---\n\n`;
    }
  }

  md += `\n### Recommended Next Steps

1. Clone or switch to the repository: \`https://github.com/${owner}/${repo}.git\`
2. Understand the issue requirements above.
3. Inspect the repository structure (list_files, read_file, search_workspace).
4. Implement the required changes (create_file, edit_file, multi_edit).
5. Run relevant tests/build commands (run_command).
6. Fix any failures and verify the solution.
7. Report what was changed and confirm the issue is resolved.
`;

  return md;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const fetchGithubIssueTool: Tool = {
  name: "fetch_github_issue",
  mutates: false,
  description:
    "Fetch a GitHub issue or pull request by URL, or by owner/repo + issue number. " +
    "Uses gh CLI if available, falls back to GitHub REST API. " +
    "Returns the issue title, body, labels, and comments formatted as markdown.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "Full GitHub issue URL, e.g. https://github.com/owner/repo/issues/42. " +
          "Or short form: owner/repo#42.",
      },
      repo: {
        type: "string",
        description: "Repository in owner/repo format (e.g. facebook/react).",
      },
      issue_number: {
        type: "integer",
        description: "Issue number (used with the repo parameter).",
      },
    },
  },

  async execute(
    args,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    // --- Resolve owner, repo, number ---
    let owner: string | undefined;
    let repo: string | undefined;
    let number: number | undefined;

    if (typeof args.url === "string" && args.url) {
      const parsed = parseGitHubIssueRef(args.url);
      if (!parsed) {
        return {
          content: `Error: could not parse a GitHub issue reference from: ${args.url}`,
          isError: true,
          summary: "Invalid GitHub issue URL",
        };
      }
      ({ owner, repo, number } = parsed);
    } else if (
      typeof args.repo === "string" &&
      typeof args.issue_number === "number"
    ) {
      const repoStr = args.repo as string;
      const parts = repoStr.split("/");
      if (parts.length !== 2) {
        return {
          content: "Error: repo must be in owner/repo format.",
          isError: true,
          summary: "Invalid repo format",
        };
      }
      [owner, repo] = parts;
      number = args.issue_number as number;
    } else {
      return {
        content:
          "Error: provide either 'url' (GitHub issue URL) or 'repo' (owner/repo) + 'issue_number'.",
        isError: true,
        summary: "Missing parameters",
      };
    }

    // --- Try gh CLI first (fastest, most reliable for auth) ---
    const token =
      process.env.GITHUB_TOKEN?.trim() ||
      process.env.GH_TOKEN?.trim() ||
      undefined;

    let issue: GitHubIssue | null = null;

    if (ghAvailable()) {
      issue = fetchViaGhCli(owner!, repo!, number!);
    }

    // --- Fallback: REST API ---
    if (!issue) {
      issue = await fetchViaRestApi(owner!, repo!, number!, token);
    }

    if (!issue) {
      return {
        content:
          `Error: could not fetch issue #${number} from ${owner}/${repo}.\n` +
          `Possible reasons:\n` +
          `- The repository is private and you need to set GITHUB_TOKEN or run \`gh auth login\`.\n` +
          `- The issue number does not exist.\n` +
          `- GitHub API rate limit exceeded (set GITHUB_TOKEN to raise the limit).`,
        isError: true,
        summary: `Failed to fetch issue #${number}`,
      };
    }

    const formatted = formatIssue(issue, owner!, repo!);
    return {
      content: formatted,
      isError: false,
      summary: `Issue #${issue.number}: ${issue.title}`,
    };
  },
};
