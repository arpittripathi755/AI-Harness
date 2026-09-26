import { exec } from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolDeniedError } from "../types";
import { requireString } from "../fsutil";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 20_000;

export const runCommandTool: Tool = {
  name: "run_command",
  mutates: true,
  description:
    "Run a shell command and return its stdout, stderr, and exit code. Use for " +
    "builds, tests, git operations, file inspection, scripts, etc. Supports optional " +
    "custom cwd to run in any directory. Special commands: 'cd <dir>' persistently " +
    "moves the agent's working directory, and 'pwd' prints current directory.",
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
          "Directory path to execute the command in. Defaults to current working directory, but can be any system path.",
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

    const baseDir = ctx.workspaceRoot ? ctx.workspaceRoot.fsPath : process.cwd();
    const customCwd =
      typeof args.cwd === "string" && args.cwd.trim() ? args.cwd.trim() : undefined;
    const cwd = customCwd
      ? customCwd.startsWith("~")
        ? path.normalize(path.join(process.env.HOME || "", customCwd.slice(1)))
        : path.isAbsolute(customCwd)
          ? path.normalize(customCwd)
          : path.normalize(path.join(baseDir, customCwd))
      : baseDir;

    // In manual mode ask for confirmation; in auto mode run directly.
    if (!ctx.terminalAutoRun && !ctx.autoEdit) {
      const approved = await ctx.confirm(
        "Run this command?",
        `${command}\n\nWorking directory:\n${cwd}`,
      );
      if (!approved) {
        throw new ToolDeniedError(`Running "${command}" was declined by the user.`);
      }
    }

    // Direct support for cd command to change process working directory persistently
    const cdMatch = command.match(/^\s*cd(?:\s+(.+))?\s*$/);
    if (cdMatch) {
      const rawTarget = cdMatch[1]?.trim() || "~";
      const target = rawTarget.startsWith("~")
        ? path.join(process.env.HOME || "", rawTarget.slice(1))
        : rawTarget;
      const resolved = path.isAbsolute(target)
        ? path.normalize(target)
        : path.normalize(path.join(cwd, target));
      try {
        process.chdir(resolved);
        const newUri = vscode.Uri.file(resolved);
        (ctx as any).workspaceRoot = newUri;
        if ((vscode.workspace as any).workspaceFolders) {
          (vscode.workspace as any).workspaceFolders = [
            {
              uri: newUri,
              name: path.basename(resolved) || resolved,
              index: 0,
            },
          ];
        }
        if (typeof (ctx as any).onWorkspaceChanged === "function") {
          (ctx as any).onWorkspaceChanged(newUri);
        }
        return {
          content: `Working directory changed to: ${resolved}`,
          summary: `Changed directory to ${resolved}`,
        };
      } catch (err: any) {
        return {
          content: `Failed to change directory to ${resolved}: ${err.message}`,
          isError: true,
          summary: `cd failed: ${err.message}`,
        };
      }
    }

    if (command.trim() === "pwd") {
      return {
        content: cwd,
        summary: `pwd: ${cwd}`,
      };
    }

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
