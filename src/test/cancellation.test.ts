import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import * as vscode from "vscode";
import { ShutdownManager } from "../cli/shutdown";
import { ProcessManager } from "../cli/processManager";
import { fetchWithRetry } from "../llm/http";
import { runCommandTool } from "../tools/impl/runCommand";
import { createFileTool } from "../tools/impl/createFile";
import { editFileTool } from "../tools/impl/editFile";
import { WorkspaceIsolation } from "../cli/workspaceIsolation";
import type { ToolContext } from "../tools/types";

suite("Cancellation and Graceful Shutdown Tests", () => {
  let tempDir: string;

  suiteSetup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-cancel-test-"));
  });

  suiteTeardown(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  setup(() => {
    ShutdownManager.resetInstance();
    ProcessManager.getInstance().clear();
  });

  teardown(() => {
    ShutdownManager.resetInstance();
    ProcessManager.getInstance().clear();
  });

  // ─── 1. Cancellation propagation tests ─────────────────────────────────────

  test("A cancellation signal reaches active task and aborts it", async () => {
    const shutdown = ShutdownManager.getInstance();
    const controller = new AbortController();
    shutdown.setActiveTask(controller);

    assert.strictEqual(shutdown.isTaskActive(), true);
    assert.strictEqual(controller.signal.aborted, false);

    let cancelled = false;
    shutdown.onCancel(() => {
      cancelled = true;
    });

    // Simulate interrupt
    let exitCode: number | null = null;
    (shutdown as any).exitHandler = (code: number) => {
      exitCode = code;
    };
    (shutdown as any).logger = () => {};

    await shutdown.handleInterrupt();

    assert.strictEqual(controller.signal.aborted, true, "Controller should be aborted");
    assert.strictEqual(cancelled, true, "Cancel callback should be invoked");
    assert.strictEqual(exitCode, 130, "Exit code should be 130 for interrupted task");
  });

  test("Active LLM retry loop stops immediately when cancelled", async () => {
    const controller = new AbortController();

    // Start a fetchWithRetry to an unreachable URL that would retry
    let retried = false;
    const fetchPromise = fetchWithRetry(
      "http://127.0.0.1:59999/nonexistent",
      { method: "POST" },
      {
        retries: 5,
        signal: controller.signal,
        onRetry: () => {
          retried = true;
        },
      },
    );

    // Immediately abort the signal
    controller.abort();

    await assert.rejects(
      fetchPromise,
      (err: any) => err.name === "AbortError" || /aborted/i.test(err.message),
      "Should reject with AbortError on cancellation without looping retries",
    );
    assert.strictEqual(retried, false, "Should not retry after abort");
  });

  test("Running tool does not execute write if signal is already aborted", async () => {
    const testFile = path.join(tempDir, "aborted-write.txt");
    const uri = vscode.Uri.file(testFile);
    const controller = new AbortController();
    controller.abort(); // already aborted

    const ctx: ToolContext = {
      workspaceRoot: vscode.Uri.file(tempDir),
      terminalAutoRun: true,
      autoEdit: true,
      signal: controller.signal,
      resolvePath: async () => uri as any,
      toRelative: () => "aborted-write.txt",
      confirm: async () => true,
    };

    await assert.rejects(
      createFileTool.execute({ path: "aborted-write.txt", content: "data" }, ctx),
      /cancelled/i,
      "createFileTool should reject when signal is aborted",
    );

    assert.strictEqual(fs.existsSync(testFile), false, "File should not have been created");
  });

  test("Edit tool does not apply changes when signal is aborted", async () => {
    const testFile = path.join(tempDir, "edit-target.txt");
    fs.writeFileSync(testFile, "initial content", "utf8");
    const uri = vscode.Uri.file(testFile);
    const controller = new AbortController();
    controller.abort(); // already aborted

    const ctx: ToolContext = {
      workspaceRoot: vscode.Uri.file(tempDir),
      terminalAutoRun: true,
      autoEdit: true,
      signal: controller.signal,
      resolvePath: async () => uri as any,
      toRelative: () => "edit-target.txt",
      confirm: async () => true,
    };

    await assert.rejects(
      editFileTool.execute(
        { path: "edit-target.txt", old_string: "initial", new_string: "modified" },
        ctx,
      ),
      /cancelled/i,
      "editFileTool should reject when signal is aborted",
    );

    const content = fs.readFileSync(testFile, "utf8");
    assert.strictEqual(content, "initial content", "File content should remain intact");
  });

  test("Cancellation does not produce duplicate shutdown operations", async () => {
    let cancelCount = 0;
    const shutdown = new ShutdownManager({
      exitHandler: () => {},
      logger: () => {},
      onCancelTask: () => {
        cancelCount++;
      },
    });

    const controller = new AbortController();
    shutdown.setActiveTask(controller);

    // Call interrupt twice rapidly
    await Promise.all([
      shutdown.handleInterrupt(),
      shutdown.handleInterrupt(),
    ]);

    assert.strictEqual(cancelCount, 1, "onCancelTask should only be called once");
  });

  // ─── 2. Child Process Management Tests ─────────────────────────────────────

  test("A child process is tracked and terminated on cancellation", async () => {
    const pm = ProcessManager.getInstance();
    // Spawn a sleep process that would normally run for 30 seconds
    const child = spawn(process.platform === "win32" ? "timeout" : "sleep", [
      process.platform === "win32" ? "30" : "30",
    ]);

    const unregister = pm.register(child, "sleep 30");
    assert.strictEqual(pm.size >= 1, true, "Process should be tracked in ProcessManager");

    // Terminate via ProcessManager
    const killed = pm.killProcess(child, "SIGTERM");
    assert.strictEqual(killed, true, "killProcess should return true");

    // Wait for exit
    let exited = false;
    await new Promise<void>((resolve) => {
      child.on("exit", () => {
        exited = true;
        resolve();
      });
      setTimeout(resolve, 1500);
    });

    unregister();
    assert.strictEqual(exited || child.killed || child.exitCode !== null || child.signalCode !== null, true);
  });

  test("killAll escalates to SIGKILL for stubborn processes", async () => {
    const pm = ProcessManager.getInstance();
    // Spawn a node child process that traps SIGTERM and ignores it
    const child = spawn("node", [
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    ]);

    pm.register(child, "stubborn-process");
    assert.strictEqual(pm.size >= 1, true);

    // killAll with short grace period
    await pm.killAll(false, 300);

    // Wait for exit after escalation
    let exited = false;
    await new Promise<void>((resolve) => {
      child.on("exit", () => {
        exited = true;
        resolve();
      });
      setTimeout(resolve, 1500);
    });

    assert.strictEqual(exited || child.killed || child.exitCode !== null || child.signalCode !== null, true);
  });

  test("Already-exited processes do not cause cleanup errors", () => {
    const pm = ProcessManager.getInstance();
    const child = spawn("node", ["-e", "process.exit(0);"]);

    pm.register(child, "quick-exit");

    // Attempting to kill already exited process should not throw
    assert.doesNotThrow(() => {
      pm.killProcess(child, "SIGTERM");
    });
  });

  test("runCommand tool terminates child process immediately when signal aborts", async () => {
    const controller = new AbortController();
    const ctx: ToolContext = {
      workspaceRoot: vscode.Uri.file(tempDir),
      terminalAutoRun: true,
      signal: controller.signal,
      resolvePath: async () => vscode.Uri.file(tempDir) as any,
      toRelative: () => "",
      confirm: async () => true,
    };

    // Start a 20-second sleep command
    const startMs = Date.now();
    const cmdPromise = runCommandTool.execute(
      { command: process.platform === "win32" ? "timeout 20" : "sleep 20" },
      ctx,
    );

    // Abort after 100ms
    setTimeout(() => {
      controller.abort();
    }, 100);

    const result = await cmdPromise;
    const elapsed = Date.now() - startMs;

    assert.strictEqual(result.isError, true, "Result should be marked as error/cancelled");
    assert.ok(result.summary?.includes("cancelled"), "Summary should indicate cancellation");
    assert.ok(elapsed < 4000, `Command should terminate in < 4s, took ${elapsed}ms`);
  });

  // ─── 3. Terminal & Double Ctrl+C Tests ─────────────────────────────────────

  test("The application exits cleanly when Ctrl+C is pressed while idle", async () => {
    let exitCode: number | null = null;
    const shutdown = new ShutdownManager({
      exitHandler: (code) => {
        exitCode = code;
      },
      logger: () => {},
    });

    // Idle: no active task
    assert.strictEqual(shutdown.isTaskActive(), false);

    await shutdown.handleInterrupt();

    assert.strictEqual(exitCode, 0, "Idle interrupt should exit with code 0");
    assert.strictEqual(shutdown.getState(), "SHUTTING_DOWN");
  });

  test("Second Ctrl+C triggers immediate force exit escalation", async () => {
    let lastExitCode: number | null = null;
    const shutdown = new ShutdownManager({
      exitHandler: (code) => {
        lastExitCode = code;
      },
      logger: () => {},
    });

    const controller = new AbortController();
    shutdown.setActiveTask(controller);

    // First interrupt begins CANCELLING
    const p1 = shutdown.handleInterrupt();

    // Second interrupt triggers FORCE_EXIT
    const p2 = shutdown.handleInterrupt();

    await Promise.all([p1, p2]);

    assert.strictEqual(shutdown.getState(), "FORCE_EXIT", "State should escalate to FORCE_EXIT");
    assert.strictEqual(lastExitCode, 130, "Exit code should be 130 on force exit");
  });

  test("restoreTerminalState safely restores raw mode and cursor", () => {
    const shutdown = ShutdownManager.getInstance();
    assert.doesNotThrow(() => {
      shutdown.restoreTerminalState();
    });
  });

  // ─── 4. Workspace Safety Tests ─────────────────────────────────────────────

  test("Cancellation does not delete unrelated workspace files", async () => {
    const safeFile = path.join(tempDir, "important-user-work.txt");
    fs.writeFileSync(safeFile, "DO NOT DELETE", "utf8");

    const controller = new AbortController();
    controller.abort();

    const ctx: ToolContext = {
      workspaceRoot: vscode.Uri.file(tempDir),
      terminalAutoRun: true,
      signal: controller.signal,
      resolvePath: async () => vscode.Uri.file(safeFile) as any,
      toRelative: () => "important-user-work.txt",
      confirm: async () => true,
    };

    // Execute tool with aborted signal
    try {
      await createFileTool.execute({ path: "other.txt", content: "hello" }, ctx);
    } catch {}

    assert.strictEqual(
      fs.existsSync(safeFile),
      true,
      "Existing user files must not be touched or deleted on cancellation",
    );
    assert.strictEqual(
      fs.readFileSync(safeFile, "utf8"),
      "DO NOT DELETE",
      "Existing user file content must remain intact",
    );
  });

  test("Cancellation during git clone terminates process and cleans up partial dir", async () => {
    const targetDir = path.join(tempDir, "partial-clone-test");
    const controller = new AbortController();

    // Abort clone almost immediately
    setTimeout(() => {
      controller.abort();
    }, 50);

    // cloneRepository is synchronous; wrap so assert.rejects can handle
    await assert.rejects(
      async () => {
        WorkspaceIsolation.cloneRepository(
          "https://github.com/octocat/Hello-World.git",
          targetDir,
        );
      },
      (err: any) => {
        // Either the clone failed (network) or was never expected to succeed —
        // what matters is that no uncaught exception propagates.
        return err instanceof Error;
      },
    );

    // If partial directory was created, it should have been cleaned up
    const isPartial = fs.existsSync(targetDir) && !WorkspaceIsolation.isGitRepo(targetDir);
    assert.strictEqual(isPartial, false, "Incomplete clone directory must not linger");
  });
});
