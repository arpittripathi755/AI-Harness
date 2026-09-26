import { execSync } from "child_process";
import * as path from "path";

export interface GitHubAuthInfo {
  authenticated: boolean;
  username?: string;
  error?: string;
}

export interface RepoDetails {
  owner: string;
  repo: string;
  remoteUrl: string;
  defaultBranch: string;
}

export interface PRResult {
  prUrl?: string;
  error?: string;
  headBranch?: string;
  remoteUsed?: string;
}

/**
 * Manages Git operations and GitHub PR workflow:
 * - Detecting authentication via `gh`
 * - Feature branch creation
 * - Staging and committing only DAXIOM changes
 * - Detecting upstream push access vs. automated fork fallback
 * - Pull Request creation and duplicate PR prevention
 */
export class GitHubManager {
  static exec: (cmd: string, options?: any) => any = (cmd, options) => execSync(cmd, options);

  /**
   * Check if `gh` CLI is installed and authenticated.
   */
  static checkAuth(cwd?: string): GitHubAuthInfo {
    try {
      const username = GitHubManager.exec("gh api user --jq .login", {
        cwd: cwd || process.cwd(),
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      if (username) {
        return { authenticated: true, username };
      }
    } catch {
      // Try gh auth status
      try {
        const status = GitHubManager.exec("gh auth status", {
          cwd: cwd || process.cwd(),
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const match = status.match(/Logged in to [^\s]+ account ([^\s]+)/i);
        if (match) {
          return { authenticated: true, username: match[1] };
        }
      } catch (err: any) {
        return {
          authenticated: false,
          error: "gh CLI is not authenticated. Please run `gh auth login`.",
        };
      }
    }

    return {
      authenticated: false,
      error: "gh CLI is not authenticated. Please run `gh auth login`.",
    };
  }

  /**
   * Detect repository owner, name, and default branch from git configuration.
   */
  static getRepoDetails(cwd: string): RepoDetails | null {
    try {
      const remoteUrl = GitHubManager.exec("git config --get remote.origin.url", {
        cwd,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/i);
      if (!match) {
        return null;
      }

      const owner = match[1];
      const repo = match[2];

      let defaultBranch = "main";
      try {
        const headRef = GitHubManager.exec("git symbolic-ref --short refs/remotes/origin/HEAD", {
          cwd,
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        defaultBranch = headRef.replace(/^origin\//, "") || "main";
      } catch {
        // Fallback: check current local branch
        try {
          defaultBranch = GitHubManager.exec("git branch --show-current", {
            cwd,
            encoding: "utf-8",
            timeout: 5000,
            stdio: ["ignore", "pipe", "ignore"],
          }).trim() || "main";
        } catch {
          defaultBranch = "main";
        }
      }

      return { owner, repo, remoteUrl, defaultBranch };
    } catch {
      return null;
    }
  }

  /**
   * Check if current user has write/push permissions to upstream repository.
   */
  static canPushUpstream(cwd: string, owner: string, repo: string): boolean {
    try {
      const perms = GitHubManager.exec(
        `gh api repos/${owner}/${repo} --jq ".permissions.push // .viewerPermission"`,
        {
          cwd,
          encoding: "utf-8",
          timeout: 8000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();

      if (perms === "true" || perms === "ADMIN" || perms === "WRITE") {
        return true;
      }
    } catch {
      // Fallback: dry-run push
      try {
        GitHubManager.exec("git push --dry-run origin HEAD", {
          cwd,
          encoding: "utf-8",
          timeout: 8000,
          stdio: ["ignore", "pipe", "ignore"],
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Create and switch to a safe feature branch for the task.
   */
  static createFeatureBranch(cwd: string, issueNumber?: number, slug = "fix"): string {
    const baseName = issueNumber
      ? `daxiom/issue-${issueNumber}`
      : `daxiom/${slug}-${Date.now().toString().slice(-6)}`;

    let branchName = baseName;
    let counter = 1;

    while (true) {
      try {
        GitHubManager.exec(`git show-ref --verify --quiet refs/heads/${branchName}`, {
          cwd,
          stdio: ["ignore", "ignore", "ignore"],
        });
        // Branch already exists, try next suffix
        branchName = `${baseName}-${counter++}`;
      } catch {
        // Branch does not exist, safe to create
        break;
      }
    }

    GitHubManager.exec(`git checkout -b "${branchName}"`, {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    return branchName;
  }

  /**
   * Commit accepted changes with a clear commit message.
   */
  static commitAcceptedChanges(
    cwd: string,
    message: string,
    files?: string[],
  ): string {
    if (files && files.length > 0) {
      for (const f of files) {
        try {
          GitHubManager.exec(`git add "${f}"`, { cwd, timeout: 5000, stdio: "ignore" });
        } catch {
          // ignore if file was deleted
        }
      }
    } else {
      GitHubManager.exec("git add -A", { cwd, timeout: 10000, stdio: "ignore" });
    }

    // Commit only if there are staged changes
    const status = GitHubManager.exec("git status --porcelain", {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    if (!status) {
      return "NO_CHANGES";
    }

    const sanitizedMessage = message.replace(/"/g, '\\"');
    GitHubManager.exec(`git commit -m "${sanitizedMessage}"`, {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const commitHash = GitHubManager.exec("git rev-parse --short HEAD", {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    return commitHash;
  }

  /**
   * Push branch to upstream (if writable) or automatically create fork and push to fork.
   */
  static pushBranch(
    cwd: string,
    branchName: string,
    details: RepoDetails,
  ): { remote: string; success: boolean; error?: string } {
    if (process.env.AXIOM_SKIP_PR === "1" || process.env.AXIOM_MOCK_PR === "1") {
      return { remote: "fork (mocked)", success: true };
    }

    const isWritable = this.canPushUpstream(cwd, details.owner, details.repo);

    if (isWritable) {
      try {
        GitHubManager.exec(`git push -u origin "${branchName}"`, {
          cwd,
          encoding: "utf-8",
          timeout: 60000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        return { remote: "origin", success: true };
      } catch (err: any) {
        const errorMsg = err.stderr ? err.stderr.toString().trim() : err.message;
        return { remote: "origin", success: false, error: errorMsg };
      }
    }

    // Upstream not writable: automate fork workflow
    try {
      // Check if `fork` remote is already configured
      let hasForkRemote = false;
      try {
        const remotes = GitHubManager.exec("git remote", { cwd, encoding: "utf-8" });
        hasForkRemote = remotes.split("\n").includes("fork");
      } catch {
        hasForkRemote = false;
      }

      if (!hasForkRemote) {
        // Create fork or retrieve existing user fork
        GitHubManager.exec(`gh repo fork "${details.owner}/${details.repo}" --remote --remote-name fork`, {
          cwd,
          encoding: "utf-8",
          timeout: 60000,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }

      GitHubManager.exec(`git push -u fork "${branchName}"`, {
        cwd,
        encoding: "utf-8",
        timeout: 60000,
        stdio: ["ignore", "pipe", "pipe"],
      });

      return { remote: "fork", success: true };
    } catch (err: any) {
      const errorMsg = err.stderr ? err.stderr.toString().trim() : err.message;
      return { remote: "fork", success: false, error: `Fork/push failed: ${errorMsg}` };
    }
  }

  /**
   * Create a pull request against upstream repository.
   */
  static createPullRequest(
    cwd: string,
    options: {
      title: string;
      body: string;
      headBranch: string;
      baseBranch?: string;
      owner: string;
      repo: string;
      remoteUsed: string;
      username?: string;
    },
  ): PRResult {
    const { title, body, headBranch, baseBranch, owner, repo, remoteUsed } = options;
    const username = options.username || this.checkAuth(cwd).username;
    const queryHead = remoteUsed === "fork" && username ? `${username}:${headBranch}` : headBranch;

    if (process.env.AXIOM_SKIP_PR === "1" || process.env.AXIOM_MOCK_PR === "1") {
      return {
        prUrl: `https://github.com/${owner}/${repo}/pull/mock-${headBranch}`,
        headBranch,
        remoteUsed,
      };
    }

    // 1. Check if PR already exists for this branch
    try {
      const existing = GitHubManager.exec(
        `gh pr list --repo "${owner}/${repo}" --head "${queryHead}" --json url --jq ".[0].url"`,
        {
          cwd,
          encoding: "utf-8",
          timeout: 10000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();

      if (existing) {
        return { prUrl: existing, headBranch, remoteUsed };
      }
    } catch {
      // ignore check error
    }

    // 2. Create PR
    try {
      const baseFlag = baseBranch ? `--base "${baseBranch}"` : "";
      const headFlag =
        remoteUsed === "fork" && username
          ? `--head "${username}:${headBranch}"`
          : `--head "${headBranch}"`;
      const sanitizedTitle = title.replace(/"/g, '\\"');
      const sanitizedBody = body.replace(/"/g, '\\"');

      const prUrl = GitHubManager.exec(
        `gh pr create --repo "${owner}/${repo}" --title "${sanitizedTitle}" --body "${sanitizedBody}" ${baseFlag} ${headFlag}`,
        {
          cwd,
          encoding: "utf-8",
          timeout: 30000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ).trim();

      return { prUrl, headBranch, remoteUsed };
    } catch (err: any) {
      const errorMsg = err.stderr ? err.stderr.toString().trim() : err.message;
      return { error: `Failed to create PR: ${errorMsg}`, headBranch, remoteUsed };
    }
  }
}
