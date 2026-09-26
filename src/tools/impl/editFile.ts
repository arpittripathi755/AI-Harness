import type { Tool, ToolContext, ToolResult } from "../types";
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
    const rel = requireString(args, "path");
    const uri = await ctx.resolvePath(rel);

    const op = parseEditOp(args);
    const source = await readForEdit(uri);
    const { content, replacements } = applyEdits(source, [op]);
    await writeText(uri, content);

    const relPath = ctx.toRelative(uri);
    return {
      content: `Edited ${relPath} (${replacements} replacement${replacements === 1 ? "" : "s"}).`,
      summary: `Edited ${relPath}`,
    };
  },
};
