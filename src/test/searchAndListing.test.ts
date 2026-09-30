import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import * as childProcess from "child_process";
import { searchWorkspaceTool } from "../tools/impl/searchWorkspace";
import { listFilesTool } from "../tools/impl/listFiles";
import { gitCloneTool, setExecFileForTesting, resetExecFileForTesting } from "../tools/impl/gitClone";
import { resolvePathInWorkspace } from "../tools/workspace";
import { ToolContext, ToolError } from "../tools/types";
import { checkBroadWorkspaceWarning, resetBroadWorkspaceWarning } from "../tools/workspaceSafety";

function createTestContext(tempDir: string): ToolContext {
  const rootUri = vscode.Uri.file(tempDir);
  return {
    workspaceRoot: rootUri,
    terminalAutoRun: true,
    autoEdit: true,
    confirm: async () => true,
    resolvePath: async (p: string) => resolvePathInWorkspace(p, rootUri, async () => false),
    toRelative: (uri: vscode.Uri) => path.relative(tempDir, uri.fsPath) || ".",
  };
}

suite("Hardened Workspace Search & File Listing", () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-search-test-"));
  });

  teardown(() => {
    delete process.env.SEARCH_MAX_FILE_BYTES;
    delete process.env.SEARCH_MAX_RESULTS;
    delete process.env.SEARCH_MAX_FILES;
    delete process.env.SEARCH_TIMEOUT_MS;
    delete process.env.SEARCH_IGNORE_DIRS;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("ignored directories are never traversed during search", async () => {
    const ctx = createTestContext(tempDir);

    // Root valid file
    fs.writeFileSync(path.join(tempDir, "valid.ts"), "const secret = 'MATCH_ME';\n");

    // Ignored directories
    const nodeModules = path.join(tempDir, "node_modules", "pkg");
    fs.mkdirSync(nodeModules, { recursive: true });
    fs.writeFileSync(path.join(nodeModules, "index.js"), "const secret = 'MATCH_ME';\n");

    const gitDir = path.join(tempDir, ".git");
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, "config"), "const secret = 'MATCH_ME';\n");

    const cacheDir = path.join(tempDir, ".cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "data.txt"), "const secret = 'MATCH_ME';\n");

    const venvDir = path.join(tempDir, ".venv");
    fs.mkdirSync(venvDir, { recursive: true });
    fs.writeFileSync(path.join(venvDir, "lib.py"), "const secret = 'MATCH_ME';\n");

    const res = await searchWorkspaceTool.execute({ query: "MATCH_ME" }, ctx);
    assert.ok(res.content.includes("valid.ts"), "Should find valid.ts");
    assert.ok(!res.content.includes("node_modules"), "Should NOT traverse node_modules");
    assert.ok(!res.content.includes(".git"), "Should NOT traverse .git");
    assert.ok(!res.content.includes(".cache"), "Should NOT traverse .cache");
    assert.ok(!res.content.includes(".venv"), "Should NOT traverse .venv");
  });

  test("files over the size limit are skipped before reading", async () => {
    const ctx = createTestContext(tempDir);

    // Set limit to 50 KB
    process.env.SEARCH_MAX_FILE_BYTES = "51200";

    // Small file (1 KB)
    fs.writeFileSync(path.join(tempDir, "small.txt"), "TARGET_SIZE_TOKEN\n".repeat(50));

    // Large file (100 KB)
    fs.writeFileSync(path.join(tempDir, "large.txt"), "TARGET_SIZE_TOKEN\n".repeat(6000));

    const res = await searchWorkspaceTool.execute({ query: "TARGET_SIZE_TOKEN" }, ctx);
    assert.ok(res.content.includes("small.txt"), "Small file must be searched");
    assert.ok(!res.content.includes("large.txt"), "File over size limit must be skipped");
  });

  test("binary files and files with NUL byte are skipped", async () => {
    const ctx = createTestContext(tempDir);

    // Text file
    fs.writeFileSync(path.join(tempDir, "normal.txt"), "HELLO_BINARY_TEST\n");

    // File with NUL byte in first 4KB
    const buf = Buffer.from("HELLO_BINARY_TEST with NUL \0 in body");
    fs.writeFileSync(path.join(tempDir, "with_nul.txt"), buf);

    // Binary extension (.png)
    fs.writeFileSync(path.join(tempDir, "image.png"), "HELLO_BINARY_TEST");

    const res = await searchWorkspaceTool.execute({ query: "HELLO_BINARY_TEST" }, ctx);
    assert.ok(res.content.includes("normal.txt"), "Normal text file should match");
    assert.ok(!res.content.includes("with_nul.txt"), "File with NUL byte must be skipped");
    assert.ok(!res.content.includes("image.png"), "PNG file must be skipped");
  });

  test("per-file and total match caps with truncation note", async () => {
    const ctx = createTestContext(tempDir);

    // 15 matches in one file -> capped at 10 matches per file
    const lines = Array.from({ length: 15 }, (_, i) => `Line ${i + 1}: KEYWORD_REPEAT`).join("\n");
    fs.writeFileSync(path.join(tempDir, "many_matches.txt"), lines);

    const res = await searchWorkspaceTool.execute({ query: "KEYWORD_REPEAT" }, ctx);
    assert.ok(res.content.includes("[results truncated:"), "Must include truncation note");
    assert.ok(res.content.includes("more matches not shown"), "Must mention matches not shown");

    // Count occurrences of filename in output
    const matchLines = res.content.split("\n").filter((l) => l.includes("many_matches.txt:"));
    assert.strictEqual(matchLines.length, 10, "Must be capped at 10 matches per file");

    // Test total matches cap
    for (let f = 1; f <= 5; f++) {
      const fLines = Array.from({ length: 8 }, (_, i) => `F${f} line ${i}: TOTAL_CAP_KEY`).join("\n");
      fs.writeFileSync(path.join(tempDir, `file_${f}.txt`), fLines);
    }
    const resTotal = await searchWorkspaceTool.execute(
      { query: "TOTAL_CAP_KEY", max_results: 15 },
      ctx,
    );
    const totalLines = resTotal.content.split("\n").filter((l) => l.includes("TOTAL_CAP_KEY"));
    assert.ok(totalLines.length <= 15, "Must respect global max_results cap");
    assert.ok(resTotal.content.includes("[results truncated:"), "Must include total truncation note");
  });

  test("max-files limit stops traversal and emits the note", async () => {
    const ctx = createTestContext(tempDir);
    process.env.SEARCH_MAX_FILES = "4";

    // Create 10 files
    for (let i = 1; i <= 10; i++) {
      fs.writeFileSync(path.join(tempDir, `item_${i}.txt`), "SEARCH_LIMIT_TOKEN\n");
    }

    const res = await searchWorkspaceTool.execute({ query: "SEARCH_LIMIT_TOKEN" }, ctx);
    assert.ok(
      res.content.includes("[search stopped: workspace too large, scanned 4 files; use a narrower path]"),
      `Expected max-files stop note, got: ${res.content}`,
    );
  });

  test("large file is searched without loading it fully into memory", async function () {
    this.timeout(10000);
    const ctx = createTestContext(tempDir);

    // Allow 60 MB files
    process.env.SEARCH_MAX_FILE_BYTES = String(60 * 1024 * 1024);

    const filePath = path.join(tempDir, "large_50mb.txt");
    const writeStream = fs.createWriteStream(filePath);

    // Write ~10 MB of lines (sufficient to prove stream reading and stop-at-cap)
    const lineChunk = "This is a regular repetitive line in the test file.\n".repeat(100); // ~5KB
    writeStream.write("STREAM_TARGET line 1\n");
    for (let i = 0; i < 2000; i++) {
      writeStream.write(lineChunk);
    }
    writeStream.write("STREAM_TARGET line 2\n");
    await new Promise<void>((resolve) => writeStream.end(resolve));

    const initialMem = process.memoryUsage().heapUsed;
    const res = await searchWorkspaceTool.execute({ query: "STREAM_TARGET" }, ctx);
    const postMem = process.memoryUsage().heapUsed;

    assert.ok(res.content.includes("STREAM_TARGET"), "Must find target in large file");
    // Ensure memory didn't explode (> 100MB growth)
    const memGrowthMb = (postMem - initialMem) / (1024 * 1024);
    assert.ok(memGrowthMb < 100, `Memory growth should remain bounded, was ${memGrowthMb.toFixed(1)}MB`);
  });

  test("list_files entry cap (500) and ignore list", async function () {
    this.timeout(10000);
    const ctx = createTestContext(tempDir);

    // Ignored directories should not be listed
    fs.mkdirSync(path.join(tempDir, "node_modules", "nested"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "node_modules", "a.txt"), "data");
    fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".git", "head"), "ref");

    // Create 550 files
    for (let i = 1; i <= 550; i++) {
      fs.writeFileSync(path.join(tempDir, `file_${String(i).padStart(4, "0")}.txt`), "");
    }

    const res = await listFilesTool.execute({ path: ".", depth: 2 }, ctx);
    assert.ok(!res.content.includes("node_modules"), "list_files must skip node_modules");
    assert.ok(!res.content.includes(".git"), "list_files must skip .git");
    assert.ok(
      res.content.includes("… truncated at 500 entries."),
      "list_files must cap at 500 entries with truncation note",
    );
  });

  test("git_clone: rejects non-https URLs, rejects non-empty destination, uses execFile array", async () => {
    const ctx = createTestContext(tempDir);

    // 1. Rejects non-https URL
    await assert.rejects(
      async () => {
        await gitCloneTool.execute({ url: "git@github.com:user/repo.git" }, ctx);
      },
      /Only HTTPS git URLs are allowed/,
      "Must reject non-https URLs",
    );

    await assert.rejects(
      async () => {
        await gitCloneTool.execute({ url: "http://github.com/user/repo.git" }, ctx);
      },
      /Only HTTPS git URLs are allowed/,
      "Must reject plain http URLs",
    );

    // 2. Rejects non-empty destination
    const existingFolder = path.join(tempDir, "already-exists");
    fs.mkdirSync(existingFolder);
    fs.writeFileSync(path.join(existingFolder, "some_file.txt"), "hello");

    await assert.rejects(
      async () => {
        await gitCloneTool.execute(
          { url: "https://github.com/org/repo.git", folder: "already-exists" },
          ctx,
        );
      },
      /already exists and is not empty/,
      "Must refuse non-empty destination folder",
    );

    // 3. Clones using execFile args array (mock childProcess.execFile)
    let interceptedCmd = "";
    let interceptedArgs: string[] = [];

    setExecFileForTesting((
      file: any,
      args: any,
      _opts: any,
      callback: any,
    ) => {
      interceptedCmd = file;
      interceptedArgs = args;
      // Mock successful clone by creating destination directory
      const destDir = args[args.length - 1];
      fs.mkdirSync(destDir, { recursive: true });
      callback(null, "", "");
      return {} as any;
    });

    try {
      const res = await gitCloneTool.execute(
        { url: "https://github.com/my-org/my-target-repo.git" },
        ctx,
      );

      assert.strictEqual(interceptedCmd, "git");
      assert.deepStrictEqual(interceptedArgs.slice(0, 3), ["clone", "--depth", "1"]);
      assert.strictEqual(interceptedArgs[3], "https://github.com/my-org/my-target-repo.git");
      assert.ok(interceptedArgs[4].endsWith("my-target-repo"));
      assert.ok(res.content.includes("Successfully cloned"));
    } finally {
      resetExecFileForTesting();
    }
  });

  test("Workspace safety guard: warns for broad locations without blocking", () => {
    resetBroadWorkspaceWarning();

    const home = os.homedir();
    const desktop = path.join(home, "Desktop");

    let warnedMsg: string | null = null;
    const warned = checkBroadWorkspaceWarning(desktop, (msg) => {
      warnedMsg = msg;
    });

    assert.ok(warned, "Should detect desktop as broad");
    assert.ok(Boolean(warnedMsg && (warnedMsg as string).includes("Workspace is very broad")), "Should format warning message");

    // Second check should be suppressed (one-time warning)
    const secondWarn = checkBroadWorkspaceWarning(desktop);
    assert.strictEqual(secondWarn, null, "Should only warn once");
  });
});
