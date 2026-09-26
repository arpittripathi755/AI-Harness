import * as vscode from "vscode";
import * as path from "path";
import { ToolDeniedError, ToolError } from "./types";

/** The first open workspace folder, or undefined if none is open. */
export function getWorkspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/** Path of `uri` relative to `root`, using forward slashes for display. */
export function toRelative(root: vscode.Uri | undefined, uri: vscode.Uri): string {
  if (!root) {
    return uri.fsPath;
  }
  const rel = path.relative(root.fsPath, uri.fsPath);
  return rel === "" ? "." : rel.split(path.sep).join("/");
}

/** True if `candidate` is the root itself or nested strictly inside it. */
function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a model-supplied path to an absolute Uri, confined to the workspace.
 *
 * - No workspace open → hard error (nothing is in scope).
 * - Resolves relative paths against the workspace root; absolute paths are honored.
 * - If the result escapes the workspace root, require an explicit modal approval;
 *   denial throws {@link ToolDeniedError}. This is the single choke point that
 *   enforces "never access files outside the workspace unless I approve it".
 */
export async function resolvePathInWorkspace(
  input: string,
  root: vscode.Uri | undefined,
  confirm: (message: string, detail?: string) => Promise<boolean>,
): Promise<vscode.Uri> {
  if (!root) {
    throw new ToolError(
      "No workspace folder is open, so there is no project to operate on.",
    );
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new ToolError("An empty path is not valid.");
  }

  const absolute = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.normalize(path.join(root.fsPath, trimmed));

  if (!isInside(root.fsPath, absolute)) {
    const approved = await confirm(
      "Allow access outside the workspace?",
      `The agent wants to access:\n${absolute}\n\nThis is outside the current workspace root:\n${root.fsPath}`,
    );
    if (!approved) {
      throw new ToolDeniedError(
        `Access denied: "${trimmed}" is outside the workspace and approval was declined.`,
      );
    }
  }

  return vscode.Uri.file(absolute);
}
