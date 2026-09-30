import * as vscode from "vscode";
import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolError } from "../types";
import { requireString } from "../fsutil";
import { applyEdits, parseEditOp, readForEdit, writeText } from "../editCore";

export const editFileTool: Tool = {
  name: "edit_file",
  mutates: true,
  description:
    "Edit an existing file by replacing an exact snippet of text. old_string must " +
    "match the file exactly (including indentation) and be unique unless " +
    "replace_all is true. For several changes to one file, pass multiple edits.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the workspace root.",
      },
      old_string: {
        type: "string",
        description: "Exact text to replace. Include enough context to be unique.",
      },
      new_string: {
        type: "string",
        description: "Replacement text.",
      },
      replace_all: {
        type: "boolean",
        description: "Replace every occurrence instead of requiring uniqueness.",
      },
    },
    required: ["path", "old_string", "new_string"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (ctx.signal?.aborted) {
      throw new ToolError("Operation cancelled.");
    }
    let rel: string;
    try {
      rel = requireString(args, "path");
    } catch (err: any) {
      return {
        isError: true,
        content: JSON.stringify(
          {
            ok: false,
            errorType: "INVALID_ARGUMENT",
            message: err.message || "Missing required string argument 'path'.",
          },
          null,
          2,
        ),
        summary: "Invalid path argument",
      };
    }

    let uri: vscode.Uri;
    try {
      uri = await ctx.resolvePath(rel);
    } catch (err: any) {
      return {
        isError: true,
        content: JSON.stringify(
          {
            ok: false,
            errorType: "INVALID_PATH",
            filePath: rel,
            message: err.message || `Cannot resolve path "${rel}".`,
          },
          null,
          2,
        ),
        summary: `Invalid path: ${rel}`,
      };
    }

    const relPath = ctx.toRelative(uri);

    let op;
    try {
      if (Array.isArray(args.edits) && args.edits.length > 0) {
        op = parseEditOp(args.edits[0]);
      } else {
        op = parseEditOp(args);
      }
    } catch (err: any) {
      return {
        isError: true,
        content: JSON.stringify(
          {
            ok: false,
            errorType: "INVALID_ARGUMENT",
            filePath: relPath,
            message: err.message || "Invalid edit operations.",
          },
          null,
          2,
        ),
        summary: `Invalid edit arguments for ${relPath}`,
      };
    }

    let source: string;
    try {
      source = ctx.changeManager
        ? await ctx.changeManager.readEffective(relPath)
        : await readForEdit(uri);
    } catch (err: any) {
      return {
        isError: true,
        content: JSON.stringify(
          {
            ok: false,
            errorType: "FILE_NOT_FOUND",
            filePath: relPath,
            message: `File not found or unreadable: ${relPath}`,
          },
          null,
          2,
        ),
        summary: `File not found: ${relPath}`,
      };
    }

    const outcome = applyEdits(source, [op], relPath);
    if (!outcome.ok) {
      return {
        isError: true,
        content: JSON.stringify(outcome, null, 2),
        summary: `Edit failed (${outcome.errorType}): ${relPath}`,
      };
    }

    if (ctx.changeManager) {
      ctx.changeManager.stageEdit(relPath, outcome.content);
    } else {
      await writeText(uri, outcome.content);
    }

    return {
      content: `Edited ${relPath} (${outcome.replacements} replacement${outcome.replacements === 1 ? "" : "s"}).`,
      summary: `Edited ${relPath}`,
    };
  },
};
