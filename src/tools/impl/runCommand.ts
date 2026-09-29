import { exec } from "child_process";
import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolDeniedError, ToolError } from "../types";
import { requireString } from "../fsutil";
import { truncateHeadTail } from "../../llm/contextBudget";
import { ProcessManager } from "../../cli/processManager";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 20_000;

export const runCommandTool: Tool = {
  name: "run_command",
  mutates: true,
  description:
    "Run a shell command in the workspace root and return its stdout/stderr and " +
    "exit code. Use for builds, tests, linters, git status, etc. This ALWAYS asks " +
    "the user to confirm before running. Commands run non-interactively; do not " +
    "start long-lived watchers or servers that never exit.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The exact shell command to execute.",
      },
      timeout_ms: {
        type: "integer",
        description: `Max run time in ms (default ${DEFAULT_TIMEOUT_MS}).`,
      },
    },
    required: ["command"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const command = requireString(args, "command");
    const timeout =
      typeof args.timeout_ms === "number" && args.timeout_ms > 0
        ? Math.min(args.timeout_ms, 5 * 60_000)
        : DEFAULT_TIMEOUT_MS;

    if (!ctx.workspaceRoot) {
      throw new ToolError("No workspace folder is open to run a command in.");
    }

    // In manual mode (default) ask for confirmation; in auto mode run directly.
    if (!ctx.terminalAutoRun) {
      const approved = await ctx.confirm(
        "Run this command?",
        `${command}\n\nWorking directory:\n${ctx.workspaceRoot.fsPath}`,
      );
      if (!approved) {
        throw new ToolDeniedError(`Running "${command}" was declined by the user.`);
      }
    }

    // Ensure any staged changes are applied to disk so shell commands (test, build, lint, git) see them
    if (ctx.changeManager?.hasStaged()) {
      await ctx.changeManager.applyChangeSet();
    }

    const cwd = ctx.workspaceRoot.fsPath;
    console.log(`[run_command] command="${command}" cwd="${cwd}"`);
    let cancelled = false;
    let unregister: (() => void) | undefined;
    const { stdout, stderr, code, timedOut } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
      timedOut: boolean;
    }>((resolve) => {
      const child = exec(
        command,
        { cwd, timeout, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
        (err, out, errOut) => {
          unregister?.();
          const execErr = err as (Error & { code?: number; signal?: string }) | null;
          const timedOut = !!execErr && execErr.signal === "SIGTERM" && !cancelled;
          const code =
            execErr && typeof execErr.code === "number"
              ? execErr.code
              : execErr
                ? 1
                : 0;
          resolve({ stdout: out, stderr: errOut, code, timedOut });
        },
      );

      unregister = ProcessManager.getInstance().register(child, command);

      if (ctx.signal) {
        if (ctx.signal.aborted) {
          cancelled = true;
          ProcessManager.getInstance().killProcess(child, "SIGKILL");
          resolve({ stdout: "", stderr: "Command was cancelled", code: 1, timedOut: false });
          return;
        }
        const onAbort = () => {
          cancelled = true;
          ProcessManager.getInstance().killProcess(child, "SIGKILL");
        };
        ctx.signal.addEventListener("abort", onAbort, { once: true });
        child.once("close", () => {
          ctx.signal?.removeEventListener("abort", onAbort);
          unregister?.();
        });
      } else {
        child.once("close", () => unregister?.());
      }

      // Ensure the process is killed if the timeout elapses.
      child.on("error", () => {
        unregister?.();
        resolve({ stdout: "", stderr: "failed to start", code: 1, timedOut: false });
      });
    });

    const isCancelled = Boolean(cancelled || ctx.signal?.aborted);
    const sections = [
      `$ ${command}`,
      isCancelled
        ? "exit code: cancelled"
        : `exit code: ${code}${timedOut ? " (timed out)" : ""}`,
    ];
    if (stdout.trim()) {
      sections.push(`stdout:\n${truncateHeadTail(stdout, MAX_OUTPUT_CHARS)}`);
    }
    if (stderr.trim()) {
      sections.push(`stderr:\n${truncateHeadTail(stderr, MAX_OUTPUT_CHARS)}`);
    }

    return {
      content: sections.join("\n\n"),
      isError: code !== 0 || isCancelled,
      summary: isCancelled
        ? `\`${command}\` cancelled`
        : `\`${command}\` exited ${code}${timedOut ? " (timeout)" : ""}`,
    };
  },
};
