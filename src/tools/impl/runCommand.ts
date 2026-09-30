import { exec } from "child_process";
import type { Tool, ToolContext, ToolResult } from "../types";
import { ToolDeniedError, ToolError } from "../types";
import { requireString } from "../fsutil";
import { truncateHeadTail } from "../../llm/contextBudget";
import { estimateTokens } from "../../llm/contextBudget";
import { ProcessManager } from "../../cli/processManager";
import { isVerificationCommand } from "../changes";
import { digestCommandOutput } from "./commandDigest";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = parseInt(process.env.MAX_COMMAND_OUTPUT_CHARS || "6000", 10);

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

    const isStagedSync = process.env.DAXIOM_STAGED_DISK_SYNC === "1";
    const isVerification = isVerificationCommand(command);
    const hasStaged = Boolean(ctx.changeManager?.hasStaged());
    let ranAgainstStaged = false;

    // When flag is OFF, preserve exact legacy behavior: apply staged changes permanently to disk
    if (!isStagedSync && hasStaged && ctx.changeManager) {
      await ctx.changeManager.applyChangeSet();
    }

    const cwd = ctx.workspaceRoot.fsPath;

    const runProcess = async () => {
      console.log(`[run_command] command="${command}" cwd="${cwd}"`);
      let cancelled = false;
      let unregister: (() => void) | undefined;
      const res = await new Promise<{
        stdout: string;
        stderr: string;
        code: number | null;
        timedOut: boolean;
        cancelled: boolean;
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
            resolve({ stdout: out, stderr: errOut, code, timedOut, cancelled });
          },
        );

        unregister = ProcessManager.getInstance().register(child, command);

        if (ctx.signal) {
          if (ctx.signal.aborted) {
            cancelled = true;
            ProcessManager.getInstance().killProcess(child, "SIGKILL");
            resolve({ stdout: "", stderr: "Command was cancelled", code: 1, timedOut: false, cancelled: true });
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
          resolve({ stdout: "", stderr: "failed to start", code: 1, timedOut: false, cancelled });
        });
      });
      return res;
    };

    let execOutput: {
      stdout: string;
      stderr: string;
      code: number | null;
      timedOut: boolean;
      cancelled: boolean;
    };

    if (isStagedSync && isVerification && hasStaged && ctx.changeManager) {
      try {
        execOutput = await ctx.changeManager.withMaterialized(runProcess);
        ranAgainstStaged = true;
      } catch (err: any) {
        if (process.env.DEBUG_TOKEN_BUDGET === "1") {
          console.log(`[DAXIOM_STAGED_DISK_SYNC] withMaterialized failed, failing open: ${err.message}`);
        }
        execOutput = await runProcess();
      }
    } else {
      execOutput = await runProcess();
    }

    const isCancelled = Boolean(execOutput.cancelled || ctx.signal?.aborted);

    // -----------------------------------------------------------------------
    // Phase 3: Command output digest (DAXIOM_COMMAND_DIGEST=1)
    // When OFF: behaviour is identical to the code below (existing head/tail).
    // When ON:  full raw output is written to .daxiom/scratch/cmd-<id>.log and
    //           a compact digest replaces the raw stdout/stderr sections.
    // -----------------------------------------------------------------------
    const isDigestEnabled =
      process.env.DAXIOM_COMMAND_DIGEST === "1" ||
      process.env.DAXIOM_COMMAND_DIGEST === "true";

    if (isDigestEnabled && !isCancelled && ctx.workspaceRoot) {
      let digestResult;
      try {
        digestResult = digestCommandOutput({
          command,
          stdout: execOutput.stdout,
          stderr: execOutput.stderr,
          exitCode: execOutput.code,
          timedOut: execOutput.timedOut,
          cancelled: execOutput.cancelled,
          workspaceRoot: cwd,
          maxChars: MAX_OUTPUT_CHARS,
        });
      } catch {
        // Fail open: if digest throws for any reason, fall through to legacy path
        digestResult = null;
      }

      if (digestResult) {
        // Measurement logging (visible under DEBUG_TOKEN_BUDGET=1)
        if (process.env.DEBUG_TOKEN_BUDGET === "1") {
          const rawTokens = estimateTokens(execOutput.stdout + execOutput.stderr);
          const digestTokens = estimateTokens(digestResult.digest);
          const reductionPct =
            rawTokens > 0
              ? Math.round((1 - digestTokens / rawTokens) * 100)
              : 0;
          console.log(
            `[DAXIOM_COMMAND_DIGEST] format=${digestResult.detectedFormat}` +
            ` raw_bytes=${digestResult.rawBytes}` +
            ` raw_tokens≈${rawTokens}` +
            ` digest_tokens≈${digestTokens}` +
            ` reduction=${reductionPct}%` +
            (digestResult.scratchRelPath ? ` scratch=${digestResult.scratchRelPath}` : ""),
          );
        }

        const digestSections = [
          `$ ${command}`,
          execOutput.timedOut
            ? `exit code: ${execOutput.code} (timed out)`
            : `exit code: ${execOutput.code}`,
        ];
        if (digestResult.digest.trim()) {
          digestSections.push(digestResult.digest);
        }
        if (ranAgainstStaged) {
          digestSections.push("(ran against staged edits)");
        }

        return {
          content: digestSections.join("\n\n"),
          isError: execOutput.code !== 0,
          summary: `\`${command}\` exited ${execOutput.code}${execOutput.timedOut ? " (timeout)" : ""}`,
        };
      }
      // Fall through to legacy path if digestResult is null
    }

    // -----------------------------------------------------------------------
    // Legacy path: existing truncateHeadTail behavior (flag OFF, or fail-open)
    // -----------------------------------------------------------------------
    const sections = [
      `$ ${command}`,
      isCancelled
        ? "exit code: cancelled"
        : `exit code: ${execOutput.code}${execOutput.timedOut ? " (timed out)" : ""}`,
    ];
    if (execOutput.stdout.trim()) {
      sections.push(`stdout:\n${truncateHeadTail(execOutput.stdout, MAX_OUTPUT_CHARS)}`);
    }
    if (execOutput.stderr.trim()) {
      sections.push(`stderr:\n${truncateHeadTail(execOutput.stderr, MAX_OUTPUT_CHARS)}`);
    }
    if (ranAgainstStaged) {
      sections.push("(ran against staged edits)");
    }

    return {
      content: sections.join("\n\n"),
      isError: execOutput.code !== 0 || isCancelled,
      summary: isCancelled
        ? `\`${command}\` cancelled`
        : `\`${command}\` exited ${execOutput.code}${execOutput.timedOut ? " (timeout)" : ""}`,
    };
  },
};
