import type * as readline from "readline";
import { ProcessManager } from "./processManager";
import { colors } from "./tui";

export type ShutdownState = "IDLE" | "CANCELLING" | "SHUTTING_DOWN" | "FORCE_EXIT";

export interface ShutdownOptions {
  onCancelTask?: () => void | Promise<void>;
  onCleanup?: () => void | Promise<void>;
  exitHandler?: (code: number) => void;
  logger?: (msg: string) => void;
}

/**
 * Centralized lifecycle and shutdown manager for DAXIOM.
 * Coordinates graceful cancellation, double-Ctrl+C escalation,
 * child process termination, and clean terminal restoration.
 */
export class ShutdownManager {
  private static instance: ShutdownManager | undefined;

  private state: ShutdownState = "IDLE";
  private activeTaskController: AbortController | undefined;
  private cancelCallbacks = new Set<() => void | Promise<void>>();
  private cleanupCallbacks = new Set<() => void | Promise<void>>();
  private exitHandler: (code: number) => void = (code) => process.exit(code);
  private logger: (msg: string) => void = (msg) => console.log(msg);

  private rl: readline.Interface | undefined;
  private rawModeListenerAttached = false;
  private signalsAttached = false;
  private isHandlingInterrupt = false;

  static getInstance(): ShutdownManager {
    if (!ShutdownManager.instance) {
      ShutdownManager.instance = new ShutdownManager();
    }
    return ShutdownManager.instance;
  }

  /** Reset instance state (for testing). */
  static resetInstance(): void {
    if (ShutdownManager.instance) {
      ShutdownManager.instance.detach();
      ShutdownManager.instance = undefined;
    }
  }

  constructor(opts?: ShutdownOptions) {
    if (opts?.exitHandler) {
      this.exitHandler = opts.exitHandler;
    }
    if (opts?.logger) {
      this.logger = opts.logger;
    }
    if (opts?.onCancelTask) {
      this.cancelCallbacks.add(opts.onCancelTask);
    }
    if (opts?.onCleanup) {
      this.cleanupCallbacks.add(opts.onCleanup);
    }
  }

  getState(): ShutdownState {
    return this.state;
  }

  isTaskActive(): boolean {
    return this.activeTaskController !== undefined && !this.activeTaskController.signal.aborted;
  }

  /**
   * Set or clear the active task's AbortController.
   */
  setActiveTask(controller: AbortController | undefined): void {
    this.activeTaskController = controller;
  }

  getActiveTaskSignal(): AbortSignal | undefined {
    return this.activeTaskController?.signal;
  }

  /**
   * Register a callback to execute when a task is cancelled.
   */
  onCancel(cb: () => void | Promise<void>): () => void {
    this.cancelCallbacks.add(cb);
    return () => this.cancelCallbacks.delete(cb);
  }

  /**
   * Register a cleanup callback run during final shutdown.
   */
  onCleanup(cb: () => void | Promise<void>): () => void {
    this.cleanupCallbacks.add(cb);
    return () => this.cleanupCallbacks.delete(cb);
  }

  /**
   * Bind the readline interface so shutdown can cleanly pause/close it.
   */
  bindReadline(rl: readline.Interface): void {
    this.rl = rl;
    // Intercept readline's SIGINT event
    rl.on("SIGINT", () => {
      this.handleInterrupt();
    });
  }

  /**
   * Attach process signal listeners and raw stdin listeners.
   */
  attach(): void {
    if (this.signalsAttached) {
      return;
    }
    this.signalsAttached = true;

    process.on("SIGINT", this.onSigInt);
    process.on("SIGTERM", this.onSigTerm);
    process.on("SIGHUP", this.onSigTerm);

    this.attachRawStdinListener();
  }

  /**
   * Detach all listeners.
   */
  detach(): void {
    if (this.signalsAttached) {
      process.removeListener("SIGINT", this.onSigInt);
      process.removeListener("SIGTERM", this.onSigTerm);
      process.removeListener("SIGHUP", this.onSigTerm);
      this.signalsAttached = false;
    }
    this.detachRawStdinListener();
  }

  private onSigInt = (): void => {
    this.handleInterrupt();
  };

  private onSigTerm = (): void => {
    this.handleInterrupt(true);
  };

  /**
   * Raw-mode stdin listener to catch Ctrl+C (\u0003) if raw mode is ever enabled.
   */
  private attachRawStdinListener(): void {
    if (this.rawModeListenerAttached || !process.stdin.isTTY) {
      return;
    }

    try {
      process.stdin.on("data", this.onStdinData);
      this.rawModeListenerAttached = true;
    } catch {
      // Ignore if stdin is not readable
    }
  }

  private detachRawStdinListener(): void {
    if (this.rawModeListenerAttached) {
      try {
        process.stdin.removeListener("data", this.onStdinData);
      } catch {}
      this.rawModeListenerAttached = false;
    }
  }

  private onStdinData = (chunk: Buffer | string): void => {
    // Only inspect in raw mode where the terminal driver does NOT generate SIGINT
    if (Boolean(process.stdin.isRaw)) {
      const str = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (str.includes("\u0003")) {
        this.handleInterrupt();
      }
    }
  };

  /**
   * Primary interrupt handler (called on Ctrl+C or SIGINT/SIGTERM).
   */
  async handleInterrupt(isSigTerm = false): Promise<void> {
    // Prevent duplicate re-entry if the same event triggers simultaneously from multiple sources
    if (this.isHandlingInterrupt && this.state !== "CANCELLING" && this.state !== "SHUTTING_DOWN") {
      return;
    }

    // ─── SECOND CTRL+C: ESCALATE TO IMMEDIATE FORCE EXIT ──────────────────
    if (this.state === "CANCELLING" || this.state === "SHUTTING_DOWN") {
      this.state = "FORCE_EXIT";
      this.logger(`\n  ${colors.red}${colors.bold}Force exit requested. Terminating immediately...${colors.reset}`);

      // Forcefully terminate all remaining child processes (SIGKILL)
      await ProcessManager.getInstance().killAll(true);

      // Restore terminal state
      this.restoreTerminalState();

      this.exitHandler(130);
      return;
    }

    this.isHandlingInterrupt = true;

    try {
      const taskWasRunning = this.isTaskActive();

      if (taskWasRunning) {
        this.state = "CANCELLING";
        this.logger(`\n  ${colors.yellow}Interrupt received. Cancelling current task...${colors.reset}`);
        this.logger(`  ${colors.dim}Stopping active operations...${colors.reset}`);

        // 1. Abort active task controller
        if (this.activeTaskController && !this.activeTaskController.signal.aborted) {
          this.activeTaskController.abort();
        }

        // 2. Fire registered cancel callbacks
        for (const cb of this.cancelCallbacks) {
          try {
            await cb();
          } catch {
            // Ignore callback errors during shutdown
          }
        }

        // 3. Gracefully terminate active child processes (SIGTERM with grace timeout)
        await ProcessManager.getInstance().killAll(false, 800);
      }

      if (this.state === "FORCE_EXIT") {
        return;
      }

      this.state = "SHUTTING_DOWN";

      // Run any registered general cleanups
      for (const cb of this.cleanupCallbacks) {
        try {
          await cb();
        } catch {
          // Ignore
        }
      }

      // Close readline interface safely
      if (this.rl) {
        try {
          this.rl.close();
        } catch {}
      }

      // Restore terminal state
      this.restoreTerminalState();

      this.logger(`  ${colors.cyan}DAXIOM stopped. Returning to shell.${colors.reset}\n`);

      this.exitHandler(isSigTerm ? 143 : (taskWasRunning ? 130 : 0));
    } finally {
      this.isHandlingInterrupt = false;
    }
  }

  /**
   * Reset terminal raw mode and cursor settings to clean state.
   */
  restoreTerminalState(): void {
    this.detachRawStdinListener();

    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      try {
        process.stdin.setRawMode(false);
      } catch {}
    }

    try {
      // Ensure cursor is visible
      process.stdout.write("\x1b[?25h");
    } catch {}
  }
}
