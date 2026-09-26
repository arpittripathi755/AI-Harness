import * as vscode from "vscode";
import type { Tool, ToolContext, ToolResult } from "../types";
import { numberLines } from "../fsutil";

export const readActiveEditorTool: Tool = {
  name: "read_active_editor",
  description:
    "Read the file currently open and focused in the editor, including its path " +
    "and full contents with line numbers. Use this when the user refers to " +
    "'this file' or 'the file I'm looking at'.",
  parameters: { type: "object", properties: {} },

  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return {
        content: "There is no active editor.",
        summary: "No active editor",
      };
    }
    const doc = editor.document;
    const rel = ctx.toRelative(doc.uri);
    const text = doc.getText();
    return {
      content: `${rel} (${doc.lineCount} lines, language: ${doc.languageId})\n${numberLines(text)}`,
      summary: `Read active editor: ${rel}`,
    };
  },
};
