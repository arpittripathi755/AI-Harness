import * as path from "path";
import * as fs from "fs";
import { execSync, exec } from "child_process";
import * as vscode from "vscode";
import type { Tool, ToolContext, ToolResult } from "../types";

const DEFAULT_CLONE_BASE = path.join(
  process.env.HOME ?? "/tmp",
  ".axiom",
  "repos",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise GitHub SSH URLs to HTTPS. */
function normalizeGitUrl(raw: string): string {
  const trimmed = raw.trim();
  // git@github.com:owner/repo.git → https://github.com/owner/repo.git
  const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}.git`;
  }
  return trimmed.replace(/\.git$/, "") + ".git";
}

/** Extract repo name (last path segment without .git). */
function repoNameFromUrl(url: string): string {
  const base = url.replace(/\.git$/, "");
  return path.basename(base);
}

/** Detect primary branch name from remote. */
function detectDefaultBranch(dir: string): string {
  try {
    const out = execSync("git remote show origin", {
      cwd: dir,
      stdio: "pipe",
      timeout: 10000,
    }).toString("utf-8");
    const m = out.match(/HEAD branch:\s*(.+)/);
    if (m) return m[1].trim();
  } catch {
    // ignore
  }
  return "main";
}

/** Detect project stack for helpful guidance. */
function detectStack(dir: string): string[] {
  const stacks: string[] = [];
  const files = fs.readdirSync(dir).map((f) => f.toLowerCase());
  if (files.includes("package.json")) stacks.push("Node.js (npm/yarn)");
  if (files.includes("requirements.txt") || files.includes("pyproject.toml"))
    stacks.push("Python (pip)");
  if (files.includes("cargo.toml")) stacks.push("Rust (cargo)");
  if (files.includes("go.mod")) stacks.push("Go (go build)");
  if (files.includes("pom.xml") || files.includes("build.gradle"))
    stacks.push("Java (maven/gradle)");
  if (files.includes("makefile") || files.includes("gnumakefile"))
    stacks.push("Make");
  return stacks;
}

/** Run a shell command in a directory, return stdout+stderr. */
function runIn(cmd: string, cwd: string, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve) => {
    exec(
      cmd,
      { cwd, timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve((stdout + "\n" + stderr).trim());
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const fetchRepoTool: Tool = {
  name: "fetch_repo",
  mutates: true,
  description:
    "Clone or fetch a public Git repository from a URL and set it as the active workspace. " +
    "If the repository is already cloned locally (matching URL), it is fetched/pulled instead of re-cloned. " +
    "After cloning, the active workspace is switched to the repository root so all tools operate inside it. " +
    "Accepts HTTPS or SSH GitHub URLs. Optional: specify a destination directory, branch, or clone depth.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The Git repository URL. Examples:\n" +
          "  https://github.com/owner/repo.git\n" +
          "  git@github.com:owner/repo.git",
      },
      dest_dir: {
        type: "string",
        description:
          "Optional absolute or relative path where the repo should be cloned. " +
          `Defaults to ~/.axiom/repos/<repo-name>.`,
      },
      branch: {
        type: "string",
        description:
          "Optional branch or tag to checkout after cloning. Defaults to the remote HEAD.",
      },
      depth: {
        type: "integer",
        description: "Clone depth (default 50). Use 0 for a full clone.",
      },
    },
    required: ["url"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const rawUrl = (args.url as string)?.trim();
    if (!rawUrl) {
      return {
        content: "Error: url is required.",
        isError: true,
        summary: "Missing url",
      };
    }

    const normalizedUrl = normalizeGitUrl(rawUrl);
    const repoName = repoNameFromUrl(normalizedUrl);
    const depth =
      typeof args.depth === "number" && args.depth >= 0
        ? args.depth
        : 50;
    const requestedBranch =
      typeof args.branch === "string" ? args.branch.trim() : undefined;

    // Determine target path
    let targetPath: string;
    if (typeof args.dest_dir === "string" && args.dest_dir.trim()) {
      const d = args.dest_dir.trim().replace(/^~/, process.env.HOME ?? "/tmp");
      targetPath = path.isAbsolute(d)
        ? d
        : path.join(ctx.workspaceRoot?.fsPath ?? process.cwd(), d);
    } else {
      targetPath = path.join(DEFAULT_CLONE_BASE, repoName);
    }

    const gitDir = path.join(targetPath, ".git");
    const alreadyCloned = fs.existsSync(gitDir);

    let log = "";

    if (alreadyCloned) {
      // Check if the remote URL matches
      let existingRemote = "";
      try {
        existingRemote = execSync("git remote get-url origin", {
          cwd: targetPath,
          stdio: "pipe",
        })
          .toString("utf-8")
          .trim();
      } catch {
        // ignore
      }

      const normalizedExisting = normalizeGitUrl(existingRemote);
      if (normalizedExisting === normalizedUrl) {
        log += `Repository already cloned at ${targetPath}. Fetching latest changes...\n`;
        log += await runIn("git fetch --all --prune", targetPath);
        log += "\n";
        log += await runIn("git pull --ff-only", targetPath);
      } else {
        log += `Directory exists but has a different remote (${existingRemote}). Re-cloning...\n`;
        fs.rmSync(targetPath, { recursive: true, force: true });
        // fall through to clone — gitDir no longer exists after rmSync
      }
    }

    if (!fs.existsSync(gitDir)) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const depthFlag = depth > 0 ? `--depth ${depth}` : "";
      const branchFlag = requestedBranch
        ? `--branch ${requestedBranch}`
        : "";
      const cloneCmd = `git clone ${depthFlag} ${branchFlag} ${normalizedUrl} ${targetPath}`.trim();
      log += `Cloning: ${cloneCmd}\n`;
      log += await runIn(cloneCmd, path.dirname(targetPath), 120_000);
    }

    if (!fs.existsSync(path.join(targetPath, ".git"))) {
      return {
        content: `Error: Clone failed. Output:\n${log}`,
        isError: true,
        summary: `Failed to clone ${repoName}`,
      };
    }

    // Checkout requested branch if provided
    if (requestedBranch) {
      log += "\n";
      log += await runIn(
        `git checkout ${requestedBranch}`,
        targetPath,
      );
    }

    // Update process working directory
    try {
      process.chdir(targetPath);
    } catch {
      // ignore — some envs restrict chdir
    }

    // Switch workspace context so all tools operate inside repo
    const newRoot = vscode.Uri.file(targetPath);
    ctx.workspaceRoot = newRoot;
    (vscode.workspace as any).workspaceFolders = [
      { uri: newRoot, name: repoName, index: 0 },
    ];

    // Fire workspace-changed callback (registered in cli.ts)
    if (typeof (ctx as any).onWorkspaceChanged === "function") {
      (ctx as any).onWorkspaceChanged(newRoot);
    }

    // Detect stack for helpful context
    const stacks = detectStack(targetPath);
    const branch = detectDefaultBranch(targetPath);
    const stackInfo =
      stacks.length > 0
        ? `\nDetected stack: ${stacks.join(", ")}`
        : "";

    const summary =
      `Repository: ${repoName}\n` +
      `Location: ${targetPath}\n` +
      `Branch: ${branch}${stackInfo}\n\n` +
      `Workspace switched to ${targetPath}.\n` +
      `All tools now operate inside this repository.`;

    return {
      content: `${summary}\n\nClone/fetch log:\n${log}`,
      isError: false,
      summary: `Cloned ${repoName} → ${targetPath}`,
    };
  },
};
