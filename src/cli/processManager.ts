import type { ChildProcess } from "child_process";

export interface TrackedProcess {
  process: ChildProcess;
  description: string;
  startedAt: number;
}

/**
 * Centrally tracks all spawned child processes (shell commands, git, builds)
 * and guarantees reliable termination on cancellation or shutdown.
 */
export class ProcessManager {
  private static instance: ProcessManager | undefined;
  private readonly activeProcesses = new Map<number, TrackedProcess>();

  static getInstance(): ProcessManager {
    if (!ProcessManager.instance) {
      ProcessManager.instance = new ProcessManager();
    }
    return ProcessManager.instance;
  }

  /**
   * Register a newly spawned child process for lifecycle tracking.
   * Returns an unregister function to call when the process completes.
   */
  register(child: ChildProcess, description = "child process"): () => void {
    const pid = child.pid;
    if (!pid) {
      return () => {};
    }

    const tracked: TrackedProcess = {
      process: child,
      description,
      startedAt: Date.now(),
    };

    this.activeProcesses.set(pid, tracked);

    const cleanup = () => {
      this.activeProcesses.delete(pid);
    };

    child.once("exit", cleanup);
    child.once("error", cleanup);

    return cleanup;
  }

  /**
   * Return the count of currently running child processes.
   */
  get size(): number {
    return this.activeProcesses.size;
  }

  /**
   * Terminate a single child process (and its process group on POSIX).
   */
  killProcess(
    child: ChildProcess,
    signal: NodeJS.Signals = "SIGTERM",
  ): boolean {
    const pid = child.pid;
    if (!pid || child.killed) {
      return false;
    }

    try {
      if (process.platform !== "win32") {
        // On Unix, try killing the process group (negative PID) first
        // to ensure children of shells are also terminated if detached.
        try {
          process.kill(-pid, signal);
          (child as any).killed = true;
          return true;
        } catch {
          // If group kill fails (e.g. process is not a process group leader ESRCH, or EPERM),
          // fall back to killing the process directly.
          try {
            process.kill(pid, signal);
            (child as any).killed = true;
            return true;
          } catch (directErr: any) {
            if (directErr?.code === "ESRCH") {
              return false; // Process already dead
            }
            return false;
          }
        }
      } else {
        child.kill(signal);
        return true;
      }
    } catch (err: any) {
      if (err?.code === "ESRCH") {
        return false; // Process already exited
      }
      return false;
    }
  }

  /**
   * Terminate all tracked child processes.
   *
   * @param force If true, immediately sends SIGKILL. If false, sends SIGTERM
   * and schedules a SIGKILL escalation if processes do not exit within `gracePeriodMs`.
   * @param gracePeriodMs Grace period in ms before escalating SIGTERM to SIGKILL.
   */
  async killAll(force = false, gracePeriodMs = 1200): Promise<void> {
    if (this.activeProcesses.size === 0) {
      return;
    }

    const entries = Array.from(this.activeProcesses.values());
    const initialSignal: NodeJS.Signals = force ? "SIGKILL" : "SIGTERM";

    for (const entry of entries) {
      this.killProcess(entry.process, initialSignal);
    }

    if (force) {
      this.activeProcesses.clear();
      return;
    }

    // Wait for the grace period to allow processes to exit cleanly
    const deadline = Date.now() + gracePeriodMs;
    while (this.activeProcesses.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Escalate to SIGKILL for any stubborn survivors
    if (this.activeProcesses.size > 0) {
      const remaining = Array.from(this.activeProcesses.values());
      for (const entry of remaining) {
        this.killProcess(entry.process, "SIGKILL");
      }
      this.activeProcesses.clear();
    }
  }

  /**
   * Clear all tracked processes without killing (e.g., in unit test resets).
   */
  clear(): void {
    this.activeProcesses.clear();
  }
}
