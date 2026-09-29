import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolDeniedError, ToolError } from "../types";
import { requireString } from "../fsutil";
import { isInside } from "../workspace";

/** Narrow callback-style signature for execFile — avoids __promisify__ requirement in mocks. */
export type ExecFileFunction = (
  file: string,
  args: readonly string[],
  options: { timeout?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => { kill?: () => void };
let execFileImpl: ExecFileFunction = execFile as unknown as ExecFileFunction;

export function setExecFileForTesting(fn: ExecFileFunction): void {
  execFileImpl = fn;
}

export function resetExecFileForTesting(): void {
  execFileImpl = execFile;
}

function sanitizeFolderName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "cloned-repo";
}

export function extractRepoNameFromUrl(repoUrl: string): string {
  try {
    const u = new URL(repoUrl);
    const parts = u.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (parts.length > 0) {
      return sanitizeFolderName(parts[parts.length - 1]);
    }
  } catch {}
  return sanitizeFolderName(repoUrl.replace(/\.git$/, "").replace(/.*[/\\]/, ""));
}

export const gitCloneTool: Tool = {
  name: "git_clone",
  description:
    "Clone a remote Git repository into a subfolder of the current workspace. " +
    "Use this tool whenever the user provides a repository URL and the repository is not yet in the workspace.",
  mutates: true,
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The HTTPS URL of the Git repository to clone (e.g. 'https://github.com/org/repo.git').",
      },
      folder: {
        type: "string",
        description:
          "Optional target folder name inside the workspace. If omitted, the repository name is used.",
      },
    },
    required: ["url"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const url = requireString(args, "url").trim();

    // 1. Validate HTTPS URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new ToolError(`Invalid URL "${url}". Only HTTPS git URLs are allowed.`);
    }

    if (parsedUrl.protocol !== "https:") {
      throw new ToolError(
        `Invalid protocol "${parsedUrl.protocol}". Only HTTPS git URLs are allowed.`,
      );
    }

    const host = parsedUrl.hostname.toLowerCase();
    const allowedHosts = ["github.com", "gitlab.com", "bitbucket.org"];
    if (!allowedHosts.some((h) => host === h || host.endsWith("." + h))) {
      throw new ToolError(
        `Host "${host}" is not allowed. Only GitHub, GitLab, and Bitbucket URLs are supported.`,
      );
    }

    // 2. Resolve destination path
    const folderArg =
      typeof args.folder === "string" && args.folder.trim() ? args.folder.trim() : "";
    const folderName = folderArg ? sanitizeFolderName(folderArg) : extractRepoNameFromUrl(url);

    const rootFs = ctx.workspaceRoot ? ctx.workspaceRoot.fsPath : process.cwd();
    const dest = path.resolve(rootFs, folderName);

    if (!isInside(rootFs, dest)) {
      throw new ToolError(`Destination folder "${folderName}" resolves outside the workspace root.`);
    }

    // 3. Refuse if destination already exists and is non-empty
    if (fs.existsSync(dest)) {
      try {
        const entries = fs.readdirSync(dest);
        if (entries.length > 0) {
          throw new ToolError(
            `Destination folder "${folderName}" already exists and is not empty.`,
          );
        }
      } catch (err: any) {
        if (err instanceof ToolError) {
          throw err;
        }
        throw new ToolError(
          `Cannot inspect destination folder "${folderName}": ${err.message}`,
        );
      }
    }

    // 4. Approval check (if not autoEdit)
    if (!ctx.autoEdit) {
      const approved = await ctx.confirm(
        `Clone repository "${url}" into "${folderName}"?`,
        `Command: git clone --depth 1 ${url} ${folderName}`,
      );
      if (!approved) {
        throw new ToolDeniedError(`User denied cloning repository "${url}".`);
      }
    }

    // 5. Clone using execFile (no shell interpolation)
    await new Promise<void>((resolve, reject) => {
      execFileImpl(
        "git",
        ["clone", "--depth", "1", url, dest],
        {
          timeout: 120_000,
          signal: ctx.signal,
        },
        (error, _stdout, stderr) => {
          if (error) {
            reject(new ToolError(`git clone failed: ${stderr || error.message}`));
          } else {
            resolve();
          }
        },
      );
    });

    // 6. Switch workspace if callback available
    if (ctx.switchWorkspace) {
      try {
        await ctx.switchWorkspace(dest);
      } catch {}
    }

    return {
      content: `Successfully cloned ${url} into "${folderName}" at ${dest}.`,
      summary: `Cloned into ${folderName}`,
    };
  },
};
