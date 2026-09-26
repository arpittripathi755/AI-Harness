import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolError } from "../types";
import { applyEdits, parseEditOp, readForEdit, writeText } from "../editCore";

/**
 * Apply a batch of edits across one or more files. Edits for each file are
 * validated and applied in-memory first; a file is only written if all of its
 * edits succeed (atomic per file). If any file fails, no partial write happens
 * for that file, and the error is reported so the model can retry.
 */
export const multiEditTool: Tool = {
  name: "multi_edit",
  mutates: true,
  description:
    "Apply multiple edits across one or more files in a single call. Each entry " +
    "targets a file and a list of exact find/replace edits. Edits within a file " +
    "are applied in order and atomically (all-or-nothing per file). Prefer this " +
    "for coordinated changes spanning several files.",
  parameters: {
    type: "object",
    properties: {
      files: {
        type: "array",
        description: "List of per-file edit groups.",
        items: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path relative to the workspace root.",
            },
            edits: {
              type: "array",
              description: "Ordered find/replace edits for this file.",
              items: {
                type: "object",
                properties: {
                  old_string: { type: "string", description: "Exact text to replace." },
                  new_string: { type: "string", description: "Replacement text." },
                  replace_all: {
                    type: "boolean",
                    description: "Replace all occurrences.",
                  },
                },
                required: ["old_string", "new_string"],
              },
            },
          },
          required: ["path", "edits"],
        },
      },
    },
    required: ["files"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const files = args.files;
    if (!Array.isArray(files) || files.length === 0) {
      throw new ToolError("multi_edit requires a non-empty 'files' array.");
    }

    const applied: string[] = [];
    const errors: string[] = [];

    for (const entry of files) {
      if (!entry || typeof entry !== "object") {
        errors.push("Skipped an invalid file entry (not an object).");
        continue;
      }
      const rec = entry as Record<string, unknown>;
      const path = rec.path;
      const rawEdits = rec.edits;
      if (typeof path !== "string" || !path) {
        errors.push("Skipped a file entry with a missing 'path'.");
        continue;
      }
      if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
        errors.push(`${path}: no edits provided.`);
        continue;
      }

      try {
        const uri = await ctx.resolvePath(path);
        const relPath = ctx.toRelative(uri);
        const ops = rawEdits.map(parseEditOp);
        const source = ctx.changeManager
          ? await ctx.changeManager.readEffective(relPath)
          : await readForEdit(uri);
        const outcome = applyEdits(source, ops, relPath);
        if (!outcome.ok) {
          errors.push(`${relPath}: [${outcome.errorType}] ${outcome.message}`);
          continue;
        }
        if (ctx.changeManager) {
          ctx.changeManager.stageEdit(relPath, outcome.content);
        } else {
          await writeText(uri, outcome.content);
        }
        applied.push(`${relPath} (${outcome.replacements} change${outcome.replacements === 1 ? "" : "s"})`);
      } catch (err) {
        errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const isError = applied.length === 0;
    const parts: string[] = [];
    if (applied.length) {
      parts.push(`Applied edits to ${applied.length} file(s):\n- ${applied.join("\n- ")}`);
    }
    if (errors.length) {
      parts.push(`Failures:\n- ${errors.join("\n- ")}`);
    }
    return {
      content: parts.join("\n\n"),
      isError,
      summary: `${applied.length} file(s) edited${errors.length ? `, ${errors.length} failed` : ""}`,
    };
  },
};
