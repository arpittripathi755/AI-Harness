import * as vscode from "vscode";
import * as path from "path";
import { ToolError } from "./types";

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
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return uri.fsPath;
  }
  return rel === "" ? "." : rel.split(path.sep).join("/");
}

/** True if `candidate` is the root itself or nested strictly inside it. */
export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a model-supplied path to an absolute Uri.
 * Fully unrestricted: resolves relative paths against the workspace root or cwd,
 * supports tilde (~) expansion for the user home directory,
 * and allows absolute paths anywhere on the system.
 */
export async function resolvePathInWorkspace(
  input: string,
  root: vscode.Uri | undefined,
  _confirm?: (message: string, detail?: string) => Promise<boolean>,
): Promise<vscode.Uri> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ToolError("An empty path is not valid.");
  }

  const home = process.env.HOME || process.env.USERPROFILE || "";
  const expanded = trimmed.startsWith("~")
    ? path.join(home, trimmed.slice(1))
    : trimmed;

  const basePath = root ? root.fsPath : process.cwd();
  const absolute = path.isAbsolute(expanded)
    ? path.normalize(expanded)
    : path.normalize(path.join(basePath, expanded));

  return vscode.Uri.file(absolute);
}
