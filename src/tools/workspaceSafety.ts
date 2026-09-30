import * as path from "path";
import * as os from "os";

let broadWorkspaceWarned = false;

/**
 * Returns true if the path is considered "too broad" (home, Desktop, Documents, Downloads, root).
 */
export function isBroadWorkspace(workspacePath?: string): boolean {
  if (!workspacePath) {
    return false;
  }
  const norm = path.resolve(workspacePath);
  const home = os.homedir();
  const broad = [
    path.resolve(home),
    path.resolve(home, "Desktop"),
    path.resolve(home, "Documents"),
    path.resolve(home, "Downloads"),
    path.resolve("/"),
  ];
  return broad.some((b) => b === norm);
}

/**
 * Emits a one-time warning if the active workspace is a broad location.
 * Does not block usage.
 */
export function checkBroadWorkspaceWarning(
  workspacePath?: string,
  logger?: (msg: string) => void,
): string | null {
  if (broadWorkspaceWarned || !workspacePath) {
    return null;
  }
  if (isBroadWorkspace(workspacePath)) {
    broadWorkspaceWarned = true;
    const msg = `Workspace is very broad (${workspacePath}). Searches will be limited. Consider running from a specific project folder.`;
    if (logger) {
      logger(msg);
    } else {
      console.warn(`[WARN] ${msg}`);
    }
    return msg;
  }
  return null;
}

/** Reset warning state (used in tests). */
export function resetBroadWorkspaceWarning(): void {
  broadWorkspaceWarned = false;
}
