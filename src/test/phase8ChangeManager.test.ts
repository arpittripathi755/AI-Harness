import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import { ChangeManager } from "../tools/changes";
import { createFileTool } from "../tools/impl/createFile";
import { deleteFileTool } from "../tools/impl/deleteFile";
import { renameFileTool } from "../tools/impl/renameFile";
import { editFileTool } from "../tools/impl/editFile";
import { readFileTool } from "../tools/impl/readFile";
import { listFilesTool } from "../tools/impl/listFiles";
import { searchWorkspaceTool } from "../tools/impl/searchWorkspace";
import { runCommandTool } from "../tools/impl/runCommand";
import { resolvePathInWorkspace } from "../tools/workspace";
import type { ToolContext } from "../tools/types";
import { SidebarProvider } from "../SidebarProvider";

suite("Phase 8 — VS Code ChangeManager Integration & Overlay Awareness", () => {
  let tempDir: string;
  let rootUri: vscode.Uri;

  setup(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-phase8-")));
    rootUri = vscode.Uri.file(tempDir);
  });

  teardown(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function createMockToolContext(cm?: ChangeManager): ToolContext {
    return {
      workspaceRoot: rootUri,
      changeManager: cm,
      terminalAutoRun: true,
      autoEdit: true,
      confirm: async () => true,
      resolvePath: async (p: string) => resolvePathInWorkspace(p, rootUri, async () => true),
      toRelative: (uri: vscode.Uri) => path.relative(tempDir, uri.fsPath),
    };
  }

  // ─── 1. ChangeManager Integration in GUI ───────────────────────────────────

  test("1.1: SidebarProvider initializes ToolContext with active ChangeManager", () => {
    const origDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, "workspaceFolders");
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      get: () => [{ uri: rootUri, name: path.basename(tempDir), index: 0 }],
      configurable: true,
    });

    try {
      const mockStorage = new Map<string, any>();
      const mockContext: any = {
        subscriptions: [],
        workspaceState: {
          get: (k: string, def?: any) => mockStorage.get(k) ?? def,
          update: (k: string, v: any) => {
            mockStorage.set(k, v);
            return Promise.resolve();
          },
          keys: () => Array.from(mockStorage.keys()),
        },
        globalState: {
          get: (k: string, def?: any) => mockStorage.get(k) ?? def,
          update: (k: string, v: any) => {
            mockStorage.set(k, v);
            return Promise.resolve();
          },
          setKeysForSync: () => {},
        },
        secrets: {
          get: () => Promise.resolve(undefined),
          store: () => Promise.resolve(),
          delete: () => Promise.resolve(),
        },
        extensionUri: rootUri,
      };

      const provider = new SidebarProvider(mockContext);
      const ctx = (provider as any).ensureToolContext();

      assert.ok(ctx, "ToolContext must be generated");
      assert.ok(ctx.changeManager, "ToolContext must receive a ChangeManager instance");
      assert.strictEqual(
        ctx.changeManager instanceof ChangeManager,
        true,
        "changeManager must be an instance of ChangeManager",
      );
      assert.strictEqual(
        provider.getChangeManager(),
        ctx.changeManager,
        "SidebarProvider getChangeManager() must match ctx.changeManager",
      );

      // Session isolation: newChat clears and resets ChangeManager
      provider.newChat();
      assert.strictEqual(provider.getChangeManager(), undefined, "newChat must clear active ChangeManager");
    } finally {
      if (origDescriptor) {
        Object.defineProperty(vscode.workspace, "workspaceFolders", origDescriptor);
      } else {
        delete (vscode.workspace as any).workspaceFolders;
      }
    }
  });

  // ─── 2. Create File Overlay Awareness ──────────────────────────────────────

  test("2.1: create_file stages in ChangeManager without touching physical disk", async () => {
    const cm = new ChangeManager(tempDir);
    const ctx = createMockToolContext(cm);

    const res = await createFileTool.execute(
      { path: "hello.txt", content: "Hello World!\n" },
      ctx,
    );

    assert.strictEqual(res.summary, "Created hello.txt");
    assert.strictEqual(cm.hasStaged("hello.txt"), true, "ChangeManager must have staged hello.txt");
    assert.strictEqual(
      fs.existsSync(path.join(tempDir, "hello.txt")),
      false,
      "Physical disk must NOT be written yet",
    );
    assert.strictEqual(await cm.readEffective("hello.txt"), "Hello World!\n");
  });

  test("2.2: create_file recognizes virtually staged file and rejects duplicate create without overwrite", async () => {
    const cm = new ChangeManager(tempDir);
    const ctx = createMockToolContext(cm);

    await createFileTool.execute({ path: "staged_file.txt", content: "v1" }, ctx);

    // Physical file still does NOT exist
    assert.strictEqual(fs.existsSync(path.join(tempDir, "staged_file.txt")), false);

    // Duplicate create without overwrite must fail
    await assert.rejects(
      async () => {
        await createFileTool.execute({ path: "staged_file.txt", content: "v2" }, ctx);
      },
      (err: any) => {
        assert.ok(err.message.includes("File already exists: staged_file.txt"));
        return true;
      },
    );

    // With overwrite: true, it succeeds
    const res = await createFileTool.execute(
      { path: "staged_file.txt", content: "v2", overwrite: true },
      ctx,
    );
    assert.strictEqual(res.summary, "Overwrote staged_file.txt");
    assert.strictEqual(await cm.readEffective("staged_file.txt"), "v2");
  });

  test("2.3: create then edit lifecycle", async () => {
    const cm = new ChangeManager(tempDir);
    const ctx = createMockToolContext(cm);

    await createFileTool.execute({ path: "calc.js", content: "const x = 1;\n" }, ctx);
    const editRes = await editFileTool.execute(
      { path: "calc.js", old_string: "const x = 1;", new_string: "const x = 42;" },
      ctx,
    );

    assert.strictEqual(editRes.isError, undefined);
    assert.strictEqual(await cm.readEffective("calc.js"), "const x = 42;\n");
    assert.strictEqual(fs.existsSync(path.join(tempDir, "calc.js")), false);

    // Apply to disk
    await cm.applyChangeSet();
    assert.strictEqual(fs.existsSync(path.join(tempDir, "calc.js")), true);
    assert.strictEqual(fs.readFileSync(path.join(tempDir, "calc.js"), "utf-8"), "const x = 42;\n");
  });

  // ─── 3. Delete File Overlay Awareness ──────────────────────────────────────

  test("3.1: delete_file can delete a staged virtual creation without physical stat error", async () => {
    const cm = new ChangeManager(tempDir);
    const ctx = createMockToolContext(cm);

    // Stage creation
    await createFileTool.execute({ path: "temp_virtual.txt", content: "transient" }, ctx);
    assert.strictEqual(cm.hasStaged("temp_virtual.txt"), true);
    assert.strictEqual(fs.existsSync(path.join(tempDir, "temp_virtual.txt")), false);

    // Delete virtual file
    const delRes = await deleteFileTool.execute({ path: "temp_virtual.txt" }, ctx);
    assert.strictEqual(delRes.content, "Deleted temp_virtual.txt.");

    // Should no longer exist
    assert.strictEqual(await cm.fileExists("temp_virtual.txt"), false);
    assert.strictEqual(cm.hasStaged("temp_virtual.txt"), false);

    // Second delete must fail with "Path does not exist"
    await assert.rejects(
      async () => {
        await deleteFileTool.execute({ path: "temp_virtual.txt" }, ctx);
      },
      (err: any) => {
        assert.ok(err.message.includes("Path does not exist: temp_virtual.txt"));
        return true;
      },
    );
  });

  test("3.2: delete_file stages deletion of physical file and edited file", async () => {
    const diskPath = path.join(tempDir, "physical_del.txt");
    fs.writeFileSync(diskPath, "physical content", "utf-8");

    const cm = new ChangeManager(tempDir);
    const ctx = createMockToolContext(cm);

    // Edit first
    await editFileTool.execute(
      { path: "physical_del.txt", old_string: "physical content", new_string: "edited content" },
      ctx,
    );
    assert.strictEqual(await cm.readEffective("physical_del.txt"), "edited content");

    // Now delete
    await deleteFileTool.execute({ path: "physical_del.txt" }, ctx);
    assert.strictEqual(await cm.fileExists("physical_del.txt"), false);
    assert.strictEqual(cm.getDeletedPaths().includes("physical_del.txt"), true);

    // Disk still untouched until apply
    assert.strictEqual(fs.existsSync(diskPath), true);

    // Apply
    await cm.applyChangeSet();
    assert.strictEqual(fs.existsSync(diskPath), false, "File must be deleted from disk upon apply");
  });

  // ─── 4. Rename File Overlay Awareness ──────────────────────────────────────

  test("4.1: rename_file can rename a virtually created file without physical stat error", async () => {
    const cm = new ChangeManager(tempDir);
    const ctx = createMockToolContext(cm);

    // Stage creation
    await createFileTool.execute({ path: "initial.ts", content: "export const num = 10;\n" }, ctx);
    assert.strictEqual(fs.existsSync(path.join(tempDir, "initial.ts")), false);

    // Rename virtually created file
    const renRes = await renameFileTool.execute({ from: "initial.ts", to: "final.ts" }, ctx);
    assert.strictEqual(renRes.summary, "Renamed → final.ts");

    // Old path does not exist, new path exists
    assert.strictEqual(await cm.fileExists("initial.ts"), false);
    assert.strictEqual(await cm.fileExists("final.ts"), true);
    assert.strictEqual(await cm.readEffective("final.ts"), "export const num = 10;\n");

    // Edit renamed file
    await editFileTool.execute(
      { path: "final.ts", old_string: "num = 10;", new_string: "num = 99;" },
      ctx,
    );
    assert.strictEqual(await cm.readEffective("final.ts"), "export const num = 99;\n");

    // Apply
    await cm.applyChangeSet();
    assert.strictEqual(fs.existsSync(path.join(tempDir, "initial.ts")), false);
    assert.strictEqual(fs.existsSync(path.join(tempDir, "final.ts")), true);
    assert.strictEqual(fs.readFileSync(path.join(tempDir, "final.ts"), "utf-8"), "export const num = 99;\n");
  });

  test("4.2: rename_file enforces destination conflict check in overlay", async () => {
    const cm = new ChangeManager(tempDir);
    const ctx = createMockToolContext(cm);

    await createFileTool.execute({ path: "source.txt", content: "src" }, ctx);
    await createFileTool.execute({ path: "target.txt", content: "tgt" }, ctx);

    // Rename without overwrite must fail
    await assert.rejects(
      async () => {
        await renameFileTool.execute({ from: "source.txt", to: "target.txt" }, ctx);
      },
      (err: any) => {
        assert.ok(err.message.includes("Destination already exists: target.txt"));
        return true;
      },
    );

    // Rename with overwrite: true succeeds
    const renRes = await renameFileTool.execute(
      { from: "source.txt", to: "target.txt", overwrite: true },
      ctx,
    );
    assert.strictEqual(renRes.summary, "Renamed → target.txt");
    assert.strictEqual(await cm.readEffective("target.txt"), "src");
  });

  // ─── 5. Effective Virtual Filesystem Inspection ────────────────────────────

  test("5.1: list_files and search_workspace inspect effective overlay state", async () => {
    const f1 = path.join(tempDir, "existing.txt");
    fs.writeFileSync(f1, "apple orange banana\n", "utf-8");

    const cm = new ChangeManager(tempDir);
    const ctx = createMockToolContext(cm);

    // Virtual create
    await createFileTool.execute({ path: "virtual.txt", content: "kiwi pineapple strawberry\n" }, ctx);
    // Virtual delete
    await deleteFileTool.execute({ path: "existing.txt" }, ctx);

    // 1. list_files shows virtual.txt and excludes existing.txt
    const listRes = await listFilesTool.execute({ path: "." }, ctx);
    assert.ok(listRes.content.includes("virtual.txt"), "list_files must include virtual.txt");
    assert.ok(!listRes.content.includes("existing.txt"), "list_files must exclude deleted existing.txt");

    // 2. search_workspace searches virtual.txt and ignores existing.txt
    const searchKiwi = await searchWorkspaceTool.execute({ query: "kiwi" }, ctx);
    assert.ok(searchKiwi.content.includes("virtual.txt"), "search must find virtual.txt content");

    const searchBanana = await searchWorkspaceTool.execute({ query: "banana" }, ctx);
    assert.ok(
      searchBanana.content.includes('No matches for "banana"'),
      `search must not find deleted existing.txt, got: ${searchBanana.content}`,
    );
  });

  // ─── 6. Verification with DAXIOM_STAGED_DISK_SYNC ──────────────────────────

  test("6.1: run_command with DAXIOM_STAGED_DISK_SYNC temporarily materializes staged overlay", async () => {
    const oldSync = process.env.DAXIOM_STAGED_DISK_SYNC;
    process.env.DAXIOM_STAGED_DISK_SYNC = "1";

    try {
      // Create minimal package.json so npm test succeeds in temp directory
      fs.writeFileSync(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "phase8-test-pkg",
          scripts: {
            test: "node -e \"const fs = require('fs'); console.log(fs.readFileSync('verify_me.txt', 'utf-8'));\"",
          },
        }),
        "utf-8",
      );

      const cm = new ChangeManager(tempDir);
      const ctx = createMockToolContext(cm);

      // Create a test file in staging overlay
      await createFileTool.execute(
        { path: "verify_me.txt", content: "SECRET_VERIFICATION_TOKEN_123" },
        ctx,
      );

      // Verify physical file does not exist yet
      assert.strictEqual(fs.existsSync(path.join(tempDir, "verify_me.txt")), false);

      const res = await runCommandTool.execute({ command: "npm test" }, ctx);
      assert.ok(
        res.content.includes("SECRET_VERIFICATION_TOKEN_123"),
        `Command must have executed against materialized file: ${res.content}`,
      );

      // Disk must be safely restored after command execution!
      assert.strictEqual(
        fs.existsSync(path.join(tempDir, "verify_me.txt")),
        false,
        "Disk must be restored after verification command",
      );
      assert.strictEqual(cm.hasStaged("verify_me.txt"), true, "ChangeManager must retain staged state");
    } finally {
      if (oldSync === undefined) {
        delete process.env.DAXIOM_STAGED_DISK_SYNC;
      } else {
        process.env.DAXIOM_STAGED_DISK_SYNC = oldSync;
      }
    }
  });

  // ─── 7. Session Isolation & Concurrency ────────────────────────────────────

  test("7.1: Multiple ChangeManager instances remain strictly isolated", async () => {
    const cm1 = new ChangeManager(tempDir);
    const cm2 = new ChangeManager(tempDir);

    cm1.stageCreate("session1.txt", "data 1");
    cm2.stageCreate("session2.txt", "data 2");

    assert.strictEqual(cm1.hasStaged("session1.txt"), true);
    assert.strictEqual(cm1.hasStaged("session2.txt"), false);

    assert.strictEqual(cm2.hasStaged("session2.txt"), true);
    assert.strictEqual(cm2.hasStaged("session1.txt"), false);

    assert.strictEqual(await cm1.readEffective("session1.txt"), "data 1");
    await assert.rejects(async () => {
      await cm1.readEffective("session2.txt");
    });
  });

  // ─── 8. Complete GUI Mutation Lifecycle ────────────────────────────────────

  test("8.1: Complete GUI lifecycle: create -> read -> edit -> verify -> changeSet -> apply", async () => {
    const cm = new ChangeManager(tempDir);
    const ctx = createMockToolContext(cm);

    // 1. User asks model to create file
    const createRes = await createFileTool.execute(
      { path: "app.ts", content: "export function run() { return 1; }\n" },
      ctx,
    );
    assert.strictEqual(createRes.summary, "Created app.ts");
    assert.strictEqual(fs.existsSync(path.join(tempDir, "app.ts")), false);

    // 2. Model reads created file
    const readRes = await readFileTool.execute({ path: "app.ts" }, ctx);
    assert.ok(readRes.content.includes("export function run() { return 1; }"));

    // 3. Model edits created file
    const editRes = await editFileTool.execute(
      { path: "app.ts", old_string: "return 1;", new_string: "return 42;" },
      ctx,
    );
    assert.strictEqual(editRes.summary, "Edited app.ts");

    // 4. Verify staged overlay
    assert.strictEqual(await cm.readEffective("app.ts"), "export function run() { return 42; }\n");

    // 5. Inspect unified ChangeSet
    const changeSet = cm.getChangeSet();
    assert.strictEqual(changeSet.length, 1);
    assert.strictEqual(changeSet[0].type, "create");
    assert.strictEqual(changeSet[0].path, "app.ts");
    assert.ok(changeSet[0].diff?.includes("+export function run() { return 42; }"));

    // 6. Atomic apply
    await cm.applyChangeSet();
    assert.strictEqual(fs.existsSync(path.join(tempDir, "app.ts")), true);
    assert.strictEqual(
      fs.readFileSync(path.join(tempDir, "app.ts"), "utf-8"),
      "export function run() { return 42; }\n",
    );
    assert.strictEqual(cm.hasStaged(), false, "ChangeManager must be cleared after apply");
  });
});
