import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
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

/** Resolve symlinks if path exists, or walk ancestors to resolve real root. */
function resolveRealPath(p: string): string {
  const abs = path.resolve(p);
  let cur = abs;
  const parts: string[] = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) {
      break;
    }
    parts.unshift(path.basename(cur));
    cur = parent;
  }
  try {
    const realCur = fs.realpathSync(cur);
    return parts.length > 0 ? path.join(realCur, ...parts) : realCur;
  } catch {
    return abs;
  }
}

/** True if `candidate` is the root itself or nested strictly inside it. */
export function isInside(root: string, candidate: string): boolean {
  const realRoot = resolveRealPath(root);
  const realCandidate = resolveRealPath(candidate);
  const rel = path.relative(realRoot, realCandidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a model-supplied path to an absolute Uri, confined to the workspace.
 *
 * - No workspace open → hard error (nothing is in scope).
 * - Resolves relative paths against the workspace root.
 * - Enforces strict containment: escaping paths (including via symlinks or ../)
 *   are rejected with ToolError.
 */
export async function resolvePathInWorkspace(
  input: string,
  root: vscode.Uri | undefined,
  confirm?: (message: string, detail?: string) => Promise<boolean>,
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

  const normalized = path.normalize(trimmed);
  const absolute = path.isAbsolute(normalized)
    ? normalized
    : path.normalize(path.join(root.fsPath, normalized));

  if (!isInside(root.fsPath, absolute)) {
    throw new ToolError(
      `Access denied: "${trimmed}" resolves outside the workspace root (${root.fsPath}).`,
    );
  }

  return vscode.Uri.file(absolute);
}
