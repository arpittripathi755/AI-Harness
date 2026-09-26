import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolError } from "../types";
import { requireString } from "../fsutil";

export const fetchRepoTool: Tool = {
  name: "fetch_repo",
  mutates: true,
  description:
    "Clone or fetch a public Git repository from a URL (e.g. GitHub URL) to a local " +
    "directory, and automatically switch the agent's active working directory and workspace " +
    "root to that repository. All subsequent tool calls will operate directly inside the cloned repo.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The Git repository URL (e.g. 'https://github.com/owner/repo' or 'https://github.com/owner/repo.git').",
      },
      dest_dir: {
        type: "string",
        description:
          "Optional destination directory path. Defaults to a folder named after the repo in the current working directory.",
      },
      branch: {
        type: "string",
        description: "Optional branch, tag, or commit to checkout.",
      },
      depth: {
        type: "integer",
        description: "Clone depth (default 50). Set to 0 or negative for full clone.",
      },
    },
    required: ["url"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const rawUrl = requireString(args, "url").trim();
    if (!rawUrl) {
      throw new ToolError("Repository URL is required.");
    }

    // Parse URL and extract potential tree/branch references like:
    // https://github.com/owner/repo/tree/branch-name
    let cleanUrl = rawUrl;
    let urlBranch: string | undefined;

    const treeMatch = rawUrl.match(/^(https?:\/\/github\.com\/[^/]+\/[^/]+)\/tree\/([^/]+(?:\/[^/]+)*)\/?$/);
    if (treeMatch) {
      cleanUrl = treeMatch[1];
      urlBranch = treeMatch[2];
    } else if (cleanUrl.endsWith(".git")) {
      // keep clean
    }

    const branch = typeof args.branch === "string" && args.branch.trim() ? args.branch.trim() : urlBranch;
    const depth = typeof args.depth === "number" ? args.depth : 50;

    // Derive repo name: https://github.com/owner/repo -> repo
    const match = cleanUrl.match(/\/([^/]+?)(?:\.git)?$/);
    const repoName = match ? match[1] : "repo";

    // Determine target destination path
    const baseCwd = ctx.workspaceRoot ? ctx.workspaceRoot.fsPath : process.cwd();
    let targetPath: string;
    if (typeof args.dest_dir === "string" && args.dest_dir.trim()) {
      const customDest = args.dest_dir.trim().replace(/^~/, process.env.HOME || "");
      targetPath = path.isAbsolute(customDest)
        ? path.normalize(customDest)
        : path.normalize(path.join(baseCwd, customDest));
    } else {
      targetPath = path.normalize(path.join(baseCwd, repoName));
    }

    // Check if target directory already exists and is a git repository
    const isExistingGit =
      fs.existsSync(targetPath) &&
      fs.existsSync(path.join(targetPath, ".git"));

    let command: string;
    if (isExistingGit) {
      // Fetch latest and optionally switch branch
      if (branch) {
        command = `git fetch --all && git checkout ${branch} && git pull origin ${branch}`;
      } else {
        command = `git fetch --all && git pull`;
      }
    } else {
      // Clone fresh
      const branchFlag = branch ? ` --branch ${branch}` : "";
      const depthFlag = depth > 0 ? ` --depth ${depth}` : "";
      command = `git clone${depthFlag}${branchFlag} "${cleanUrl}" "${targetPath}"`;
    }

    // Run git command
    const { stdout, stderr, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((resolve) => {
      exec(
        command,
        { cwd: isExistingGit ? targetPath : baseCwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
        (err, out, errOut) => {
          resolve({
            stdout: out || "",
            stderr: errOut || "",
            code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
          });
        },
      );
    });

    if (code !== 0) {
      throw new ToolError(
        `Git command failed (exit code ${code}):\n$ ${command}\n${stderr || stdout}`,
      );
    }

    // Switch working directory and update workspace root
    try {
      process.chdir(targetPath);
    } catch (err: any) {
      throw new ToolError(`Failed to chdir into ${targetPath}: ${err.message}`);
    }

    const newRootUri = vscode.Uri.file(targetPath);
    (ctx as any).workspaceRoot = newRootUri;
    if ((vscode.workspace as any).workspaceFolders) {
      (vscode.workspace as any).workspaceFolders = [
        {
          uri: newRootUri,
          name: path.basename(targetPath) || repoName,
          index: 0,
        },
      ];
    }
    if (typeof (ctx as any).onWorkspaceChanged === "function") {
      (ctx as any).onWorkspaceChanged(newRootUri);
    }

    // Inspect repository to provide helpful starting context
    let recentCommit = "";
    try {
      recentCommit = require("child_process")
        .execSync("git log -1 --oneline", { cwd: targetPath, encoding: "utf-8" })
        .trim();
    } catch {
      // ignore
    }

    let currentBranch = "";
    try {
      currentBranch = require("child_process")
        .execSync("git branch --show-current", { cwd: targetPath, encoding: "utf-8" })
        .trim();
    } catch {
      // ignore
    }

    // Identify project stack
    const detected: string[] = [];
    if (fs.existsSync(path.join(targetPath, "package.json"))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(targetPath, "package.json"), "utf-8"));
        detected.push(`Node.js/npm (${pkg.name || "package"}${pkg.version ? `@${pkg.version}` : ""})`);
      } catch {
        detected.push("Node.js/npm");
      }
    }
    if (fs.existsSync(path.join(targetPath, "requirements.txt")) || fs.existsSync(path.join(targetPath, "pyproject.toml"))) {
      detected.push("Python");
    }
    if (fs.existsSync(path.join(targetPath, "Cargo.toml"))) {
      detected.push("Rust (Cargo)");
    }
    if (fs.existsSync(path.join(targetPath, "go.mod"))) {
      detected.push("Go");
    }
    if (fs.existsSync(path.join(targetPath, "pom.xml")) || fs.existsSync(path.join(targetPath, "build.gradle"))) {
      detected.push("Java");
    }

    const sections = [
      `Successfully ${isExistingGit ? "updated" : "cloned"} repository: ${cleanUrl}`,
      `Local path: ${targetPath}`,
      `Current branch: ${currentBranch || branch || "default"}`,
      recentCommit ? `Latest commit: ${recentCommit}` : "",
      detected.length ? `Detected stack: ${detected.join(", ")}` : "",
      `\n✓ Active workspace has been switched to ${targetPath}. All file operations and terminal commands are now scoped to this repository.`,
    ].filter(Boolean);

    return {
      content: sections.join("\n"),
      summary: `${isExistingGit ? "Updated" : "Cloned"} ${repoName} (${currentBranch || "ready"})`,
    };
  },
};
