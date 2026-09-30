import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ChangeManager, isVerificationCommand } from "../tools/changes";
import { runCommandTool } from "../tools/impl/runCommand";
import type { ToolContext } from "../tools/types";

suite("Phase 1: Staged Overlay Materialization (DAXIOM_STAGED_DISK_SYNC)", () => {
  let tempDir: string;
  const originalEnvFlag = process.env.DAXIOM_STAGED_DISK_SYNC;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-materialize-test-"));
    process.env.DAXIOM_STAGED_DISK_SYNC = "1";
  });

  teardown(() => {
    if (originalEnvFlag !== undefined) {
      process.env.DAXIOM_STAGED_DISK_SYNC = originalEnvFlag;
    } else {
      delete process.env.DAXIOM_STAGED_DISK_SYNC;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function getDirTree(dir: string): Record<string, string> {
    const result: Record<string, string> = {};
    function walk(curr: string) {
      for (const entry of fs.readdirSync(curr)) {
        if (entry === ".daxiom") continue;
        const full = path.join(curr, entry);
        const rel = path.relative(dir, full);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else {
          result[rel] = fs.readFileSync(full, "utf-8");
        }
      }
    }
    walk(dir);
    return result;
  }

  test("1. edit → materialize → restore", async () => {
    const file = path.join(tempDir, "file.txt");
    fs.writeFileSync(file, "original text\n", "utf-8");
    const cm = new ChangeManager(tempDir);

    cm.stageEdit("file.txt", "staged edited text\n");

    let sawMaterialized = "";
    await cm.withMaterialized(async () => {
      sawMaterialized = fs.readFileSync(file, "utf-8");
    });

    assert.strictEqual(sawMaterialized, "staged edited text\n");
    // After restore, disk must have original text
    assert.strictEqual(fs.readFileSync(file, "utf-8"), "original text\n");
    // In-memory overlay must remain intact
    assert.strictEqual(await cm.readEffective("file.txt"), "staged edited text\n");
  });

  test("2. create → materialize → restore", async () => {
    const newFile = path.join(tempDir, "sub", "created.txt");
    const cm = new ChangeManager(tempDir);

    cm.stageCreate("sub/created.txt", "created file content\n");

    let sawExists = false;
    let sawContent = "";
    await cm.withMaterialized(async () => {
      sawExists = fs.existsSync(newFile);
      if (sawExists) sawContent = fs.readFileSync(newFile, "utf-8");
    });

    assert.strictEqual(sawExists, true);
    assert.strictEqual(sawContent, "created file content\n");
    // After restore, file and empty subfolder must be removed
    assert.strictEqual(fs.existsSync(newFile), false);
    assert.strictEqual(fs.existsSync(path.join(tempDir, "sub")), false);
  });

  test("3. delete → materialize → restore", async () => {
    const delFile = path.join(tempDir, "delete-me.txt");
    fs.writeFileSync(delFile, "delete me content\n", "utf-8");
    const cm = new ChangeManager(tempDir);

    cm.stageDelete("delete-me.txt");

    let sawExists = true;
    await cm.withMaterialized(async () => {
      sawExists = fs.existsSync(delFile);
    });

    assert.strictEqual(sawExists, false);
    // After restore, file must be back
    assert.strictEqual(fs.existsSync(delFile), true);
    assert.strictEqual(fs.readFileSync(delFile, "utf-8"), "delete me content\n");
  });

  test("4. rename → materialize → restore", async () => {
    const oldFile = path.join(tempDir, "old.txt");
    const newFile = path.join(tempDir, "renamed.txt");
    fs.writeFileSync(oldFile, "rename content\n", "utf-8");
    const cm = new ChangeManager(tempDir);

    await cm.stageRename("old.txt", "renamed.txt");

    let sawOld = true;
    let sawNew = false;
    let newContent = "";
    await cm.withMaterialized(async () => {
      sawOld = fs.existsSync(oldFile);
      sawNew = fs.existsSync(newFile);
      if (sawNew) newContent = fs.readFileSync(newFile, "utf-8");
    });

    assert.strictEqual(sawOld, false);
    assert.strictEqual(sawNew, true);
    assert.strictEqual(newContent, "rename content\n");

    // After restore: old file back, new file removed
    assert.strictEqual(fs.existsSync(oldFile), true);
    assert.strictEqual(fs.readFileSync(oldFile, "utf-8"), "rename content\n");
    assert.strictEqual(fs.existsSync(newFile), false);
  });

  test("5. command throws: restores disk cleanly and rethrows", async () => {
    const file = path.join(tempDir, "file.txt");
    fs.writeFileSync(file, "original\n", "utf-8");
    const cm = new ChangeManager(tempDir);
    cm.stageEdit("file.txt", "mutated\n");

    await assert.rejects(
      async () => {
        await cm.withMaterialized(async () => {
          assert.strictEqual(fs.readFileSync(file, "utf-8"), "mutated\n");
          throw new Error("simulated test command failure");
        });
      },
      /simulated test command failure/,
    );

    // Disk must be restored despite error
    assert.strictEqual(fs.readFileSync(file, "utf-8"), "original\n");
  });

  test("6. command times out: process cleanup and clean disk restoration", async () => {
    const file = path.join(tempDir, "file.txt");
    fs.writeFileSync(file, "original\n", "utf-8");
    const cm = new ChangeManager(tempDir);
    cm.stageEdit("file.txt", "mutated\n");

    // Simulate timeout inside withMaterialized
    await cm.withMaterialized(async () => {
      assert.strictEqual(fs.readFileSync(file, "utf-8"), "mutated\n");
      // mock timed out child run
      await new Promise((r) => setTimeout(r, 50));
    });

    assert.strictEqual(fs.readFileSync(file, "utf-8"), "original\n");
  });

  test("7. command is killed: signal abortion and clean disk restoration", async () => {
    const file = path.join(tempDir, "file.txt");
    fs.writeFileSync(file, "original\n", "utf-8");
    const cm = new ChangeManager(tempDir);
    cm.stageEdit("file.txt", "mutated\n");

    const controller = new AbortController();

    await cm.withMaterialized(async () => {
      controller.abort();
      assert.strictEqual(fs.readFileSync(file, "utf-8"), "mutated\n");
    });

    assert.strictEqual(fs.readFileSync(file, "utf-8"), "original\n");
  });

  test("8. stale journal / crash recovery", async () => {
    const file = path.join(tempDir, "crashed.txt");
    // Simulate disk being left in mutated state due to process crash
    fs.writeFileSync(file, "stale mutated content\n", "utf-8");

    // Create a stale journal
    const journalDir = path.join(tempDir, ".daxiom", "journal");
    fs.mkdirSync(journalDir, { recursive: true });
    const journalFile = path.join(journalDir, "stale-123.json");
    fs.writeFileSync(
      journalFile,
      JSON.stringify({
        id: "stale-123",
        timestamp: Date.now() - 10000,
        workspaceRoot: tempDir,
        entries: [
          {
            relPath: "crashed.txt",
            absPath: file,
            exists: true,
            originalContent: "pre-crash original\n",
            writtenContent: "stale mutated content\n",
            action: "edit",
          },
        ],
      }),
      "utf-8",
    );

    // Initializing ChangeManager triggers crash recovery
    const cm = new ChangeManager(tempDir);

    // Crash recovery should have restored original text and deleted journal
    assert.strictEqual(fs.readFileSync(file, "utf-8"), "pre-crash original\n");
    assert.strictEqual(fs.existsSync(journalFile), false);
  });

  test("9. command modifies a staged file: preserves backup and logs warning", async () => {
    const file = path.join(tempDir, "file.txt");
    fs.writeFileSync(file, "original\n", "utf-8");
    const cm = new ChangeManager(tempDir);
    cm.stageEdit("file.txt", "staged edit\n");

    await cm.withMaterialized(async () => {
      // Simulate command modifying the file (e.g. linter --fix or compiler artifact)
      fs.writeFileSync(file, "modified by verification command\n", "utf-8");
    });

    // Check that backup file was created in .daxiom/journal
    const journalDir = path.join(tempDir, ".daxiom", "journal");
    const files = fs.existsSync(journalDir) ? fs.readdirSync(journalDir) : [];
    const backupFile = files.find((f) => f.startsWith("conflict-") && f.endsWith(".bak"));
    assert.ok(backupFile, "Conflict backup file should exist in .daxiom/journal");

    const backupContent = fs.readFileSync(path.join(journalDir, backupFile!), "utf-8");
    assert.strictEqual(backupContent, "modified by verification command\n");

    // Original content restored to working tree
    assert.strictEqual(fs.readFileSync(file, "utf-8"), "original\n");
  });

  test("10. empty overlay: withMaterialized executes directly without disk modifications", async () => {
    const file = path.join(tempDir, "file.txt");
    fs.writeFileSync(file, "original\n", "utf-8");
    const cm = new ChangeManager(tempDir);
    assert.strictEqual(cm.hasStaged(), false);

    let ran = false;
    await cm.withMaterialized(async () => {
      ran = true;
      assert.strictEqual(fs.readFileSync(file, "utf-8"), "original\n");
    });

    assert.strictEqual(ran, true);
    assert.strictEqual(fs.existsSync(path.join(tempDir, ".daxiom")), false);
  });

  test("11. feature flag OFF: withMaterialized bypasses materialization", async () => {
    process.env.DAXIOM_STAGED_DISK_SYNC = "0";
    const file = path.join(tempDir, "file.txt");
    fs.writeFileSync(file, "disk original\n", "utf-8");
    const cm = new ChangeManager(tempDir);
    cm.stageEdit("file.txt", "staged overlay content\n");

    let diskSeenInside = "";
    await cm.withMaterialized(async () => {
      diskSeenInside = fs.readFileSync(file, "utf-8");
    });

    // When flag is OFF, disk was NOT modified during fn execution
    assert.strictEqual(diskSeenInside, "disk original\n");
    assert.strictEqual(fs.existsSync(path.join(tempDir, ".daxiom")), false);
  });

  test("12. overlapping materialization attempts run sequentially via mutex", async () => {
    const file = path.join(tempDir, "file.txt");
    fs.writeFileSync(file, "original\n", "utf-8");
    const cm = new ChangeManager(tempDir);
    cm.stageEdit("file.txt", "staged\n");

    const executionOrder: string[] = [];

    const p1 = cm.withMaterialized(async () => {
      executionOrder.push("start 1");
      await new Promise((r) => setTimeout(r, 60));
      executionOrder.push("end 1");
    });

    const p2 = cm.withMaterialized(async () => {
      executionOrder.push("start 2");
      await new Promise((r) => setTimeout(r, 20));
      executionOrder.push("end 2");
    });

    await Promise.all([p1, p2]);

    assert.deepStrictEqual(executionOrder, ["start 1", "end 1", "start 2", "end 2"]);
  });

  test("13. working tree byte-identical before and after every successful/failed run", async () => {
    const f1 = path.join(tempDir, "a.ts");
    const f2 = path.join(tempDir, "b.ts");
    fs.writeFileSync(f1, "export const a = 1;\n", "utf-8");
    fs.writeFileSync(f2, "export const b = 2;\n", "utf-8");

    const beforeTree = getDirTree(tempDir);

    const cm = new ChangeManager(tempDir);
    cm.stageEdit("a.ts", "export const a = 99;\n");
    cm.stageCreate("sub/c.ts", "export const c = 3;\n");
    cm.stageDelete("b.ts");

    // Successful run
    await cm.withMaterialized(async () => {
      assert.strictEqual(fs.readFileSync(f1, "utf-8"), "export const a = 99;\n");
    });

    assert.deepStrictEqual(getDirTree(tempDir), beforeTree);

    // Failed run
    try {
      await cm.withMaterialized(async () => {
        throw new Error("fail");
      });
    } catch {}

    assert.deepStrictEqual(getDirTree(tempDir), beforeTree);
  });

  test("verification command classifier matches expected commands", () => {
    assert.strictEqual(isVerificationCommand("npm test"), true);
    assert.strictEqual(isVerificationCommand("npm run test"), true);
    assert.strictEqual(isVerificationCommand("npm run build"), true);
    assert.strictEqual(isVerificationCommand("npm run lint"), true);
    assert.strictEqual(isVerificationCommand("tsc"), true);
    assert.strictEqual(isVerificationCommand("npx tsc --noEmit"), true);
    assert.strictEqual(isVerificationCommand("jest"), true);
    assert.strictEqual(isVerificationCommand("vitest"), true);
    assert.strictEqual(isVerificationCommand("pytest"), true);
    assert.strictEqual(isVerificationCommand("cargo test"), true);
    assert.strictEqual(isVerificationCommand("go test ./..."), true);
    assert.strictEqual(isVerificationCommand("git status"), false);
    assert.strictEqual(isVerificationCommand("cat README.md"), false);
  });

  test("runCommand appends '(ran against staged edits)' when materialization is used", async () => {
    const file = path.join(tempDir, "sample.js");
    fs.writeFileSync(file, 'console.log("original");\n', "utf-8");

    const cm = new ChangeManager(tempDir);
    cm.stageEdit("sample.js", 'console.log("materialized staged");\n');

    const ctx: ToolContext = {
      workspaceRoot: vscode.Uri.file(tempDir),
      changeManager: cm,
      terminalAutoRun: true,
      confirm: async () => true,
      resolvePath: async (p) => vscode.Uri.file(path.resolve(tempDir, p)),
      toRelative: (uri) => path.relative(tempDir, uri.fsPath),
    };

    // Run verification command: node to execute script
    const result = await runCommandTool.execute({ command: `node sample.js && npm test || node sample.js` }, ctx);

    assert.ok(result.content.includes("(ran against staged edits)"));
    assert.ok(result.content.includes("materialized staged"));

    // Physical disk must be restored to original
    assert.strictEqual(fs.readFileSync(file, "utf-8"), 'console.log("original");\n');
  });

  test("scenario (b): multi-file change with failing test sees staged edits on FIRST execution", async () => {
    // 1. Setup workspace with source file and test file
    const srcFile = path.join(tempDir, "calc.js");
    const testFile = path.join(tempDir, "calc.test.js");
    const helperFile = path.join(tempDir, "format.js");

    // Initial state on disk: calc.js has a bug (a - b instead of a + b)
    fs.writeFileSync(srcFile, "module.exports = { add: (a, b) => a - b };\n", "utf-8");
    fs.writeFileSync(helperFile, 'module.exports = { prefix: (v) => "Result: " + v };\n', "utf-8");
    fs.writeFileSync(
      testFile,
      'const { add } = require("./calc");\n' +
      'const { prefix } = require("./format");\n' +
      'const res = add(2, 3);\n' +
      'if (res !== 5) { console.error("Test failed: expected 5, got " + res); process.exit(1); }\n' +
      'console.log(prefix(res));\n',
      "utf-8",
    );

    const cm = new ChangeManager(tempDir);

    const ctx: ToolContext = {
      workspaceRoot: vscode.Uri.file(tempDir),
      changeManager: cm,
      terminalAutoRun: true,
      confirm: async () => true,
      resolvePath: async (p) => vscode.Uri.file(path.resolve(tempDir, p)),
      toRelative: (uri) => path.relative(tempDir, uri.fsPath),
    };

    // 2. Baseline without staged changes: command fails against disk
    const failRun = await runCommandTool.execute({ command: `npm test || node calc.test.js` }, ctx);
    assert.strictEqual(failRun.isError, true, "Initial disk state must fail test");
    assert.ok(failRun.content.includes("Test failed: expected 5, got -1"));

    // 3. Stage multi-file fix in ChangeManager overlay
    // File 1: Fix add function
    cm.stageEdit("calc.js", "module.exports = { add: (a, b) => a + b };\n");
    // File 2: Stage updated format helper
    cm.stageEdit("format.js", 'module.exports = { prefix: (v) => "SUCCESS: " + v };\n');

    // Verify disk is STILL untouched before verification command
    assert.ok(fs.readFileSync(srcFile, "utf-8").includes("a - b"));

    // 4. Run verification command with DAXIOM_STAGED_DISK_SYNC=1
    // On its FIRST execution, it MUST see the staged fixes and PASS!
    const verifiedRun = await runCommandTool.execute({ command: `npm test || node calc.test.js` }, ctx);

    // Assert that the command succeeded on first run
    assert.strictEqual(verifiedRun.isError, false, "Verification must pass on first run against staged edits");
    assert.ok(verifiedRun.content.includes("SUCCESS: 5"));
    assert.ok(verifiedRun.content.includes("(ran against staged edits)"));

    // 5. Verify working tree integrity immediately after command:
    // Physical disk is back to pre-run state (staged overlay has not been permanently flushed yet)
    assert.ok(fs.readFileSync(srcFile, "utf-8").includes("a - b"), "Physical disk must remain uncommitted original");
    assert.ok(fs.readFileSync(helperFile, "utf-8").includes("Result: "), "Physical helper file must remain uncommitted original");

    // 6. Overlay continues holding the verified fix
    assert.ok((await cm.readEffective("calc.js")).includes("a + b"));
  });
});

