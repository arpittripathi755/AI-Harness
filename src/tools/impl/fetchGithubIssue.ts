import { execSync } from "child_process";
import type { Tool, ToolContext, ToolResult } from "../types";

export interface GitHubIssueDetails {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  url: string;
}

export interface FetchGithubIssueResult {
  issue?: GitHubIssueDetails;
  error?: string;
}

/**
 * Fetch issue details authoritatively using `gh` CLI with REST API fallback.
 */
export async function fetchGithubIssue(
  issueNumber: number,
  owner?: string,
  repo?: string,
  cwd?: string,
): Promise<FetchGithubIssueResult> {
  // If owner/repo not explicitly provided, try to detect from git remote in cwd
  if ((!owner || !repo) && cwd) {
    try {
      const remoteUrl = execSync("git config --get remote.origin.url", {
        cwd,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/i);
      if (match) {
        owner ??= match[1];
        repo ??= match[2];
      }
    } catch {
      // Ignore git remote detection error
    }
  }

  const repoFlag = owner && repo ? `--repo "${owner}/${repo}"` : "";

  // 1. Try `gh` CLI
  try {
    const cmd = `gh issue view ${issueNumber} ${repoFlag} --json number,title,body,labels,state,url`;
    const stdout = execSync(cmd, {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const parsed = JSON.parse(stdout);
    const labels = Array.isArray(parsed.labels)
      ? parsed.labels.map((l: any) => (typeof l === "string" ? l : l.name || ""))
      : [];

    return {
      issue: {
        number: parsed.number ?? issueNumber,
        title: parsed.title ?? "",
        body: parsed.body ?? "",
        labels,
        state: parsed.state ?? "open",
        url: parsed.url ?? "",
      },
    };
  } catch (err: any) {
    const ghError = err.stderr ? err.stderr.toString().trim() : err.message || "";

    // 2. Fallback: try GitHub public REST API if owner and repo are known
    if (owner && repo) {
      try {
        const headers: Record<string, string> = {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "Axiom-Coding-Agent",
        };
        const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
          headers,
        });

        if (res.ok) {
          const data: any = await res.json();
          const labels = Array.isArray(data.labels)
            ? data.labels.map((l: any) => (typeof l === "string" ? l : l.name || ""))
            : [];
          return {
            issue: {
              number: data.number ?? issueNumber,
              title: data.title ?? "",
              body: data.body ?? "",
              labels,
              state: data.state ?? "open",
              url: data.html_url ?? "",
            },
          };
        }
      } catch {
        // Fallback failed
      }
    }

    return {
      error: `Could not fetch GitHub issue #${issueNumber}${owner && repo ? ` for ${owner}/${repo}` : ""}: ${ghError || "gh CLI not authenticated or issue not found"}`,
    };
  }
}

export const fetchGithubIssueTool: Tool = {
  name: "fetch_github_issue",
  description:
    "Fetch official GitHub issue details (title, description, body, labels, state) directly from GitHub. " +
    "ALWAYS call this tool first when given a task mentioning a GitHub issue number (e.g. #123) rather than guessing or searching git logs.",
  parameters: {
    type: "object",
    properties: {
      issue_number: {
        type: "integer",
        description: "The issue number to fetch (e.g. 123 for issue #123).",
      },
      owner: {
        type: "string",
        description: "GitHub repository owner/organization (optional if running in cloned repo).",
      },
      repo: {
        type: "string",
        description: "GitHub repository name (optional if running in cloned repo).",
      },
    },
    required: ["issue_number"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const rawNum = args.issue_number;
    const issueNumber = typeof rawNum === "number" ? rawNum : parseInt(String(rawNum), 10);
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
      return {
        isError: true,
        content: JSON.stringify({ error: "Invalid issue_number. Must be a positive integer." }),
        summary: "Invalid issue number",
      };
    }

    const owner = typeof args.owner === "string" ? args.owner.trim() : undefined;
    const repo = typeof args.repo === "string" ? args.repo.trim() : undefined;
    const cwd = ctx.workspaceRoot?.fsPath;
    console.log(`[fetch_github_issue] issueNumber=${issueNumber} owner=${owner} repo=${repo} cwd="${cwd}"`);

    const result = await fetchGithubIssue(issueNumber, owner, repo, cwd);
    if (result.error || !result.issue) {
      return {
        isError: true,
        content: JSON.stringify({ error: result.error || "Issue not found" }, null, 2),
        summary: `Failed to fetch issue #${issueNumber}`,
      };
    }

    const issue = result.issue;
    const content = [
      `GitHub Issue #${issue.number}: ${issue.title}`,
      `State: ${issue.state}`,
      `URL: ${issue.url}`,
      `Labels: ${issue.labels.length > 0 ? issue.labels.join(", ") : "none"}`,
      "",
      "--- Description ---",
      issue.body || "(No description provided)",
    ].join("\n");

    return {
      content,
      summary: `Fetched issue #${issue.number}: ${issue.title}`,
    };
  },
};
