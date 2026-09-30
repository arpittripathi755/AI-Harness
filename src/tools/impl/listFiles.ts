import * as vscode from "vscode";
import type { Tool, ToolContext, ToolResult } from "../types";
import { getIgnoredDirs } from "../fsutil";
import { optionalNumber } from "../fsutil";
import { checkBroadWorkspaceWarning } from "../workspaceSafety";

const MAX_ENTRIES = parseInt(process.env.LIST_FILES_MAX_ENTRIES || "150", 10);

export const listFilesTool: Tool = {
  name: "list_files",
  description:
    "List files and directories inside the workspace as a tree. Use this to " +
    "understand the project layout before reading or editing. Skips noise dirs " +
    "like node_modules and .git.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Directory to list, relative to the workspace root. Defaults to the root.",
      },
      depth: {
        type: "integer",
        description: "How many directory levels to descend. Default 2.",
      },
    },
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    checkBroadWorkspaceWarning(ctx.workspaceRoot?.fsPath);
    const rel = typeof args.path === "string" && args.path ? args.path : ".";
    const depth = Math.max(1, Math.min(optionalNumber(args, "depth", 2), 8));
    const dir = await ctx.resolvePath(rel);
    const ignoredDirs = getIgnoredDirs();

    const lines: string[] = [];
    let count = 0;
    let truncated = false;

    const walk = async (uri: vscode.Uri, level: number): Promise<void> => {
      if (level > depth || truncated) {
        return;
      }
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(uri);
      } catch {
        entries = [];
      }

      if (ctx.changeManager) {
        const dirRel = ctx.toRelative(uri);
        entries = ctx.changeManager.getEffectiveDirectoryEntries(dirRel, entries);
      } else {
        entries.sort((a, b) => {
          // directories first, then alphabetical
          const dirDiff =
            (b[1] & vscode.FileType.Directory) - (a[1] & vscode.FileType.Directory);
          return dirDiff !== 0 ? dirDiff : a[0].localeCompare(b[0]);
        });
      }
      for (const [name, type] of entries) {
        if (ignoredDirs.has(name)) {
          continue;
        }
        if (count >= MAX_ENTRIES) {
          truncated = true;
          return;
        }
        const isDir = (type & vscode.FileType.Directory) !== 0;
        lines.push(`${"  ".repeat(level - 1)}${name}${isDir ? "/" : ""}`);
        count++;
        if (isDir) {
          await walk(vscode.Uri.joinPath(uri, name), level + 1);
        }
      }
    };

    await walk(dir, 1);

    const header = `${ctx.toRelative(dir)}/`;
    const body = lines.length ? lines.join("\n") : "(empty)";
    const note = truncated ? `\n… truncated at ${MAX_ENTRIES} entries.` : "";
    return {
      content: `${header}\n${body}${note}`,
      summary: `Listed ${count} entr${count === 1 ? "y" : "ies"} under ${ctx.toRelative(dir)}`,
    };
  },
};
