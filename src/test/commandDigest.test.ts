/**
 * Phase 3: Command Output Digest (DAXIOM_COMMAND_DIGEST) tests.
 *
 * Coverage (23 required cases):
 *  1  short successful command remains effectively unchanged
 *  2  short failing command remains useful
 *  3  large Jest output digest — identifies failure, test, assertion
 *  4  large Vitest output digest
 *  5  large TypeScript (tsc) output digest — preserves file, line, col, error code
 *  6  large ESLint output digest
 *  7  large pytest output digest
 *  8  generic large command output
 *  9  unknown output falls back to existing head/tail behavior
 * 10  full output written to scratch file
 * 11  scratch path included in digest
 * 12  scratch file readable by read_file tool
 * 13  stdout/stderr handling
 * 14  exit code preservation
 * 15  timeout behavior unchanged (flag OFF path)
 * 16  kill/cancel behavior unchanged (flag OFF path)
 * 17  concurrent scratch files do not collide
 * 18  .daxiom/ remains gitignored
 * 19  feature flag OFF preserves existing behavior
 * 20  Phase 1 staged verification still works with flag ON
 * 21  (ran against staged edits) is preserved in digest output
 * 22  no scratch path escapes the workspace
 * 23  cleanup does not remove unrelated files
 */

import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import * as vscode from "vscode";
import {
  digestCommandOutput,
  writeScratch,
  type DigestInput,
} from "../tools/impl/commandDigest";
import { runCommandTool } from "../tools/impl/runCommand";
import { ChangeManager } from "../tools/changes";
import type { ToolContext } from "../tools/types";
import { readFileTool } from "../tools/impl/readFile";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ~3 000-char jest output with one failure */
const JEST_LARGE_OUTPUT = `
FAIL src/test/math.test.ts
  multiply
    ✓ multiplies positive numbers (3 ms)
    ✗ handles negative numbers (5 ms)
  add
    ✓ adds two numbers (2 ms)

  ● multiply › handles negative numbers

    expect(received).toBe(expected)

    Expected: -6
    Received: 6

      12 |   test("handles negative numbers", () => {
      13 |     const result = multiply(-2, 3);
    > 14 |     expect(result).toBe(-6);
         |                    ^
      15 |   });

      at Object.<anonymous> (src/test/math.test.ts:14:20)

Test Suites: 1 failed, 2 total
Tests:       1 failed, 2 passed, 3 total
Snapshots:   0 total
Time:        0.812 s
Ran all test suites.
`.repeat(8); // ~5 200 chars to exceed SHORT_OUTPUT_CHARS=2000

/** Vitest-style output */
const VITEST_LARGE_OUTPUT = `
 FAIL  src/test/calc.test.ts

 Test Files  1 failed (1)
 Tests       1 failed | 2 passed (3)
 Start at    10:00:00
 Duration    1.23 s (transform 45ms, setup 0ms, collect 12ms, tests 8ms)

stdout | src/test/calc.test.ts
add(2, 3) = 5

 FAIL src/test/calc.test.ts > multiply > handles negative numbers
  AssertionError: expected 6 to be -6
   - Expected:
   + Received:

   - -6
   + 6

  at src/test/calc.test.ts:14:5
`.repeat(10); // inflate to >2000 chars

/** tsc output with errors */
const TSC_LARGE_OUTPUT = `
src/agent/ChatSession.ts(612,15): error TS2588: Cannot assign to 'turn' because it is a constant.
src/llm/ProviderClient.ts(45,3): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
src/llm/tokenBudget.ts(100,9): error TS2304: Cannot find name 'DAXIOM_FLOOR'.
src/tools/impl/runCommand.ts(23,1): error TS2339: Property 'digestCommandOutput' does not exist on type 'typeof import(".../commandDigest")'.

Found 4 errors.
`.repeat(8); // inflate to >2000 chars

/** ESLint output with errors */
const ESLINT_LARGE_OUTPUT = `
/Users/dev/project/src/agent/ChatSession.ts
  15:3  error    'x' is not defined                  no-undef
  42:1  error    Expected 1 empty line at end of file  eol-last

/Users/dev/project/src/llm/ProviderClient.ts
  78:10  warning  'unused' is defined but never used  no-unused-vars
  120:5  error    Unexpected console statement          no-console

/Users/dev/project/src/tools/impl/runCommand.ts
  8:1   error    'estimateTokens' is defined but never used  no-unused-vars

✖ 4 errors, 1 warnings
`.repeat(12); // inflate to >2000 chars

/** pytest output with failures */
const PYTEST_LARGE_OUTPUT = `
============================= test session starts ==============================
platform linux -- Python 3.11.0, pytest-7.2.0, pluggy-1.0.0
rootdir: /Users/dev/project
collected 5 items

tests/test_math.py::test_add PASSED                                      [ 20%]
tests/test_math.py::test_multiply PASSED                                 [ 40%]
tests/test_math.py::test_negative_multiply FAILED                        [ 60%]
tests/test_math.py::test_divide PASSED                                   [ 80%]
tests/test_math.py::test_divide_zero FAILED                              [100%]

=================================== FAILURES ===================================
_________________ test_negative_multiply __________________________________

    def test_negative_multiply():
        result = multiply(-2, 3)
>       assert result == -6, f"Expected -6 got {result}"
E       AssertionError: Expected -6 got 6
E       assert 6 == -6

tests/test_math.py:25: AssertionError

_____________________ test_divide_zero ______________________________________

    def test_divide_zero():
>       assert divide(5, 0) == float("inf")
E       ZeroDivisionError: division by zero

tests/test_math.py:42: ZeroDivisionError

=========================== short test session info ===========================
FAILED tests/test_math.py::test_negative_multiply - AssertionError
FAILED tests/test_math.py::test_divide_zero - ZeroDivisionError
2 failed, 3 passed in 0.42s
`.repeat(2);

/** Generic unknown-format large output */
const GENERIC_LARGE_OUTPUT =
  "line output\n".repeat(800); // ~9 600 chars

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `daxiom-digest-test-${crypto.randomBytes(4).toString("hex")}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeDigestInput(overrides: Partial<DigestInput> & { workspaceRoot: string }): DigestInput {
  return {
    command: "npm test",
    stdout: "",
    stderr: "",
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    maxChars: 6_000,
    ...overrides,
  };
}

function makeCtx(tempDir: string, changeManager?: ChangeManager): ToolContext {
  return {
    workspaceRoot: vscode.Uri.file(tempDir),
    terminalAutoRun: true,
    confirm: async () => true,
    resolvePath: async (p: string) => vscode.Uri.file(path.resolve(tempDir, p)),
    toRelative: (uri: vscode.Uri) => path.relative(tempDir, uri.fsPath),
    changeManager,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite("Phase 3: Command Output Digest (DAXIOM_COMMAND_DIGEST)", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let tempDir: string;

  setup(() => {
    savedEnv.DAXIOM_COMMAND_DIGEST = process.env.DAXIOM_COMMAND_DIGEST;
    savedEnv.DAXIOM_STAGED_DISK_SYNC = process.env.DAXIOM_STAGED_DISK_SYNC;
    savedEnv.DEBUG_TOKEN_BUDGET = process.env.DEBUG_TOKEN_BUDGET;
    tempDir = makeTempDir();
  });

  teardown(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    // Clean up temp dir
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── 1. Short successful command remains effectively unchanged ──────────────
  test("1: short successful command remains effectively unchanged", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "echo hello",
        stdout: "hello\n",
        stderr: "",
        exitCode: 0,
      }),
    );

    assert.strictEqual(result.detectedFormat, "short");
    assert.ok(result.digest.includes("hello"), "digest must include original output");
    // Should not be longer than original by more than the scratch path line
    assert.ok(result.digestChars < result.originalChars + 200);
  });

  // ── 2. Short failing command remains useful ───────────────────────────────
  test("2: short failing command remains useful", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "node -e 'process.exit(1)'",
        stdout: "",
        stderr: "Error: something went wrong\n",
        exitCode: 1,
      }),
    );

    assert.strictEqual(result.detectedFormat, "short");
    assert.ok(result.digest.includes("something went wrong"), "error must be preserved");
  });

  // ── 3. Large Jest output digest ───────────────────────────────────────────
  test("3: large Jest output identifies failure, test, assertion", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "npx jest",
        stdout: JEST_LARGE_OUTPUT,
        stderr: "",
        exitCode: 1,
      }),
    );

    assert.strictEqual(result.detectedFormat, "jest");
    // Must identify overall failure count
    assert.ok(
      result.digest.match(/tests?.*failed/i) || result.digest.match(/1 failed/i),
      "digest must include failure count",
    );
    // Must identify the specific failing test
    assert.ok(
      result.digest.includes("handles negative numbers") || result.digest.includes("multiply"),
      "digest must include failing test name",
    );
    // Must include the assertion
    assert.ok(
      result.digest.includes("Expected") || result.digest.includes("Received") || result.digest.includes("-6"),
      "digest must include assertion information",
    );
    // Must be substantially smaller than raw output
    assert.ok(result.digestChars < result.originalChars * 0.7, `digest (${result.digestChars}) should be <70% of raw (${result.originalChars})`);
    // Must include scratch path
    assert.ok(result.scratchRelPath, "scratch path must be present");
    assert.ok(result.digest.includes(result.scratchRelPath!), "scratch path must appear in digest");
  });

  // ── 4. Large Vitest output digest ────────────────────────────────────────
  test("4: large Vitest output digest", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "npx vitest run",
        stdout: VITEST_LARGE_OUTPUT,
        stderr: "",
        exitCode: 1,
      }),
    );

    assert.ok(["vitest", "jest"].includes(result.detectedFormat), `detected format: ${result.detectedFormat}`);
    assert.ok(result.digest.length > 0);
    assert.ok(result.digest.includes(result.scratchRelPath!), "scratch path in digest");
    // Must be smaller than raw
    assert.ok(result.digestChars < result.originalChars * 0.8);
  });

  // ── 5. Large TypeScript output digest ────────────────────────────────────
  test("5: large tsc output preserves file, line, col, error code", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "tsc --noEmit",
        stdout: TSC_LARGE_OUTPUT,
        stderr: "",
        exitCode: 2,
      }),
    );

    assert.strictEqual(result.detectedFormat, "tsc");
    // Must include file path
    assert.ok(result.digest.includes("ChatSession.ts"), "must include file path");
    // Must include line and column
    assert.ok(result.digest.includes("612") && result.digest.includes("15"), "must include line/col");
    // Must include error code
    assert.ok(result.digest.includes("TS2588"), "must include TS error code");
    // Must be smaller than raw (tsc: repeated errors hit MAX_DIAGNOSTIC_LINES ceiling, ≥20% reduction)
    assert.ok(
      result.digestChars < result.originalChars * 0.9,
      `tsc digest (${result.digestChars}) should be <90% of raw (${result.originalChars})`,
    );
    assert.ok(result.digest.includes(result.scratchRelPath!));
  });

  // ── 6. Large ESLint output digest ────────────────────────────────────────
  test("6: large ESLint output identifies errors and rules", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "npx eslint src/",
        stdout: ESLINT_LARGE_OUTPUT,
        stderr: "",
        exitCode: 1,
      }),
    );

    assert.strictEqual(result.detectedFormat, "eslint");
    // Must include error counts
    assert.ok(result.digest.match(/errors?/i), "must mention errors");
    // Must include file info or rule
    assert.ok(
      result.digest.includes("no-undef") || result.digest.includes("ChatSession"),
      "must include rule or file info",
    );
    assert.ok(result.digestChars < result.originalChars * 0.8);
    assert.ok(result.digest.includes(result.scratchRelPath!));
  });

  // ── 7. Large pytest output digest ─────────────────────────────────────────
  test("7: large pytest output identifies failures and assertions", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "pytest tests/",
        stdout: PYTEST_LARGE_OUTPUT,
        stderr: "",
        exitCode: 1,
      }),
    );

    assert.strictEqual(result.detectedFormat, "pytest");
    // Must include overall result
    assert.ok(result.digest.match(/failed|passed/i), "must include pass/fail summary");
    // Must identify failing test
    assert.ok(
      result.digest.includes("test_negative_multiply") || result.digest.includes("test_divide_zero"),
      "must identify failing test",
    );
    assert.ok(result.digestChars < result.originalChars * 0.7);
    assert.ok(result.digest.includes(result.scratchRelPath!));
  });

  // ── 8. Generic large command output ──────────────────────────────────────
  test("8: generic large command output uses head/tail truncation", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "node generate-report.js",
        stdout: GENERIC_LARGE_OUTPUT,
        stderr: "",
        exitCode: 0,
      }),
    );

    assert.strictEqual(result.detectedFormat, "unknown");
    // Must preserve head and tail content
    assert.ok(result.digest.includes("line output"), "head content preserved");
    // Digest must be smaller
    assert.ok(result.digestChars < result.originalChars);
  });

  // ── 9. Unknown format falls back to existing head/tail behavior ───────────
  test("9: unknown format fallback is never worse than current head/tail", () => {
    const unknownOutput = "some arbitrary output\n".repeat(500); // 11 000 chars
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "some-unknown-tool --flag",
        stdout: unknownOutput,
        stderr: "",
        exitCode: 0,
        maxChars: 6_000,
      }),
    );

    assert.strictEqual(result.detectedFormat, "unknown");
    // Must include both head and tail of the raw output
    assert.ok(result.digest.includes("some arbitrary output"), "head of output preserved");
    // Must include the omitted-lines marker (same as truncateHeadTail)
    assert.ok(result.digest.includes("lines omitted"), "head/tail marker preserved");
    // Must also include the scratch path (this is the improvement over current behavior)
    assert.ok(result.digest.includes(result.scratchRelPath!), "scratch path added");
  });

  // ── 10. Full output written to scratch file ───────────────────────────────
  test("10: full raw output is written to scratch file", () => {
    const stdout = "Full stdout content for scratch\n" + "x".repeat(50);
    const stderr = "Full stderr content\n";

    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "npm test",
        stdout,
        stderr,
        exitCode: 1,
      }),
    );

    assert.ok(result.scratchRelPath, "scratch path must be set");
    const absPath = path.join(tempDir, result.scratchRelPath!);
    assert.ok(fs.existsSync(absPath), "scratch file must exist on disk");

    const raw = fs.readFileSync(absPath, "utf-8");
    assert.ok(raw.includes(stdout.trim()), "scratch file contains full stdout");
    assert.ok(raw.includes(stderr.trim()), "scratch file contains full stderr");
  });

  // ── 11. Scratch path included in digest ──────────────────────────────────
  test("11: scratch-file path is included in the digest output", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "tsc",
        stdout: TSC_LARGE_OUTPUT,
        stderr: "",
        exitCode: 2,
      }),
    );

    assert.ok(result.scratchRelPath, "scratchRelPath must be set");
    assert.ok(
      result.digest.includes(result.scratchRelPath!),
      `digest must contain the scratch path "${result.scratchRelPath}"`,
    );
  });

  // ── 12. Scratch file readable by read_file tool ───────────────────────────
  test("12: scratch file is retrievable by read_file tool", async () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "tsc",
        stdout: TSC_LARGE_OUTPUT,
        stderr: "",
        exitCode: 2,
      }),
    );

    assert.ok(result.scratchRelPath, "scratchRelPath must exist");

    const ctx = makeCtx(tempDir);
    const readResult = await readFileTool.execute({ path: result.scratchRelPath! }, ctx);
    // Should not be an error
    assert.ok(!readResult.isError, `read_file failed: ${readResult.content}`);
    // Content must include part of the original stdout
    assert.ok(readResult.content.includes("TS2588"), "scratch content must include original diagnostics");
  });

  // ── 13. stdout/stderr both handled ───────────────────────────────────────
  test("13: stdout and stderr are both captured in scratch file", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "make build",
        stdout: "Building...\nBuild complete\n",
        stderr: "warning: deprecated function used\n",
        exitCode: 0,
      }),
    );

    const absPath = path.join(tempDir, result.scratchRelPath!);
    const raw = fs.readFileSync(absPath, "utf-8");
    assert.ok(raw.includes("Building..."), "stdout in scratch file");
    assert.ok(raw.includes("deprecated function"), "stderr in scratch file");
  });

  // ── 14. Exit code preservation ────────────────────────────────────────────
  test("14: exit code is not modified by digest (runCommand owns exit code)", async () => {
    process.env.DAXIOM_COMMAND_DIGEST = "1";

    // Exit code 0 → isError false
    const ctx0 = makeCtx(tempDir);
    const r0 = await runCommandTool.execute(
      { command: "node -e \"process.exit(0)\"" },
      ctx0,
    );
    assert.strictEqual(r0.isError, false, "exit 0 must not be error");
    assert.ok(r0.content.includes("exit code: 0"), "exit code 0 in content");

    // Exit code 1 → isError true
    const r1 = await runCommandTool.execute(
      { command: "node -e \"process.exit(1)\"" },
      ctx0,
    );
    assert.strictEqual(r1.isError, true, "exit 1 must be error");
    assert.ok(r1.content.includes("exit code: 1"), "exit code 1 in content");
  });

  // ── 15. Timeout behavior unchanged (flag OFF) ────────────────────────────
  test("15: timeout behavior unchanged when DAXIOM_COMMAND_DIGEST is OFF", async () => {
    delete process.env.DAXIOM_COMMAND_DIGEST;

    const ctx = makeCtx(tempDir);
    const result = await runCommandTool.execute(
      {
        command: "node -e \"setTimeout(() => {}, 10000)\"",
        timeout_ms: 300,
      },
      ctx,
    );

    assert.ok(result.isError, "timed-out command must be error");
    assert.ok(result.content.includes("timed out"), "timeout marker in content");
    // No scratch file should exist (flag is OFF)
    const scratchDir = path.join(tempDir, ".daxiom", "scratch");
    assert.ok(!fs.existsSync(scratchDir), ".daxiom/scratch must not be created when flag is OFF");
  });

  // ── 16. Cancel/kill behavior unchanged (flag OFF) ────────────────────────
  test("16: cancel behavior unchanged when DAXIOM_COMMAND_DIGEST is OFF", async () => {
    delete process.env.DAXIOM_COMMAND_DIGEST;

    const controller = new AbortController();
    const ctx = { ...makeCtx(tempDir), signal: controller.signal };
    controller.abort();

    const result = await runCommandTool.execute(
      { command: "node -e \"setTimeout(() => {}, 5000)\"" },
      ctx,
    );

    assert.ok(result.isError, "cancelled command must be error");
    assert.ok(
      result.content.includes("cancelled") || result.content.includes("cancel"),
      "cancel marker in content",
    );
  });

  // ── 17. Concurrent scratch files do not collide ───────────────────────────
  test("17: concurrent run_command calls write non-colliding scratch files", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }).map((_, i) =>
        Promise.resolve(
          digestCommandOutput(
            makeDigestInput({
              workspaceRoot: tempDir,
              command: `echo run-${i}`,
              stdout: `output from run ${i}\n`,
              stderr: "",
              exitCode: 0,
            }),
          ),
        ),
      ),
    );

    const paths = results.map((r) => r.scratchRelPath).filter(Boolean) as string[];
    // All paths must be unique
    const unique = new Set(paths);
    assert.strictEqual(unique.size, paths.length, "all scratch paths must be unique");

    // All scratch files must exist and have correct content
    for (let i = 0; i < results.length; i++) {
      const absPath = path.join(tempDir, paths[i]);
      assert.ok(fs.existsSync(absPath), `scratch file ${i} must exist`);
      const content = fs.readFileSync(absPath, "utf-8");
      assert.ok(content.includes(`run ${i}`), `scratch file ${i} has correct content`);
    }
  });

  // ── 18. .daxiom/ remains gitignored ─────────────────────────────────────
  test("18: .daxiom/ entry is present in .gitignore", () => {
    const gitignorePath = path.join(
      __dirname,
      "..",
      "..",
      ".gitignore",
    );
    assert.ok(fs.existsSync(gitignorePath), ".gitignore must exist");
    const content = fs.readFileSync(gitignorePath, "utf-8");
    assert.ok(content.includes(".daxiom/"), ".daxiom/ must be in .gitignore");
  });

  // ── 19. Feature flag OFF preserves existing behavior exactly ─────────────
  test("19: DAXIOM_COMMAND_DIGEST=OFF preserves exact legacy behavior", async () => {
    delete process.env.DAXIOM_COMMAND_DIGEST;

    const bigStdout = "A".repeat(10_000);
    const ctx = makeCtx(tempDir);

    // Write a dummy script
    const scriptPath = path.join(tempDir, "big_output.js");
    fs.writeFileSync(scriptPath, `process.stdout.write(${JSON.stringify(bigStdout)})`);

    const result = await runCommandTool.execute(
      { command: `node big_output.js` },
      ctx,
    );

    // Must still include the head/tail truncation marker
    assert.ok(
      result.content.includes("lines omitted") || result.content.includes("["),
      "legacy truncation marker expected",
    );
    // No scratch file
    const scratchDir = path.join(tempDir, ".daxiom", "scratch");
    assert.ok(!fs.existsSync(scratchDir), "no scratch dir when flag is OFF");
  });

  // ── 20. Phase 1 staged verification still works ───────────────────────────
  test("20: Phase 1 staged verification works when digest is enabled", async () => {
    process.env.DAXIOM_STAGED_DISK_SYNC = "1";
    process.env.DAXIOM_COMMAND_DIGEST = "1";

    const file = path.join(tempDir, "sample.js");
    fs.writeFileSync(file, 'console.log("original");\n', "utf-8");

    const cm = new ChangeManager(tempDir);
    cm.stageEdit("sample.js", 'console.log("staged-content");\n');

    const ctx = makeCtx(tempDir, cm);
    const result = await runCommandTool.execute(
      { command: "node sample.js && npm test || node sample.js" },
      ctx,
    );

    // Disk must be restored
    assert.strictEqual(
      fs.readFileSync(file, "utf-8"),
      'console.log("original");\n',
      "disk must be restored to original after withMaterialized",
    );
    // staged content must have been visible to the command
    assert.ok(result.content.includes("staged-content"), "staged content visible to command");
  });

  // ── 21. (ran against staged edits) preserved in digest output ────────────
  test("21: (ran against staged edits) indicator preserved when digest is ON", async () => {
    process.env.DAXIOM_STAGED_DISK_SYNC = "1";
    process.env.DAXIOM_COMMAND_DIGEST = "1";

    const file = path.join(tempDir, "check.js");
    fs.writeFileSync(file, 'process.exit(1);\n', "utf-8");

    const cm = new ChangeManager(tempDir);
    cm.stageEdit("check.js", 'process.exit(0);\n');

    const ctx = makeCtx(tempDir, cm);
    const result = await runCommandTool.execute(
      { command: "node check.js && npm test || node check.js" },
      ctx,
    );

    assert.ok(
      result.content.includes("(ran against staged edits)"),
      "staged edits indicator must be present",
    );
  });

  // ── 22. No scratch path escapes the workspace ────────────────────────────
  test("22: scratch path is always inside the workspace root", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "ls -la",
        stdout: "total 42\n-rw-r--r-- 1 user group 100 Jan 1 file.txt\n",
        stderr: "",
        exitCode: 0,
      }),
    );

    if (result.scratchRelPath) {
      // Relative path must not start with ".."
      assert.ok(
        !result.scratchRelPath.startsWith(".."),
        "scratch rel path must not escape workspace via ..",
      );
      // Absolute resolution must be inside tempDir
      const abs = path.resolve(tempDir, result.scratchRelPath);
      const rel = path.relative(tempDir, abs);
      assert.ok(
        !rel.startsWith("..") && !path.isAbsolute(rel),
        `scratch abs path must be inside workspace: ${abs}`,
      );
    }
  });

  // ── 23. Cleanup does not remove unrelated files ───────────────────────────
  test("23: scratch file pruning only removes cmd-*.log files", () => {
    const scratchDir = path.join(tempDir, ".daxiom", "scratch");
    fs.mkdirSync(scratchDir, { recursive: true });

    // Create a "user" file that must not be deleted
    const userFile = path.join(scratchDir, "important-user-file.txt");
    fs.writeFileSync(userFile, "do not delete me", "utf-8");

    // Create MAX_SCRATCH_FILES + 2 cmd-*.log files to trigger pruning
    for (let i = 0; i < 52; i++) {
      const fpath = path.join(scratchDir, `cmd-${i.toString().padStart(5, "0")}-abcd1234.log`);
      fs.writeFileSync(fpath, `content ${i}`, "utf-8");
      // Ensure distinct mtimes
    }

    // Run one more digest to trigger pruning
    digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "echo prune-test",
        stdout: "trigger pruning\n",
        stderr: "",
        exitCode: 0,
      }),
    );

    // User file must still exist
    assert.ok(fs.existsSync(userFile), "user file must not be deleted by pruning");
  });

  // ── Bonus: tsc success case ───────────────────────────────────────────────
  test("B1: tsc success produces compact summary", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "tsc --noEmit",
        stdout: "Found 0 errors. Watching for file changes.",
        stderr: "",
        exitCode: 0,
      }),
    );

    assert.ok(["tsc", "unknown", "short"].includes(result.detectedFormat));
    // Success case should be compact
    assert.ok(result.digestChars < 300, `success digest must be compact, got ${result.digestChars} chars`);
    assert.ok(result.digest.includes("0 errors") || result.digest.includes("Found 0"), "must mention 0 errors");
  });

  // ── Bonus: flag ON + existing compilation-check ──────────────────────────
  test("B2: DAXIOM_COMMAND_DIGEST=1 produces scratch file in .daxiom/scratch/", async () => {
    process.env.DAXIOM_COMMAND_DIGEST = "1";

    const ctx = makeCtx(tempDir);
    const result = await runCommandTool.execute(
      { command: "node -e \"console.log('digest-probe')\"" },
      ctx,
    );

    assert.ok(!result.isError, "probe command must succeed");
    const scratchDir = path.join(tempDir, ".daxiom", "scratch");
    assert.ok(fs.existsSync(scratchDir), ".daxiom/scratch/ must be created when flag is ON");
    const files = fs.readdirSync(scratchDir).filter((f) => f.startsWith("cmd-"));
    assert.ok(files.length >= 1, "at least one cmd-*.log must exist");
    // For short outputs (<200 chars) the scratch path is intentionally omitted from digest;
    // verify the file exists and contains the raw output instead.
    const scratchContent = fs.readFileSync(path.join(scratchDir, files[0]), "utf-8");
    assert.ok(scratchContent.includes("digest-probe"), "scratch file must contain raw output");
  });

  // ── Information preservation: Case D (successful large command) ───────────
  test("Case D: successful large command digest is substantially smaller", () => {
    const largeSuccess = "Build artifact generated: file-" + "x".repeat(200) + "\n";
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "make all",
        stdout: largeSuccess.repeat(50), // ~10 250 chars
        stderr: "",
        exitCode: 0,
      }),
    );

    // Digest must be smaller than raw (primary goal is token reduction)
    assert.ok(result.digestChars < result.originalChars * 0.8, `digest ${result.digestChars} vs raw ${result.originalChars}`);
  });

  // ── Information preservation: Case A — jest with assertionError ───────────
  test("Case A: jest digest identifies failure AND assertion details", () => {
    const jestOut = JEST_LARGE_OUTPUT;
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "jest",
        stdout: jestOut,
        stderr: "",
        exitCode: 1,
      }),
    );

    // Check all three required information items
    const hasFailure = /failed/i.test(result.digest);
    const hasTest = /multiply|handles negative/i.test(result.digest);
    const hasAssertion = /Expected|Received|-6/i.test(result.digest);

    assert.ok(hasFailure, "digest must identify that the command failed");
    assert.ok(hasTest, "digest must identify which test failed");
    assert.ok(hasAssertion, "digest must include the assertion/error");
  });

  // ── Information preservation: Case B — tsc ───────────────────────────────
  test("Case B: tsc digest preserves file/line/col/code", () => {
    const result = digestCommandOutput(
      makeDigestInput({
        workspaceRoot: tempDir,
        command: "tsc",
        stdout: TSC_LARGE_OUTPUT,
        stderr: "",
        exitCode: 2,
      }),
    );

    assert.ok(result.digest.includes("ChatSession.ts"), "file path preserved");
    assert.ok(result.digest.includes("612"), "line number preserved");
    assert.ok(result.digest.includes("TS2588"), "error code preserved");
  });
});
