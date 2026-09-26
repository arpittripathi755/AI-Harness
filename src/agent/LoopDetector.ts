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
 * - After WARN_THRESHOLD identical consecutive signatures → emit a warn
 * - After ABORT_THRESHOLD identical consecutive signatures → emit an abort
 *
 * Calling `recordSuccess()` clears the history (progress was made).
 */
export class LoopDetector {
  private static readonly WARN_THRESHOLD = 3;
  private static readonly ABORT_THRESHOLD = 6;

  private readonly history: ToolSignature[] = [];

  /** Hash a value to a short canonical string for comparison. */
  private static hash(value: unknown): string {
    const canonical = JSON.stringify(value, Object.keys(value as object ?? {}).sort());
    return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  }

  /**
   * Record one tool execution. Returns a LoopWarning if the agent appears stuck,
   * or undefined if everything looks fine.
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

    // Count consecutive identical signatures from the end
    const last = this.history[this.history.length - 1];
    let consecutive = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];
      if (h.name === last.name && h.argsHash === last.argsHash && h.resultHash === last.resultHash) {
        consecutive++;
      } else {
        break;
      }
    }

    if (consecutive >= LoopDetector.ABORT_THRESHOLD) {
      return {
        type: "abort",
        message:
          `The agent has called \`${name}\` with identical arguments and received ` +
          `the same result ${consecutive} times in a row. This indicates an unrecoverable loop. ` +
          `Aborting to prevent wasted API calls.`,
        repetitions: consecutive,
      };
    }

    if (consecutive >= LoopDetector.WARN_THRESHOLD) {
      return {
        type: "warn",
        message:
          `Warning: \`${name}\` has been called ${consecutive} times with the same arguments ` +
          `and result. If this continues, the agent will be aborted.`,
        repetitions: consecutive,
      };
    }

    return undefined;
  }

  /**
   * Call this after a successful mutation (file edit, create, delete) to signal
   * that progress was made. Clears the signature history.
   */
  recordSuccess(): void {
    this.history.length = 0;
  }

  /** Reset all state (e.g., after a new conversation turn begins). */
  reset(): void {
    this.history.length = 0;
  }

  get size(): number {
    return this.history.length;
  }
}
