import { exec } from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolDeniedError, ToolError } from "../types";
import { requireString } from "../fsutil";

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes — enough for builds/tests
const MAX_OUTPUT_CHARS = 30_000;

export const runCommandTool: Tool = {
  name: "run_command",
  mutates: true,
  description:
    "Run a shell command and return its stdout/stderr and exit code. " +
    "Use for builds, tests, linters, git operations, and any other shell commands. " +
    "Supports an optional `cwd` parameter to run in a specific directory. " +
    "The `cd <dir>` built-in updates the persistent working directory for subsequent commands. " +
    "Commands run non-interactively; do not start long-lived watchers or servers.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The exact shell command to execute.",
      },
      cwd: {
        type: "string",
        description:
          "Optional working directory for this command. Defaults to the current workspace root.",
      },
      timeout_ms: {
        type: "integer",
        description: `Max run time in ms (default ${DEFAULT_TIMEOUT_MS}).`,
      },
    },
    required: ["command"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const command = requireString(args, "command").trim();
    const timeout =
      typeof args.timeout_ms === "number" && args.timeout_ms > 0
        ? Math.min(args.timeout_ms, 10 * 60_000)
        : DEFAULT_TIMEOUT_MS;

    // --- Built-in: cd ---
    // Handles `cd <dir>` by updating the workspace context persistently
    if (/^cd(\s+.*)?$/.test(command)) {
      const target = command.slice(2).trim() || process.env.HOME || "/";
      const expanded = target.startsWith("~/")
        ? path.join(process.env.HOME ?? "/", target.slice(2))
        : target.startsWith("~")
        ? process.env.HOME ?? "/"
        : target;
      const resolved = path.isAbsolute(expanded)
        ? expanded
        : path.join(ctx.workspaceRoot?.fsPath ?? process.cwd(), expanded);
      try {
        process.chdir(resolved);
        const newRoot = vscode.Uri.file(resolved);
        ctx.workspaceRoot = newRoot;
        (vscode.workspace as any).workspaceFolders = [
          {
            uri: newRoot,
            name: path.basename(resolved) || resolved,
            index: 0,
          },
        ];
        if (typeof (ctx as any).onWorkspaceChanged === "function") {
          (ctx as any).onWorkspaceChanged(newRoot);
        }
        return {
          content: `Changed directory to: ${resolved}`,
          isError: false,
          summary: `cd → ${resolved}`,
        };
      } catch (err: any) {
        return {
          content: `Error: ${err.message}`,
          isError: true,
          summary: `cd failed`,
        };
      }
    }

    // --- Built-in: pwd ---
    if (command === "pwd") {
      const cwd = ctx.workspaceRoot?.fsPath ?? process.cwd();
      return { content: cwd, isError: false, summary: `pwd: ${cwd}` };
    }

    // --- Determine working directory ---
    let cwd: string;
    if (typeof args.cwd === "string" && args.cwd.trim()) {
      const rawCwd = args.cwd.trim().replace(/^~/, process.env.HOME ?? "/");
      cwd = path.isAbsolute(rawCwd)
        ? rawCwd
        : path.join(ctx.workspaceRoot?.fsPath ?? process.cwd(), rawCwd);
    } else {
      // Use ctx.workspaceRoot if set, else process.cwd()
      cwd = ctx.workspaceRoot?.fsPath ?? process.cwd();
    }

    // --- Manual mode: ask for confirmation ---
    if (!ctx.terminalAutoRun) {
      const approved = await ctx.confirm(
        "Run this command?",
        `${command}\n\nWorking directory:\n${cwd}`,
      );
      if (!approved) {
        throw new ToolDeniedError(`Running "${command}" was declined by the user.`);
      }
    }

    // --- Execute ---
    const { stdout, stderr, code, timedOut } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
      timedOut: boolean;
    }>((resolve) => {
      const child = exec(
        command,
        { cwd, timeout, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
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
      child.on("error", () =>
        resolve({ stdout: "", stderr: "failed to start process", code: 1, timedOut: false }),
      );
    });

    const clip = (s: string) =>
      s.length > MAX_OUTPUT_CHARS
        ? s.slice(0, MAX_OUTPUT_CHARS) + "\n… output truncated."
        : s;

    const sections = [
      `$ ${command}`,
      `exit code: ${code}${timedOut ? " (timed out)" : ""}`,
    ];
    if (stdout.trim()) sections.push(`stdout:\n${clip(stdout)}`);
    if (stderr.trim()) sections.push(`stderr:\n${clip(stderr)}`);

    return {
      content: sections.join("\n\n"),
      isError: code !== 0,
      summary: `\`${command}\` exited ${code}${timedOut ? " (timeout)" : ""}`,
    };
  },
};
