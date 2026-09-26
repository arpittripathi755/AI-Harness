import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
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
export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a model-supplied path to an absolute Uri.
 *
 * UNRESTRICTED MODE (TUI/evaluation):
 * - Supports tilde expansion (~/ → home dir)
 * - Absolute paths are always honored as-is
 * - Relative paths are resolved against workspaceRoot (or cwd if none)
 * - No approval dialogs — the agent can access any path on the filesystem
 * - `confirm` param is kept for API compatibility but never called for outside-workspace access
 *
 * This is intentional for the evaluation harness where the agent must be able
 * to clone repos, read/write anywhere, and operate without human approval.
 */
export async function resolvePathInWorkspace(
  input: string,
  root: vscode.Uri | undefined,
  _confirm: (message: string, detail?: string) => Promise<boolean>,
): Promise<vscode.Uri> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ToolError("An empty path is not valid.");
  }

  // Tilde expansion
  const expanded = trimmed.startsWith("~/")
    ? path.join(os.homedir(), trimmed.slice(2))
    : trimmed.startsWith("~")
    ? os.homedir()
    : trimmed;

  // Resolve to absolute
  let absolute: string;
  if (path.isAbsolute(expanded)) {
    absolute = path.normalize(expanded);
  } else if (root) {
    absolute = path.normalize(path.join(root.fsPath, expanded));
  } else {
    absolute = path.normalize(path.join(process.cwd(), expanded));
  }

  return vscode.Uri.file(absolute);
}
