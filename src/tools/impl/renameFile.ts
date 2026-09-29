import * as vscode from "vscode";
import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolError } from "../types";
import { requireString } from "../fsutil";

export const renameFileTool: Tool = {
  name: "rename_file",
  mutates: true,
  description:
    "Rename or move a file (or directory) within the workspace. Both source and " +
    "destination are resolved relative to the workspace root.",
  parameters: {
    type: "object",
    properties: {
      from: {
        type: "string",
        description: "Existing path relative to the workspace root.",
      },
      to: {
        type: "string",
        description: "New path relative to the workspace root.",
      },
      overwrite: {
        type: "boolean",
        description: "Overwrite the destination if it exists. Default false.",
      },
    },
    required: ["from", "to"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const fromRel = requireString(args, "from");
    const toRel = requireString(args, "to");
    const overwrite = args.overwrite === true;

    const from = await ctx.resolvePath(fromRel);
    const to = await ctx.resolvePath(toRel);

    const fromRelPath = ctx.toRelative(from);
    const toRelPath = ctx.toRelative(to);

    const fromExists = ctx.changeManager
      ? await ctx.changeManager.fileExists(fromRelPath)
      : await (async () => {
          try {
            await vscode.workspace.fs.stat(from);
            return true;
          } catch {
            return false;
          }
        })();

    if (!fromExists) {
      throw new ToolError(`Source does not exist: ${fromRelPath}`);
    }

    if (!overwrite) {
      const toExists = ctx.changeManager
        ? await ctx.changeManager.fileExists(toRelPath)
        : await (async () => {
            try {
              await vscode.workspace.fs.stat(to);
              return true;
            } catch {
              return false;
            }
          })();

      if (toExists) {
        throw new ToolError(
          `Destination already exists: ${toRelPath}. Pass overwrite:true to overwrite.`,
        );
      }
    }

    if (ctx.changeManager) {
      await ctx.changeManager.stageRename(fromRelPath, toRelPath);
    } else {
      await vscode.workspace.fs.rename(from, to, { overwrite });
    }
    return {
      content: `Renamed ${fromRelPath} → ${toRelPath}.`,
      summary: `Renamed → ${toRelPath}`,
    };
  },
};
