import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execSync } from "child_process";

/**
 * Manages isolated workspace directories on the user's Desktop.
 * Each cloned repository gets its own persistent folder at:
 *   ~/Desktop/<repo-name>/
 *
 * If that folder already exists, a suffix is appended (_1, _2, …) to avoid
 * silently overwriting existing work.
 */
export class WorkspaceIsolation {
  private static readonly DESKTOP = path.join(os.homedir(), "Desktop");

  /**
   * Returns the default workspace directory (~/Desktop).
   * Ensures the directory exists if possible, falling back to homedir if needed.
   * Never hardcodes usernames; dynamically resolves using os.homedir().
   */
  static getDefaultWorkspace(): string {
    const desktop = this.DESKTOP;
    try {
      if (!fs.existsSync(desktop)) {
        fs.mkdirSync(desktop, { recursive: true });
      }
      return desktop;
    } catch {
      return os.homedir();
    }
  }

  /**
   * Returns the path to an existing or freshly-cloned repository workspace
   * on the Desktop. Never mutates an existing folder; always picks a clean slot.
   */
  static resolveWorkspace(repoUrl: string): { workspacePath: string; existed: boolean } {
    const repoName = this.extractRepoName(repoUrl);
    const base = path.join(this.DESKTOP, repoName);

    if (!fs.existsSync(base)) {
      return { workspacePath: base, existed: false };
    }

    // Repo already cloned — return it as-is if it looks like a git repo
    const gitDir = path.join(base, ".git");
    if (fs.existsSync(gitDir)) {
      return { workspacePath: base, existed: true };
    }

    // Folder exists but isn't a git repo → find a free suffixed slot
    let i = 1;
    while (true) {
      const candidate = `${base}_${i}`;
      if (!fs.existsSync(candidate)) {
        return { workspacePath: candidate, existed: false };
      }
      i++;
    }
  }

  /**
   * Clone `repoUrl` into `workspacePath`. Throws if git fails.
   */
  static cloneRepository(repoUrl: string, workspacePath: string): void {
    const parent = path.dirname(workspacePath);
    const folderName = path.basename(workspacePath);

    fs.mkdirSync(parent, { recursive: true });

    execSync(`git clone "${repoUrl}" "${folderName}"`, {
      cwd: parent,
      stdio: "inherit",
      timeout: 120_000,
    });
  }

  /**
   * Derive a safe filesystem folder name from a GitHub URL or bare repo name.
   * e.g. "https://github.com/user/my-repo.git" → "my-repo"
   */
  static extractRepoName(repoUrl: string): string {
    // Handle full URLs
    try {
      const u = new URL(repoUrl);
      const parts = u.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
      if (parts.length > 0) {
        return sanitizeName(parts[parts.length - 1]);
      }
    } catch {
      // Not a URL — treat as a raw name
    }

    // Handle git@github.com:user/repo.git style
    const sshMatch = repoUrl.match(/[:/]([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return sanitizeName(sshMatch[1]);
    }

    return sanitizeName(repoUrl.replace(/\.git$/, "").replace(/.*[/\\]/, ""));
  }

  /**
   * Returns true if `dir` is a valid git repository root.
   */
  static isGitRepo(dir: string): boolean {
    return fs.existsSync(path.join(dir, ".git"));
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "repo";
}
