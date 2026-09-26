import { exec } from "child_process";
import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolDeniedError, ToolError } from "../types";
import { requireString } from "../fsutil";

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

    const cwd = ctx.workspaceRoot.fsPath;
    console.log(`[run_command] command="${command}" cwd="${cwd}"`);
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
          const execErr = err as (Error & { code?: number; signal?: string }) | null;
          const timedOut = !!execErr && execErr.signal === "SIGTERM";
          const code =
            execErr && typeof execErr.code === "number"
              ? execErr.code
              : execErr
                ? 1
                : 0;
          resolve({ stdout: out, stderr: errOut, code, timedOut });
        },
      );
      // Ensure the process is killed if the timeout elapses.
      child.on("error", () =>
        resolve({ stdout: "", stderr: "failed to start", code: 1, timedOut: false }),
      );
    });

    const clip = (s: string) =>
      s.length > MAX_OUTPUT_CHARS
        ? s.slice(0, MAX_OUTPUT_CHARS) + "\n… output truncated."
        : s;

    const sections = [`$ ${command}`, `exit code: ${code}${timedOut ? " (timed out)" : ""}`];
    if (stdout.trim()) {
      sections.push(`stdout:\n${clip(stdout)}`);
    }
    if (stderr.trim()) {
      sections.push(`stderr:\n${clip(stderr)}`);
    }

    return {
      content: sections.join("\n\n"),
      isError: code !== 0,
      summary: `\`${command}\` exited ${code}${timedOut ? " (timeout)" : ""}`,
    };
  },
};
