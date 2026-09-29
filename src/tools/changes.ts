import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { decode, encode } from "./fsutil";

export type ChangeType = "create" | "edit" | "delete" | "rename";

export interface ChangeSetEntry {
  path: string;
  type: ChangeType;
  oldPath?: string;
  diff?: string;
  originalContent?: string;
  stagedContent?: string;
}

export interface JournalEntry {
  relPath: string;
  absPath: string;
  exists: boolean;
  originalContent?: string;
  originalMode?: number;
  writtenContent?: string;
  action: "create" | "edit" | "delete" | "rename";
}

export interface MaterializationJournal {
  id: string;
  timestamp: number;
  workspaceRoot: string;
  entries: JournalEntry[];
}

/**
 * Recognizes standard test, build, lint, and verification commands.
 */
export function isVerificationCommand(cmd: string, repoTestCmd?: string): boolean {
  if (!cmd || typeof cmd !== "string") {
    return false;
  }
  const trimmed = cmd.trim();
  if (repoTestCmd && trimmed.includes(repoTestCmd)) {
    return true;
  }
  return /\b(npm\s+(?:run\s+)?(?:test|build|lint)|tsc|jest|vitest|pytest|cargo\s+test|go\s+test|yarn\s+(?:run\s+)?(?:test|build|lint)|pnpm\s+(?:run\s+)?(?:test|build|lint)|bun\s+(?:run\s+)?(?:test|build|lint)|make\s+test)\b/i.test(
    trimmed,
  );
}

/**
 * Authoritative in-memory staging overlay for all file mutations.
 *
 * All mutation tools stage their operations in ChangeManager first.
 * Read tools inspect the effective virtual overlay, seeing pending edits.
 * Physical disk writes occur strictly when the ChangeSet is accepted and applied.
 */
export class ChangeManager {
  private static materializationMutex: Promise<void> = Promise.resolve();

  private readonly staged = new Map<string, string>(); // relPath -> content
  private readonly originals = new Map<string, string>(); // relPath -> original text
  private readonly created = new Set<string>(); // relPath
  private readonly deleted = new Set<string>(); // relPath
  private readonly renames = new Map<string, string>(); // oldRelPath -> newRelPath

  private readonly workspaceRoot?: vscode.Uri;

  constructor(workspaceRoot?: vscode.Uri | string) {
    if (typeof workspaceRoot === "string") {
      this.workspaceRoot = vscode.Uri.file(workspaceRoot);
    } else {
      this.workspaceRoot = workspaceRoot;
    }
    this.recoverStaleJournals();
  }

  getWorkspaceFsPath(): string {
    return this.workspaceRoot ? path.resolve(this.workspaceRoot.fsPath) : process.cwd();
  }

  private normalize(filePath: string): string {
    const s = filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    return s === "." ? "" : s;
  }

  private resolveUri(relPath: string): vscode.Uri {
    if (this.workspaceRoot) {
      return vscode.Uri.joinPath(this.workspaceRoot, relPath);
    }
    return vscode.Uri.file(path.resolve(relPath));
  }

  /**
   * Get all paths currently staged for creation (excluding those later deleted).
   */
  getCreatedPaths(): string[] {
    return Array.from(this.created).filter((p) => !this.deleted.has(p));
  }

  /**
   * Get all paths currently staged for deletion.
   */
  getDeletedPaths(): string[] {
    return Array.from(this.deleted);
  }

  /**
   * Get map of oldPath -> newPath for currently staged renames.
   */
  getRenamedPaths(): Map<string, string> {
    return new Map(this.renames);
  }

  /**
   * Authoritative overlay method: takes a list of physical relative paths
   * and returns the effective relative paths by adding staged creations/renames
   * and removing staged deletions/old rename paths.
   */
  getEffectivePaths(physicalPaths: string[] = []): string[] {
    const set = new Set<string>();

    for (const p of physicalPaths) {
      const norm = this.normalize(p);
      if (!norm || this.deleted.has(norm) || this.renames.has(norm)) {
        continue;
      }
      set.add(norm);
    }

    for (const p of this.created) {
      if (!this.deleted.has(p)) {
        set.add(this.normalize(p));
      }
    }

    for (const [oldRel, newRel] of this.renames.entries()) {
      if (!this.deleted.has(newRel)) {
        set.add(this.normalize(newRel));
      }
    }

    for (const p of this.staged.keys()) {
      if (!this.deleted.has(p)) {
        set.add(this.normalize(p));
      }
    }

    return Array.from(set).sort();
  }

  /**
   * Directory overlay method:
   * Takes a relative directory path and physical [name, FileType] entries,
   * removes staged deletions/renames, and inserts staged creations/renames.
   */
  getEffectiveDirectoryEntries(
    dirRel: string,
    physicalEntries: [string, vscode.FileType][],
  ): [string, vscode.FileType][] {
    const normDir = this.normalize(dirRel);
    const prefix = normDir ? `${normDir}/` : "";

    const entryMap = new Map<string, vscode.FileType>();

    // 1. Add physical entries, excluding deleted or rename sources
    for (const [name, type] of physicalEntries) {
      const itemRel = normDir ? `${normDir}/${name}` : name;
      if (this.deleted.has(itemRel) || this.renames.has(itemRel)) {
        continue;
      }
      entryMap.set(name, type);
    }

    // 2. Overlay staged creations, renames, and edits
    const allStagedPaths = new Set<string>();
    for (const p of this.created) {
      allStagedPaths.add(p);
    }
    for (const newP of this.renames.values()) {
      allStagedPaths.add(newP);
    }
    for (const p of this.staged.keys()) {
      allStagedPaths.add(p);
    }

    for (const p of allStagedPaths) {
      if (this.deleted.has(p)) {
        continue;
      }
      if (normDir) {
        if (!p.startsWith(prefix)) {
          continue;
        }
        const relUnderDir = p.slice(prefix.length);
        const slashIdx = relUnderDir.indexOf("/");
        if (slashIdx === -1) {
          entryMap.set(relUnderDir, vscode.FileType.File);
        } else {
          const subDirName = relUnderDir.slice(0, slashIdx);
          if (!entryMap.has(subDirName)) {
            entryMap.set(subDirName, vscode.FileType.Directory);
          }
        }
      } else {
        const slashIdx = p.indexOf("/");
        if (slashIdx === -1) {
          entryMap.set(p, vscode.FileType.File);
        } else {
          const subDirName = p.slice(0, slashIdx);
          if (!entryMap.has(subDirName)) {
            entryMap.set(subDirName, vscode.FileType.Directory);
          }
        }
      }
    }

    const result: [string, vscode.FileType][] = Array.from(entryMap.entries());
    result.sort((a, b) => {
      const dirDiff =
        (b[1] & vscode.FileType.Directory) - (a[1] & vscode.FileType.Directory);
      return dirDiff !== 0 ? dirDiff : a[0].localeCompare(b[0]);
    });
    return result;
  }

  /**
   * Check whether a relative path or any of its parent directories is deleted in the staged overlay.
   */
  isDeleted(filePath: string): boolean {
    const rel = this.normalize(filePath);
    if (this.deleted.has(rel)) {
      return true;
    }
    for (const del of this.deleted) {
      if (rel.startsWith(`${del}/`)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check whether a file or directory effectively exists in the virtual overlay
   * or on physical disk (accounting for staged creations, edits, deletions, and renames).
   */
  async fileExists(filePath: string): Promise<boolean> {
    const rel = this.normalize(filePath);
    if (!rel) {
      return true; // Workspace root always exists
    }

    // If explicitly deleted in staged overlay, it does not exist
    if (this.isDeleted(rel)) {
      return false;
    }

    // If staged for creation or modification, it exists
    if (this.created.has(rel) || this.staged.has(rel)) {
      return true;
    }

    // If it was renamed to another path, the old path no longer exists
    if (this.renames.has(rel)) {
      return false;
    }

    // Check if it's a directory containing staged creations, edits, or renames
    const prefix = `${rel}/`;
    for (const p of this.created) {
      if (p.startsWith(prefix) && !this.isDeleted(p)) {
        return true;
      }
    }
    for (const p of this.staged.keys()) {
      if (p.startsWith(prefix) && !this.isDeleted(p)) {
        return true;
      }
    }
    for (const p of this.renames.values()) {
      if (p.startsWith(prefix) && !this.isDeleted(p)) {
        return true;
      }
    }

    // Check physical filesystem
    try {
      await vscode.workspace.fs.stat(this.resolveUri(rel));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read the effective content of a file: returns the staged virtual version
   * if modified/created, or reads from physical disk if not staged.
   */
  async readEffective(filePath: string): Promise<string> {
    const rel = this.normalize(filePath);

    if (this.isDeleted(rel)) {
      throw new Error(`File is deleted in staged changes: ${rel}`);
    }

    if (this.staged.has(rel)) {
      return this.staged.get(rel)!;
    }

    // Read from disk and cache original
    const uri = this.resolveUri(rel);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = decode(bytes);
    if (!this.originals.has(rel)) {
      this.originals.set(rel, text);
    }
    return text;
  }

  /**
   * Check if a specific file (or any file if no path given) has staged changes.
   */
  hasStaged(filePath?: string): boolean {
    if (filePath) {
      const rel = this.normalize(filePath);
      return (
        this.staged.has(rel) ||
        this.created.has(rel) ||
        this.deleted.has(rel) ||
        this.renames.has(rel)
      );
    }
    return (
      this.staged.size > 0 ||
      this.created.size > 0 ||
      this.deleted.size > 0 ||
      this.renames.size > 0
    );
  }

  /**
   * Stage an edit to an existing file.
   */
  stageEdit(filePath: string, newContent: string): void {
    const rel = this.normalize(filePath);
    if (this.isDeleted(rel)) {
      throw new Error(`Cannot edit deleted file: ${rel}`);
    }
    this.staged.set(rel, newContent);
  }

  /**
   * Stage the creation of a new file.
   */
  stageCreate(filePath: string, content: string): void {
    const rel = this.normalize(filePath);
    this.deleted.delete(rel);
    this.created.add(rel);
    this.staged.set(rel, content);
    if (!this.originals.has(rel)) {
      this.originals.set(rel, "");
    }
  }

  /**
   * Stage the deletion of a file or directory.
   */
  stageDelete(filePath: string): void {
    const rel = this.normalize(filePath);
    const wasCreated = this.created.has(rel);
    this.staged.delete(rel);
    this.created.delete(rel);

    // If it was created in this session and never existed physically on disk,
    // deleting it simply cancels the creation without staging a disk deletion.
    let physicallyExists = false;
    try {
      physicallyExists = fs.existsSync(this.resolveUri(rel).fsPath);
    } catch {
      physicallyExists = false;
    }

    if (physicallyExists || !wasCreated) {
      this.deleted.add(rel);
    } else {
      this.originals.delete(rel);
    }

    // If deleting a directory or path, clear any staged children under this path
    const prefix = `${rel}/`;
    for (const key of Array.from(this.staged.keys())) {
      if (key.startsWith(prefix)) {
        this.staged.delete(key);
      }
    }
    for (const key of Array.from(this.created)) {
      if (key.startsWith(prefix)) {
        this.created.delete(key);
      }
    }
  }

  /**
   * Stage renaming or moving a file.
   */
  async stageRename(oldPath: string, newPath: string): Promise<void> {
    const oldRel = this.normalize(oldPath);
    const newRel = this.normalize(newPath);
    const content = await this.readEffective(oldRel);

    this.stageDelete(oldRel);
    this.stageCreate(newRel, content);
    this.renames.set(oldRel, newRel);

    // If oldRel was itself the target of an earlier rename (A -> B, now B -> C),
    // update it so the original rename points directly to newRel (A -> C).
    for (const [orig, target] of this.renames.entries()) {
      if (target === oldRel && orig !== oldRel) {
        this.renames.set(orig, newRel);
        this.renames.delete(oldRel);
      }
    }
  }

  /**
   * Generate structured ChangeSet entries with unified diffs.
   */
  getChangeSet(): ChangeSetEntry[] {
    const entries: ChangeSetEntry[] = [];
    const renameTargets = new Set(this.renames.values());

    // Created files
    for (const rel of this.created) {
      if (this.deleted.has(rel) || renameTargets.has(rel)) {
        continue;
      }
      const stagedContent = this.staged.get(rel) ?? "";
      entries.push({
        path: rel,
        type: "create",
        originalContent: "",
        stagedContent,
        diff: formatUnifiedDiff(rel, "", stagedContent),
      });
    }

    // Edited files (excluding newly created)
    for (const [rel, stagedContent] of this.staged.entries()) {
      if (this.created.has(rel) || this.deleted.has(rel)) {
        continue;
      }
      let originalContent = this.originals.get(rel);
      if (originalContent === undefined) {
        try {
          const uri = this.resolveUri(rel);
          const bytes = fs.readFileSync(uri.fsPath);
          originalContent = decode(bytes);
          this.originals.set(rel, originalContent);
        } catch {
          originalContent = "";
        }
      }
      entries.push({
        path: rel,
        type: "edit",
        originalContent,
        stagedContent,
        diff: formatUnifiedDiff(rel, originalContent, stagedContent),
      });
    }

    // Deleted files (excluding renames and creations)
    for (const rel of this.deleted) {
      if (this.created.has(rel) || this.renames.has(rel)) {
        continue;
      }
      const originalContent = this.originals.get(rel) ?? "";
      entries.push({
        path: rel,
        type: "delete",
        originalContent,
        stagedContent: "",
        diff: formatUnifiedDiff(rel, originalContent, ""),
      });
    }

    // Renamed files
    for (const [oldRel, newRel] of this.renames.entries()) {
      const originalContent = this.originals.get(oldRel) ?? "";
      const stagedContent = this.staged.get(newRel) ?? "";
      entries.push({
        path: newRel,
        oldPath: oldRel,
        type: "rename",
        originalContent,
        stagedContent,
        diff: `rename from ${oldRel}\nrename to ${newRel}\n` +
          formatUnifiedDiff(newRel, originalContent, stagedContent),
      });
    }

    return entries;
  }

  /**
   * Atomically apply all staged changes to physical disk with transactional rollback.
   *
   * 1. Validate all paths (traversal / escaping workspace).
   * 2. Validate all stale hashes / external modifications.
   * 3. Capture snapshot of pre-apply disk state for all affected paths.
   * 4. Apply deletions, creations, and edits.
   * 5. If ANY write fails, rollback all changes to pre-apply state, preserve staged state,
   *    and throw a structured failure.
   */
  async applyChangeSet(): Promise<void> {
    const affected = new Set<string>();
    for (const rel of this.deleted) {
      affected.add(rel);
    }
    for (const rel of this.created) {
      affected.add(rel);
    }
    for (const rel of this.staged.keys()) {
      affected.add(rel);
    }
    for (const [oldRel, newRel] of this.renames.entries()) {
      affected.add(oldRel);
      affected.add(newRel);
    }

    if (affected.size === 0) {
      return;
    }

    interface FileSnapshot {
      relPath: string;
      uri: vscode.Uri;
      exists: boolean;
      content?: Uint8Array;
    }

    const snapshots: FileSnapshot[] = [];
    const rootPath = this.workspaceRoot ? path.resolve(this.workspaceRoot.fsPath) : undefined;

    for (const rel of affected) {
      const uri = this.resolveUri(rel);

      // 1. Path validation: ensure path does not escape workspace root
      if (rootPath) {
        const resolved = path.resolve(uri.fsPath);
        if (!resolved.startsWith(rootPath + path.sep) && resolved !== rootPath) {
          throw new Error(`Invalid path: "${rel}" traverses outside workspace.`);
        }
      }

      // Check physical existence and capture content
      let exists = false;
      let content: Uint8Array | undefined;
      try {
        content = await vscode.workspace.fs.readFile(uri);
        exists = true;
      } catch {
        exists = false;
      }

      // 2. Validate stale state if original was cached (and not newly created)
      if (this.originals.has(rel) && !this.created.has(rel) && exists && content) {
        const diskText = decode(content);
        const recordedOrig = this.originals.get(rel)!;
        if (diskText !== recordedOrig) {
          throw new Error(
            `Stale file detected: "${rel}" was modified externally since it was staged.`,
          );
        }
      }

      snapshots.push({ relPath: rel, uri, exists, content });
    }

    // Step 4: Apply changes with rollback tracking
    const appliedSnapshots: FileSnapshot[] = [];

    try {
      // 4a. Process deletions
      for (const rel of this.deleted) {
        const snap = snapshots.find((s) => s.relPath === rel);
        if (snap && snap.exists) {
          appliedSnapshots.push(snap);
          await vscode.workspace.fs.delete(snap.uri, { recursive: true, useTrash: false });
        }
      }

      // 4b. Process creates and edits
      for (const [rel, newContent] of this.staged.entries()) {
        if (this.deleted.has(rel)) {
          continue;
        }
        const snap = snapshots.find((s) => s.relPath === rel);
        if (snap) {
          appliedSnapshots.push(snap);
        }
        const uri = this.resolveUri(rel);
        await vscode.workspace.fs.writeFile(uri, encode(newContent));
      }

      // If we reach here, all writes succeeded! Clear staged state.
      this.clear();
    } catch (applyErr: any) {
      // Step 5: Rollback on any failure
      const rollbackErrors: string[] = [];

      // Rollback applied changes in reverse order
      for (let i = appliedSnapshots.length - 1; i >= 0; i--) {
        const snap = appliedSnapshots[i];
        try {
          if (snap.exists && snap.content) {
            // Restore original content
            await vscode.workspace.fs.writeFile(snap.uri, snap.content);
          } else if (!snap.exists) {
            // File was created in this run; remove it
            try {
              await vscode.workspace.fs.delete(snap.uri, { recursive: false, useTrash: false });
            } catch (delErr: any) {
              // Ignore if already deleted or doesn't exist
            }
          }
        } catch (rbErr: any) {
          rollbackErrors.push(`Failed to rollback ${snap.relPath}: ${rbErr.message || String(rbErr)}`);
        }
      }

      // Preserve ChangeManager staged state: DO NOT call this.clear()!
      const errorMsg =
        `ChangeSet application failed: ${applyErr.message || String(applyErr)}.` +
        (rollbackErrors.length > 0
          ? ` Rollback encountered errors: ${rollbackErrors.join("; ")}`
          : " All changes safely rolled back to pre-apply state.");

      const structuredErr: any = new Error(errorMsg);
      structuredErr.originalError = applyErr;
      structuredErr.rollbackErrors = rollbackErrors;
      structuredErr.code = "CHANGESET_APPLY_FAILED";
      throw structuredErr;
    }
  }

  /**
   * Reject all staged changes: clears overlay with zero disk modifications.
   */
  rejectAll(): void {
    this.clear();
  }

  /**
   * Clear all staged and cached state.
   */
  clear(): void {
    this.staged.clear();
    this.originals.clear();
    this.created.clear();
    this.deleted.clear();
    this.renames.clear();
  }

  /**
   * Crash recovery: on first use or recovery check, detect stale materialization journals,
   * restore recorded original state, and remove the journal.
   */
  recoverStaleJournals(): void {
    try {
      const rootPath = this.getWorkspaceFsPath();
      const journalDir = path.join(rootPath, ".daxiom", "journal");
      if (!fs.existsSync(journalDir)) {
        return;
      }
      const files = fs.readdirSync(journalDir);
      for (const file of files) {
        if (!file.endsWith(".json")) {
          continue;
        }
        const journalPath = path.join(journalDir, file);
        try {
          const raw = fs.readFileSync(journalPath, "utf-8");
          const journal = JSON.parse(raw) as MaterializationJournal;
          if (journal && Array.isArray(journal.entries)) {
            for (let i = journal.entries.length - 1; i >= 0; i--) {
              const entry = journal.entries[i];
              if (!entry.exists) {
                if (fs.existsSync(entry.absPath)) {
                  fs.unlinkSync(entry.absPath);
                }
                this.cleanEmptyParents(path.dirname(entry.absPath), journal.workspaceRoot);
              } else if (entry.originalContent !== undefined) {
                fs.mkdirSync(path.dirname(entry.absPath), { recursive: true });
                fs.writeFileSync(entry.absPath, entry.originalContent, "utf-8");
                if (entry.originalMode !== undefined) {
                  try {
                    fs.chmodSync(entry.absPath, entry.originalMode);
                  } catch {}
                }
              }
            }
          }
          fs.unlinkSync(journalPath);
          if (process.env.DEBUG_TOKEN_BUDGET === "1") {
            console.log(`[ChangeManager] Crash recovery: restored state from stale journal ${file}`);
          }
        } catch {
          // If a journal is corrupt, fail open
          try {
            fs.unlinkSync(journalPath);
          } catch {}
        }
      }
    } catch {
      // Fail open
    }
  }

  /**
   * Execute an operation against a temporary physical materialization of staged edits.
   * Serialized with a mutex. Restores original disk state in finally block.
   */
  async withMaterialized<T>(fn: () => Promise<T>): Promise<T> {
    const isFlagOn = process.env.DAXIOM_STAGED_DISK_SYNC === "1";
    if (!isFlagOn || !this.hasStaged()) {
      return await fn();
    }

    const previousLock = ChangeManager.materializationMutex;
    let releaseLock: () => void;
    ChangeManager.materializationMutex = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    await previousLock;
    try {
      return await this.performMaterialized(fn);
    } finally {
      releaseLock!();
    }
  }

  private async performMaterialized<T>(fn: () => Promise<T>): Promise<T> {
    const rootPath = this.getWorkspaceFsPath();
    const affected = new Set<string>();
    for (const rel of this.deleted) affected.add(rel);
    for (const rel of this.created) affected.add(rel);
    for (const rel of this.staged.keys()) affected.add(rel);
    for (const [oldRel, newRel] of this.renames.entries()) {
      affected.add(oldRel);
      affected.add(newRel);
    }

    // Safety check: verify affected files have not been externally modified since staged
    for (const rel of affected) {
      if (this.originals.has(rel) && !this.created.has(rel)) {
        const absPath = this.resolveUri(rel).fsPath;
        if (fs.existsSync(absPath)) {
          const currentDisk = fs.readFileSync(absPath, "utf-8");
          const expectedOrig = this.originals.get(rel)!;
          if (currentDisk !== expectedOrig) {
            console.warn(
              `[ChangeManager] Unsafe external modification detected on "${rel}". Aborting materialization to prevent overwrite.`,
            );
            return await fn(); // Fail open: do not overwrite
          }
        }
      }
    }

    const journalDir = path.join(rootPath, ".daxiom", "journal");
    fs.mkdirSync(journalDir, { recursive: true });
    const journalId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const journalFile = path.join(journalDir, `${journalId}.json`);

    const entries: JournalEntry[] = [];

    // Capture pre-materialization snapshot for journal
    for (const rel of affected) {
      const absPath = this.resolveUri(rel).fsPath;
      const exists = fs.existsSync(absPath);
      let originalContent: string | undefined;
      let originalMode: number | undefined;

      if (exists) {
        originalContent = fs.readFileSync(absPath, "utf-8");
        try {
          originalMode = fs.statSync(absPath).mode;
        } catch {}
      }

      let action: "create" | "edit" | "delete" | "rename" = "edit";
      let writtenContent: string | undefined;

      if (this.deleted.has(rel)) {
        action = "delete";
      } else if (this.created.has(rel)) {
        action = "create";
        writtenContent = this.staged.get(rel) ?? "";
      } else if (this.renames.has(rel)) {
        action = "rename";
      } else if (Array.from(this.renames.values()).includes(rel)) {
        action = "rename";
        writtenContent = this.staged.get(rel) ?? "";
      } else if (this.staged.has(rel)) {
        action = "edit";
        writtenContent = this.staged.get(rel)!;
      }

      entries.push({
        relPath: rel,
        absPath,
        exists,
        originalContent,
        originalMode,
        writtenContent,
        action,
      });
    }

    const journalData: MaterializationJournal = {
      id: journalId,
      timestamp: Date.now(),
      workspaceRoot: rootPath,
      entries,
    };

    fs.writeFileSync(journalFile, JSON.stringify(journalData, null, 2), "utf-8");

    // Apply materialization to disk
    try {
      // 1. Deletions (and rename old paths)
      for (const rel of this.deleted) {
        const absPath = this.resolveUri(rel).fsPath;
        if (fs.existsSync(absPath)) {
          fs.unlinkSync(absPath);
        }
      }
      for (const oldRel of this.renames.keys()) {
        const absPath = this.resolveUri(oldRel).fsPath;
        if (fs.existsSync(absPath)) {
          fs.unlinkSync(absPath);
        }
      }

      // 2. Creates, edits, rename new paths
      for (const [rel, content] of this.staged.entries()) {
        if (this.deleted.has(rel)) continue;
        const absPath = this.resolveUri(rel).fsPath;
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, content, "utf-8");
      }
    } catch (matErr) {
      // If writing staged edits failed, restore immediately and fail open
      this.restoreJournal(journalData, journalFile, journalDir);
      throw matErr;
    }

    let result: T;
    let execError: any = null;

    try {
      result = await fn();
    } catch (err) {
      execError = err;
    } finally {
      this.restoreJournal(journalData, journalFile, journalDir);
    }

    if (execError) {
      throw execError;
    }
    return result!;
  }

  private restoreJournal(
    journal: MaterializationJournal,
    journalFile: string,
    journalDir: string,
  ): void {
    for (let i = journal.entries.length - 1; i >= 0; i--) {
      const entry = journal.entries[i];
      // Check conflict rule: did the command modify the materialized file?
      if (entry.writtenContent !== undefined && fs.existsSync(entry.absPath)) {
        try {
          const currentDisk = fs.readFileSync(entry.absPath, "utf-8");
          if (currentDisk !== entry.writtenContent) {
            const safeName = entry.relPath.replace(/[/\\?%*:|"<>]/g, "_");
            const backupFile = path.join(
              journalDir,
              `conflict-${journal.id}-${safeName}.bak`,
            );
            fs.writeFileSync(backupFile, currentDisk, "utf-8");
            console.warn(
              `[ChangeManager] Conflict detected: "${entry.relPath}" was modified by verification command. Preserved backup at ${backupFile}`,
            );
          }
        } catch {}
      }

      // Restore original state
      try {
        if (!entry.exists) {
          if (fs.existsSync(entry.absPath)) {
            fs.unlinkSync(entry.absPath);
          }
          this.cleanEmptyParents(path.dirname(entry.absPath), journal.workspaceRoot);
        } else if (entry.originalContent !== undefined) {
          fs.mkdirSync(path.dirname(entry.absPath), { recursive: true });
          fs.writeFileSync(entry.absPath, entry.originalContent, "utf-8");
          if (entry.originalMode !== undefined) {
            try {
              fs.chmodSync(entry.absPath, entry.originalMode);
            } catch {}
          }
        }
      } catch (rstErr: any) {
        console.error(`[ChangeManager] Error restoring "${entry.relPath}":`, rstErr);
      }
    }

    // Clean up journal file
    try {
      if (fs.existsSync(journalFile)) {
        fs.unlinkSync(journalFile);
      }
    } catch {}
  }

  private cleanEmptyParents(dir: string, root: string): void {
    let current = path.resolve(dir);
    const resolvedRoot = path.resolve(root);
    while (current.startsWith(resolvedRoot) && current !== resolvedRoot) {
      try {
        if (fs.existsSync(current) && fs.readdirSync(current).length === 0) {
          fs.rmdirSync(current);
          current = path.dirname(current);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
  }
}

/**
 * Generate a standard unified diff representation between original and new text.
 */
function formatUnifiedDiff(filePath: string, original: string, modified: string): string {
  const origLines = original ? original.split("\n") : [];
  const modLines = modified ? modified.split("\n") : [];

  const header = `--- a/${filePath}\n+++ b/${filePath}\n`;

  // Simple line-by-line diff
  const diffLines: string[] = [];
  let i = 0;
  let j = 0;

  while (i < origLines.length || j < modLines.length) {
    if (i < origLines.length && j < modLines.length) {
      if (origLines[i] === modLines[j]) {
        // Unchanged
        i++;
        j++;
      } else {
        // Find next match or emit deletion/addition
        diffLines.push(`-${origLines[i]}`);
        diffLines.push(`+${modLines[j]}`);
        i++;
        j++;
      }
    } else if (i < origLines.length) {
      diffLines.push(`-${origLines[i]}`);
      i++;
    } else if (j < modLines.length) {
      diffLines.push(`+${modLines[j]}`);
      j++;
    }
  }

  if (diffLines.length === 0) {
    return `${header}@@ -1,1 +1,1 @@\n (no changes)\n`;
  }

  return `${header}@@ -1,${origLines.length || 1} +1,${modLines.length || 1} @@\n${diffLines.join("\n")}\n`;
}
