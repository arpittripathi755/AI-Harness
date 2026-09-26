import * as vscode from "vscode";
import type { Tool, ToolContext, ToolResult } from "../types";

export const readSelectionTool: Tool = {
  name: "read_selection",
  description:
    "Read the text the user has currently selected in the active editor, with its " +
    "file path and line range. Use this when the user refers to 'the selected " +
    "code' or 'this snippet'.",
  parameters: { type: "object", properties: {} },

  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return { content: "There is no active editor.", summary: "No active editor" };
    }
    const { document, selection } = editor;
    if (selection.isEmpty) {
      return {
        content: "No text is selected in the active editor.",
        summary: "No selection",
      };
    }
    const rel = ctx.toRelative(document.uri);
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;
    const text = document.getText(selection);
    return {
      content: `${rel} (lines ${startLine}-${endLine})\n${text}`,
      summary: `Read selection: ${rel} (lines ${startLine}-${endLine})`,
    };
  },
};
