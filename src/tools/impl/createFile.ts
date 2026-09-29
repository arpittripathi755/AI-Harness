import * as vscode from "vscode";
import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolError } from "../types";
import { encode, requireString } from "../fsutil";

export const createFileTool: Tool = {
  name: "create_file",
  mutates: true,
  description:
    "Create a new file in the workspace with the given contents. Fails if the file " +
    "already exists unless overwrite is true. Parent directories are created " +
    "automatically. Use edit_file to modify existing files.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the workspace root.",
      },
      content: {
        type: "string",
        description: "Full text content of the new file.",
      },
      overwrite: {
        type: "boolean",
        description: "Overwrite if the file already exists. Default false.",
      },
    },
    required: ["path", "content"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (ctx.signal?.aborted) {
      throw new ToolError("Operation cancelled.");
    }
    const rel = requireString(args, "path");
    const content = typeof args.content === "string" ? args.content : "";
    const overwrite = args.overwrite === true;
    const uri = await ctx.resolvePath(rel);

    const relPath = ctx.toRelative(uri);

    let exists = false;
    if (ctx.changeManager) {
      exists = await ctx.changeManager.fileExists(relPath);
    } else {
      try {
        await vscode.workspace.fs.stat(uri);
        exists = true;
      } catch {
        exists = false;
      }
    }
    if (exists && !overwrite) {
      throw new ToolError(
        `File already exists: ${relPath}. Pass overwrite:true or use edit_file.`,
      );
    }
    if (ctx.changeManager) {
      ctx.changeManager.stageCreate(relPath, content);
    } else {
      await vscode.workspace.fs.writeFile(uri, encode(content));
    }
    return {
      content: `${exists ? "Overwrote" : "Created"} ${relPath} (${content.split("\n").length} lines).`,
      summary: `${exists ? "Overwrote" : "Created"} ${relPath}`,
    };
  },
};
