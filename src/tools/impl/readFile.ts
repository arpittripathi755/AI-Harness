import type { Tool, ToolContext, ToolResult } from "../types";
import { numberLines, optionalNumber, readText, requireString } from "../fsutil";

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "Read a text file from the workspace. Returns the content with line numbers " +
    "so you can reference exact lines when editing. Optionally read a line range.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the workspace root.",
      },
      start_line: {
        type: "integer",
        description: "1-based first line to return (optional).",
      },
      end_line: {
        type: "integer",
        description: "1-based last line to return, inclusive (optional).",
      },
    },
    required: ["path"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const rel = requireString(args, "path");
    const uri = await ctx.resolvePath(rel);
    const relPath = ctx.toRelative(uri);
    const text = ctx.changeManager
      ? await ctx.changeManager.readEffective(relPath)
      : await readText(uri);
    const allLines = text.split("\n");

    const isExplicitRange = args.start_line !== undefined || args.end_line !== undefined;
    const maxUnranged = parseInt(process.env.MAX_READ_FILE_LINES || "250", 10);
    if (!isExplicitRange && allLines.length > maxUnranged) {
      const headCount = 160;
      const tailCount = 40;
      const omitted = allLines.length - headCount - tailCount;
      const headSlice = allLines.slice(0, headCount);
      const tailSlice = allLines.slice(allLines.length - tailCount);
      const numberedHead = numberLines(headSlice.join("\n"), 1);
      const numberedTail = numberLines(tailSlice.join("\n"), allLines.length - tailCount + 1);
      const content = `${relPath} (total ${allLines.length} lines; showing lines 1-${headCount} and ${allLines.length - tailCount + 1}-${allLines.length})\n${numberedHead}\n... [${omitted} lines omitted; use start_line and end_line to inspect specific sections] ...\n${numberedTail}`;
      return {
        content,
        summary: `Read ${relPath} (sampled ${headCount + tailCount} of ${allLines.length} lines)`,
      };
    }

    const start = Math.max(1, optionalNumber(args, "start_line", 1));
    const end = Math.min(
      allLines.length,
      optionalNumber(args, "end_line", allLines.length),
    );
    const slice = allLines.slice(start - 1, end).join("\n");
    const numbered = numberLines(slice, start);

    const ranged = start > 1 || end < allLines.length;
    return {
      content: `${relPath} (lines ${start}-${end} of ${allLines.length})\n${numbered}`,
      summary: `Read ${relPath}${ranged ? ` (lines ${start}-${end})` : ` (${allLines.length} lines)`}`,
    };
  },
};
