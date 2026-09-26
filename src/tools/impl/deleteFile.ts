import * as vscode from "vscode";
import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolDeniedError, ToolError } from "../types";
import { requireString } from "../fsutil";

export const deleteFileTool: Tool = {
  name: "delete_file",
  mutates: true,
  description:
    "Delete a file or directory in the workspace. This is destructive and ALWAYS " +
    "asks the user to confirm before deleting. Deletes into the OS trash when possible.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path relative to the workspace root.",
      },
      recursive: {
        type: "boolean",
        description: "Required true to delete a non-empty directory.",
      },
    },
    required: ["path"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const rel = requireString(args, "path");
    const recursive = args.recursive === true;
    const uri = await ctx.resolvePath(rel);

    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      throw new ToolError(`Path does not exist: ${ctx.toRelative(uri)}`);
    }
    const isDir = (stat.type & vscode.FileType.Directory) !== 0;

    const relPath = ctx.toRelative(uri);
    const approved = await ctx.confirm(
      `Delete ${isDir ? "directory" : "file"} "${relPath}"?`,
      "This action cannot be easily undone.",
    );
    if (!approved) {
      throw new ToolDeniedError(`Deletion of "${relPath}" was declined by the user.`);
    }

    await vscode.workspace.fs.delete(uri, {
      recursive: isDir ? recursive || true : false,
      useTrash: true,
    });
    return {
      content: `Deleted ${relPath}.`,
      summary: `Deleted ${relPath}`,
    };
  },
};
