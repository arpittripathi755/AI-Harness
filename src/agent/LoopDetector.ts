import * as crypto from "crypto";

export interface ToolSignature {
  name: string;
  argsHash: string;
  resultHash: string;
}

export interface LoopWarning {
  type: "warn" | "abort";
  message: string;
  repetitions: number;
}

/**
 * Detects when the agent is stuck in an ineffective tool execution loop
 * by tracking canonical signatures of (tool name, args, result) triples.
 *
 * - After WARN_THRESHOLD identical consecutive (name + args) → emit a warn
 * - After ABORT_THRESHOLD identical consecutive (name + args) → emit an abort
 *
 * Additional heuristics:
 * - Edit-failure loop: 2 consecutive `old_string not found` on the same file
 *   → signal the caller to force a fresh full-file read before the next edit.
 * - Search near-duplicate: N failed searches with the same query/file target
 *   in a row → nudge the agent to broaden its strategy.
 *
 * Calling `recordSuccess()` clears the history (progress was made).
 */
export class LoopDetector {
  static readonly WARN_THRESHOLD = 3;
  static readonly ABORT_THRESHOLD = 6;

  /** Max consecutive edit failures on the same file before forcing a re-read. */
  static readonly EDIT_FAIL_THRESHOLD = 2;

  /** Max consecutive failed searches before nudging to change strategy. */
  static readonly SEARCH_FAIL_THRESHOLD = 3;

  private readonly history: ToolSignature[] = [];

  /** file path → count of consecutive edit-tool failures */
  private readonly editFailures = new Map<string, number>();

  /** tracks consecutive failed searches (query normalized → count) */
  private readonly searchFailures = new Map<string, number>();

  // ─── Hashing ──────────────────────────────────────────────────────────────

  /** Hash a value to a short canonical string for comparison. */
  static hash(value: unknown): string {
    let canonical: string;
    try {
      if (value !== null && typeof value === "object") {
        canonical = JSON.stringify(value, Object.keys(value as object).sort());
      } else {
        canonical = String(value);
      }
    } catch {
      canonical = String(value);
    }
    return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  }

  // ─── Primary record ───────────────────────────────────────────────────────

  /**
   * Record one tool execution. Returns a LoopWarning if the agent appears stuck,
   * or undefined if everything looks fine.
   *
   * Note: comparison is by (name + argsHash) only — the result hash is stored
   * but not compared, so re-running `git status` after a real state change is
   * NOT falsely flagged, but calling the same tool with identical args is.
   */
  record(
    name: string,
    args: Record<string, unknown>,
    result: string,
  ): LoopWarning | undefined {
    const sig: ToolSignature = {
      name,
      argsHash: LoopDetector.hash(args),
      resultHash: LoopDetector.hash(result),
    };

    this.history.push(sig);

    // Count consecutive identical (name + argsHash) signatures from the end
    const last = this.history[this.history.length - 1];
    let consecutive = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];
      if (h.name === last.name && h.argsHash === last.argsHash) {
        consecutive++;
      } else {
        break;
      }
    }

    if (consecutive >= LoopDetector.ABORT_THRESHOLD) {
      return {
        type: "abort",
        message:
          `The agent has called \`${name}\` with identical arguments ` +
          `${consecutive} times in a row without making progress. ` +
          `This indicates an unrecoverable loop. Aborting to prevent wasted API calls.`,
        repetitions: consecutive,
      };
    }

    if (consecutive >= LoopDetector.WARN_THRESHOLD) {
      return {
        type: "warn",
        message:
          `Warning: \`${name}\` has been called ${consecutive} times with the same arguments. ` +
          `If you keep doing this without making progress the agent will abort. ` +
          `Try a different approach or ask the user for clarification.`,
        repetitions: consecutive,
      };
    }

    return undefined;
  }

  // ─── Edit-failure loop detection ──────────────────────────────────────────

  /**
   * Record an edit tool failure (edit_file / multi_edit with "old_string not found"
   * or similar patch errors). Returns true if the caller should force a full file
   * re-read before allowing the next edit attempt on the same file.
   */
  recordEditFailure(filePath: string): boolean {
    const count = (this.editFailures.get(filePath) ?? 0) + 1;
    this.editFailures.set(filePath, count);
    return count >= LoopDetector.EDIT_FAIL_THRESHOLD;
  }

  /** Clear edit failure counter for a file after a successful edit or explicit re-read. */
  clearEditFailure(filePath: string): void {
    this.editFailures.delete(filePath);
  }

  /** Number of consecutive edit failures recorded for `filePath`. */
  editFailureCount(filePath: string): number {
    return this.editFailures.get(filePath) ?? 0;
  }

  // ─── Search near-duplicate detection ─────────────────────────────────────

  /**
   * Record a failed search (search_workspace / list_files that returned no
   * matches or a minimal set). Returns true if the agent should be nudged to
   * change strategy.
   *
   * Queries are normalized (lowercased, punctuation collapsed) before comparison
   * so "find Button.tsx" and "find button.tsx" are treated as the same search.
   */
  recordFailedSearch(query: string): boolean {
    const normalized = normalizeQuery(query);
    const count = (this.searchFailures.get(normalized) ?? 0) + 1;
    this.searchFailures.set(normalized, count);
    return count >= LoopDetector.SEARCH_FAIL_THRESHOLD;
  }

  clearSearchFailures(): void {
    this.searchFailures.clear();
  }

  // ─── Progress signals ─────────────────────────────────────────────────────

  /**
   * Call this after a successful mutation (file edit, create, delete) to signal
   * that progress was made. Clears the signature history and edit/search failure maps.
   */
  recordSuccess(): void {
    this.history.length = 0;
    this.editFailures.clear();
    this.searchFailures.clear();
  }

  /** Reset all state (e.g., after a new conversation turn begins). */
  reset(): void {
    this.history.length = 0;
    this.editFailures.clear();
    this.searchFailures.clear();
  }

  get size(): number {
    return this.history.length;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
