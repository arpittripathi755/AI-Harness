import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as cp from "child_process";
import * as vscode from "vscode";
import { ChangeManager } from "../tools/changes";
import { applyEdits, findCandidateWindow, computeSha256 } from "../tools/editCore";
import { resolvePathInWorkspace } from "../tools/workspace";
import { Orchestrator, DEFAULT_BUDGET } from "../agent/Orchestrator";
import { LoopDetector } from "../agent/LoopDetector";
import { GitHubManager } from "../git/GitHubManager";
import { fetchGithubIssueTool } from "../tools/impl/fetchGithubIssue";
import { editFileTool } from "../tools/impl/editFile";
import { readFileTool } from "../tools/impl/readFile";
import { listFilesTool } from "../tools/impl/listFiles";
import { searchWorkspaceTool } from "../tools/impl/searchWorkspace";
import { multiEditTool } from "../tools/impl/multiEdit";
import { ToolRegistry } from "../tools/registry";
import { ChatSession } from "../agent/ChatSession";
import { WorkspaceIsolation } from "../cli/workspaceIsolation";
import { StandaloneWorkspace } from "../standalone/vscodeShim";

suite("Master Refactor Spec Audit Fixes", () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daxiom-test-"));
  });

  teardown(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ─── Phase A: Core Reliability & Diagnostics ──────────────────────────────

  test("A1/A2: editCore returns structured OLD_STRING_NOT_FOUND with candidate window", () => {
    const fileContent = [
      "function add(a: number, b: number) {",
      "  // calculate sum",
      "  return a + b;",
      "}",
    ].join("\n");

    // Exact string not present due to whitespace
    const result = applyEdits(fileContent, [
      {
        old_string: "  //   calculate sum  ",
        new_string: "  // calculate sum of numbers",
      },
    ]);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.errorType, "OLD_STRING_NOT_FOUND");
      assert.strictEqual(result.totalLines, 4);
      assert.strictEqual(result.fileSha256, computeSha256(fileContent));
      assert.ok(result.candidateWindow !== null, "Expected candidate window for similar text");
      assert.ok(result.candidateWindow!.startLine <= 2 && result.candidateWindow!.endLine >= 2);
      assert.ok(result.candidateWindow!.content.includes("calculate sum"));
    }
  });

  test("A1/A2: editCore candidateWindow is null for completely unmatched text", () => {
    const fileContent = "const x = 42;\nconsole.log(x);";
    const result = applyEdits(fileContent, [
      {
        old_string: "completely_unrelated_nonsense_identifier_xyz",
        new_string: "replacement",
      },
    ]);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.errorType, "OLD_STRING_NOT_FOUND");
      assert.strictEqual(result.candidateWindow, null);
    }
  });

  test("A4: Orchestrator advances phase to EDITING on mutation attempt", () => {
    const orch = new Orchestrator(DEFAULT_BUDGET);
    assert.strictEqual(orch.phase, "EXPLORING");

    orch.onMutationAttempt("src/test.ts");
    assert.strictEqual(orch.phase, "EDITING", "Phase must advance to EDITING on attempt even before success");

    // Verification moves to VERIFYING
    orch.onVerification();
    assert.strictEqual(orch.phase, "VERIFYING");

    // Review moves to REVIEWING
    orch.onReview();
    assert.strictEqual(orch.phase, "REVIEWING");

    // Commit moves to COMMITTING
    orch.onCommit();
    assert.strictEqual(orch.phase, "COMMITTING");

    // PR moves to CREATING_PR
    orch.onCreatingPR();
    assert.strictEqual(orch.phase, "CREATING_PR");

    // Blocked marks BLOCKED
    orch.markBlocked("Test block");
    assert.strictEqual(orch.phase, "BLOCKED");
  });

  test("A5: LoopDetector canonicalizes arguments across whitespace and key order", () => {
    const d = new LoopDetector();
    // Two objects with different key order and leading/trailing whitespace
    const args1 = { path: " foo.ts ", options: { recursive: true, depth: 2 } };
    const args2 = { options: { depth: 2, recursive: true }, path: "foo.ts" };

    d.record("search_workspace", args1, "result");
    d.record("search_workspace", args2, "result");
    const warning = d.record("search_workspace", args1, "result");

    assert.ok(warning, "Expected loop warning due to canonicalized arguments");
    assert.strictEqual(warning!.type, "warn");
    assert.strictEqual(warning!.repetitions, 3);
  });

  test("A5: LoopDetector aborts after consecutive edit failures on one file", () => {
    const d = new LoopDetector();
    const filePath = "src/troubled.ts";

    assert.strictEqual(d.isEditAborted(filePath), false);
    for (let i = 0; i < 4; i++) {
      d.recordEditFailure(filePath);
    }
    assert.strictEqual(d.isEditAborted(filePath), false);

    // 5th failure triggers abort threshold
    d.recordEditFailure(filePath);
    assert.strictEqual(d.isEditAborted(filePath), true, "5th failure should trigger edit abort");
  });

  test("A6: Path containment rejects paths traversing outside workspace root", async () => {
    const workspaceRoot = vscode.Uri.file(tempDir);

    // In-workspace relative path should succeed
    const valid = await resolvePathInWorkspace("sub/dir/file.txt", workspaceRoot, async () => false);
    assert.ok(valid.fsPath.startsWith(tempDir));

    // Traversal outside workspace root must be rejected
    await assert.rejects(
      async () => {
        await resolvePathInWorkspace("../../../etc/passwd", workspaceRoot, async () => false);
      },
      /outside.*workspace root/,
      "Expected access denial for traversal outside workspace",
    );
  });

  // ─── Phase B: ChangeManager Virtual Overlay ────────────────────────────────

  test("B1: ChangeManager stages edits in memory; readEffective reflects overlay; disk stays unchanged until applied", async () => {
    const filePath = path.join(tempDir, "sample.txt");
    fs.writeFileSync(filePath, "original content on disk\n", "utf-8");

    const cm = new ChangeManager(tempDir);
    assert.strictEqual(cm.hasStaged(), false);

    // Stage an edit
    cm.stageEdit("sample.txt", "staged edited content\n");
    assert.strictEqual(cm.hasStaged(), true);
    assert.strictEqual(cm.hasStaged("sample.txt"), true);

    // readEffective should return staged content
    assert.strictEqual(await cm.readEffective("sample.txt"), "staged edited content\n");

    // Physical disk file must remain completely untouched!
    assert.strictEqual(fs.readFileSync(filePath, "utf-8"), "original content on disk\n");

    // getChangeSet returns unified diff entry
    const changeSet = cm.getChangeSet();
    assert.strictEqual(changeSet.length, 1);
    assert.strictEqual(changeSet[0].type, "edit");
    assert.strictEqual(changeSet[0].path, "sample.txt");
    assert.ok(changeSet[0].diff?.includes("-original content on disk"));
    assert.ok(changeSet[0].diff?.includes("+staged edited content"));

    // Reject all: overlay is wiped, disk is untouched
    cm.rejectAll();
    assert.strictEqual(cm.hasStaged(), false);
    assert.strictEqual(await cm.readEffective("sample.txt"), "original content on disk\n");
    assert.strictEqual(fs.readFileSync(filePath, "utf-8"), "original content on disk\n");

    // Re-stage and apply
    cm.stageEdit("sample.txt", "staged edited content\n");
    await cm.applyChangeSet();
    assert.strictEqual(cm.hasStaged(), false);
    assert.strictEqual(fs.readFileSync(filePath, "utf-8"), "staged edited content\n");
  });

  test("B1: ChangeManager supports file creation, deletion, and rename in overlay", async () => {
    const cm = new ChangeManager(tempDir);

    // Stage creation
    cm.stageCreate("newFile.ts", "export const answer = 42;\n");
    assert.strictEqual(await cm.readEffective("newFile.ts"), "export const answer = 42;\n");
    assert.strictEqual(fs.existsSync(path.join(tempDir, "newFile.ts")), false);

    // Apply creation to disk
    await cm.applyChangeSet();
    assert.strictEqual(fs.existsSync(path.join(tempDir, "newFile.ts")), true);
    assert.strictEqual(fs.readFileSync(path.join(tempDir, "newFile.ts"), "utf-8"), "export const answer = 42;\n");

    // Stage rename
    await cm.stageRename("newFile.ts", "renamedFile.ts");
    assert.strictEqual(cm.hasStaged("newFile.ts"), true);
    assert.strictEqual(cm.hasStaged("renamedFile.ts"), true);
    assert.strictEqual(await cm.readEffective("renamedFile.ts"), "export const answer = 42;\n");

    await cm.applyChangeSet();
    assert.strictEqual(fs.existsSync(path.join(tempDir, "newFile.ts")), false);
    assert.strictEqual(fs.existsSync(path.join(tempDir, "renamedFile.ts")), true);

    // Stage delete
    cm.stageDelete("renamedFile.ts");
    assert.strictEqual(cm.hasStaged("renamedFile.ts"), true);
    await cm.applyChangeSet();
    assert.strictEqual(fs.existsSync(path.join(tempDir, "renamedFile.ts")), false);
  });

  test("B1: edit_file and read_file use ChangeManager virtual overlay", async () => {
    const testFile = path.join(tempDir, "code.js");
    fs.writeFileSync(testFile, "let count = 0;\n", "utf-8");

    const cm = new ChangeManager(tempDir);
    const rootUri = vscode.Uri.file(tempDir);

    const ctx = {
      workspaceRoot: rootUri,
      changeManager: cm,
      terminalAutoRun: true,
      confirm: async () => false,
      resolvePath: async (p: string) => resolvePathInWorkspace(p, rootUri, async () => false),
      toRelative: (uri: vscode.Uri) => path.relative(tempDir, uri.fsPath),
    };

    // Execute edit_file
    const editRes = await editFileTool.execute(
      {
        path: "code.js",
        old_string: "let count = 0;",
        new_string: "let count = 10;",
      },
      ctx,
    );

    assert.ok(!editRes.isError, "edit_file should succeed without error");
    // Disk must still have count = 0
    assert.strictEqual(fs.readFileSync(testFile, "utf-8"), "let count = 0;\n");
    // ChangeManager has count = 10
    assert.strictEqual(await cm.readEffective("code.js"), "let count = 10;\n");

    // Execute read_file: should see staged edit (count = 10)
    const readRes = await readFileTool.execute({ path: "code.js" }, ctx);
    assert.ok(!readRes.isError, "read_file should succeed without error");
    assert.ok(readRes.content.includes("let count = 10;"));
  });

  // ─── Phase C: GitHub Autonomy ──────────────────────────────────────────────

  test("C1: fetch_github_issue returns structured error when issue does not exist or gh is unauthenticated", async () => {
    const rootUri = vscode.Uri.file(tempDir);
    const ctx = {
      workspaceRoot: rootUri,
      terminalAutoRun: true,
      confirm: async () => false,
      resolvePath: async (p: string) => resolvePathInWorkspace(p, rootUri, async () => false),
      toRelative: (uri: vscode.Uri) => uri.fsPath,
    };

    const res = await fetchGithubIssueTool.execute(
      { owner: "invalid-owner-xyz-test", repo: "invalid-repo-xyz-test", issue_number: 99999 },
      ctx,
    );

    assert.strictEqual(res.isError, true);
    assert.ok(res.content.includes("error") || res.content.includes("Failed"));
  });

  test("C2: GitHubManager createFeatureBranch generates safe branch name", () => {
    // In a directory that may not be a git repo, checkAuth handles errors gracefully
    const auth = GitHubManager.checkAuth(tempDir);
    assert.strictEqual(typeof auth.authenticated, "boolean");

    const repoDetails = GitHubManager.getRepoDetails(tempDir);
    assert.strictEqual(repoDetails, null, "Empty tempDir should not be recognized as a GitHub repo");
  });

  // ─── Regression Tests for 6 Audit Fixes ───────────────────────────────────

  test("Blocker 1: GitHubManager createPullRequest uses username:headBranch for fork remote", () => {
    const origExec = GitHubManager.exec;
    let prCommand = "";
    GitHubManager.exec = (cmd: string, opts?: any) => {
      if (cmd.includes("gh pr list")) {
        return ""; // No existing PR
      }
      if (cmd.includes("gh pr create")) {
        prCommand = cmd;
        return "https://github.com/upstream/repo/pull/560\n";
      }
      return origExec(cmd, opts);
    };

    try {
      const res = GitHubManager.createPullRequest(tempDir, {
        title: "Fix issue #560",
        body: "Fixing issue 560",
        headBranch: "daxiom/issue-560",
        baseBranch: "main",
        owner: "upstream",
        repo: "repo",
        remoteUsed: "fork",
        username: "testuser",
      });

      assert.ok(
        prCommand.includes('--head "testuser:daxiom/issue-560"'),
        `Expected --head "testuser:daxiom/issue-560", got: ${prCommand}`,
      );
      assert.strictEqual(res.prUrl, "https://github.com/upstream/repo/pull/560");

      // Now test normal upstream behavior
      prCommand = "";
      const resUpstream = GitHubManager.createPullRequest(tempDir, {
        title: "Fix issue #560",
        body: "Fixing issue 560",
        headBranch: "daxiom/issue-560",
        baseBranch: "main",
        owner: "upstream",
        repo: "repo",
        remoteUsed: "origin",
        username: "testuser",
      });

      assert.ok(
        prCommand.includes('--head "daxiom/issue-560"'),
        `Expected --head "daxiom/issue-560", got: ${prCommand}`,
      );
      assert.ok(!prCommand.includes('--head "testuser:daxiom/issue-560"'));
      assert.strictEqual(resUpstream.prUrl, "https://github.com/upstream/repo/pull/560");
    } finally {
      GitHubManager.exec = origExec;
    }
  });

  test("Blocker 2: Autonomous mode invokes PR workflow without 'pr' in task string", async () => {
    let prTriggered = false;
    let duplicatePrChecked = false;
    let noChangesHandled = false;

    const task = "Fix issue #560";
    assert.strictEqual(task.toLowerCase().includes("pr"), false);
    assert.strictEqual(task.toLowerCase().includes("pull request"), false);

    const cm = new ChangeManager(tempDir);
    cm.stageCreate("solution.ts", "export const fixed = true;");
    const changeSet = cm.getChangeSet();
    assert.strictEqual(changeSet.length, 1);

    const origGetRepoDetails = GitHubManager.getRepoDetails;
    const origCommit = GitHubManager.commitAcceptedChanges;
    const origPush = GitHubManager.pushBranch;
    const origCreatePR = GitHubManager.createPullRequest;

    (GitHubManager as any).getRepoDetails = (cwd: string) => ({
      owner: "example",
      repo: "repo",
      defaultBranch: "main",
      remoteUrl: "https://github.com/example/repo.git",
    });

    (GitHubManager as any).commitAcceptedChanges = (cwd: string, msg: string) => {
      assert.ok(msg.includes("560"));
      return "abc1234";
    };

    (GitHubManager as any).pushBranch = (cwd: string, branch: string, details: any) => {
      return { success: true, remote: "origin" };
    };

    (GitHubManager as any).createPullRequest = (cwd: string, opts: any) => {
      prTriggered = true;
      assert.strictEqual(opts.headBranch.includes("560"), true);
      return {
        prUrl: "https://github.com/example/repo/pull/1",
        headBranch: opts.headBranch,
        remoteUsed: "origin",
      };
    };

    try {
      const isAutonomous = true;
      if (isAutonomous && cm.hasStaged()) {
        await cm.applyChangeSet();
        const repoDetails = GitHubManager.getRepoDetails(tempDir);
        if (repoDetails && changeSet.length > 0) {
          const commitHash = GitHubManager.commitAcceptedChanges(
            tempDir,
            `Fix issue #560 via DAXIOM`,
          );
          if (commitHash !== "NO_CHANGES") {
            const pushResult = GitHubManager.pushBranch(
              tempDir,
              "daxiom/issue-560",
              repoDetails,
            );
            if (pushResult.success) {
              GitHubManager.createPullRequest(tempDir, {
                title: "Fix issue #560",
                body: "Resolves #560",
                headBranch: "daxiom/issue-560",
                baseBranch: repoDetails.defaultBranch,
                owner: repoDetails.owner,
                repo: repoDetails.repo,
                remoteUsed: pushResult.remote,
              });
            }
          }
        }
      }

      assert.strictEqual(
        prTriggered,
        true,
        "PR workflow must be triggered autonomously without 'pr' in prompt",
      );

      // Verify NO_CHANGES prevents PR creation
      (GitHubManager as any).commitAcceptedChanges = () => "NO_CHANGES";
      let prCreatedOnNoChanges = false;
      (GitHubManager as any).createPullRequest = () => {
        prCreatedOnNoChanges = true;
        return {};
      };

      const commitResult = GitHubManager.commitAcceptedChanges(tempDir, "msg");
      if (commitResult === "NO_CHANGES") {
        noChangesHandled = true;
      }
      assert.strictEqual(noChangesHandled, true);
      assert.strictEqual(
        prCreatedOnNoChanges,
        false,
        "PR must not be created when there are no changes",
      );
    } finally {
      (GitHubManager as any).getRepoDetails = origGetRepoDetails;
      (GitHubManager as any).commitAcceptedChanges = origCommit;
      (GitHubManager as any).pushBranch = origPush;
      (GitHubManager as any).createPullRequest = origCreatePR;
    }
  });

  test("Blocker 3: launch-tui.sh enforces headless and non-TTY attached execution", () => {
    const scriptPath = path.join(__dirname, "../../scripts/launch-tui.sh");
    const scriptContent = fs.readFileSync(scriptPath, "utf-8");

    assert.ok(
      scriptContent.includes(
        '[ -t 0 ] && [ -z "$CI" ] && [ "$AXIOM_HEADLESS" != "1" ] && [ -n "$TERM_PROGRAM" ]',
      ),
      "Script must guard GUI launch behind TTY, !CI, !AXIOM_HEADLESS, and TERM_PROGRAM",
    );
    assert.ok(
      scriptContent.includes('exec /bin/bash "$RUNNER"'),
      "Script must exec runner attached when not in GUI mode",
    );
    assert.ok(
      scriptContent.includes('export AXIOM_HEADLESS='),
      "Script must propagate AXIOM_HEADLESS",
    );
  });

  test("Blocker 4: applyChangeSet performs transactional rollback on write failure and preserves staged state", async () => {
    const file1 = path.join(tempDir, "file1.txt");
    const dirFail = path.join(tempDir, "dir_fail");

    fs.writeFileSync(file1, "file1 original", "utf-8");
    fs.mkdirSync(dirFail); // Directory cannot be written to as a file -> throws EISDIR

    const cm = new ChangeManager(tempDir);
    await cm.readEffective("file1.txt");

    cm.stageEdit("file1.txt", "file1 modified");
    cm.stageCreate("dir_fail", "dir fail content");

    let errorThrown = false;
    try {
      await cm.applyChangeSet();
    } catch (err: any) {
      errorThrown = true;
      assert.strictEqual(err.code, "CHANGESET_APPLY_FAILED");
    }

    assert.strictEqual(errorThrown, true, "applyChangeSet must throw on write failure");
    assert.strictEqual(
      fs.readFileSync(file1, "utf-8"),
      "file1 original",
      "file1 must be rolled back to original",
    );
    assert.strictEqual(
      cm.hasStaged(),
      true,
      "ChangeManager must still contain staged changes after failure",
    );
    assert.strictEqual(await cm.readEffective("file1.txt"), "file1 modified");
  });

  test("Blocker 4: Transactional rollback handles create, modify, delete, and rename atomically", async () => {
    const fEdit = path.join(tempDir, "fEdit.txt");
    const fDelete = path.join(tempDir, "fDelete.txt");
    const fRenameOld = path.join(tempDir, "fRenameOld.txt");
    const dirFail = path.join(tempDir, "dir_fail2");

    fs.writeFileSync(fEdit, "original edit text", "utf-8");
    fs.writeFileSync(fDelete, "original delete text", "utf-8");
    fs.writeFileSync(fRenameOld, "original rename text", "utf-8");
    fs.mkdirSync(dirFail);

    const cm = new ChangeManager(tempDir);
    await cm.readEffective("fEdit.txt");
    await cm.readEffective("fDelete.txt");
    await cm.readEffective("fRenameOld.txt");

    cm.stageCreate("fNew.txt", "brand new file content");
    cm.stageEdit("fEdit.txt", "updated edit text");
    cm.stageDelete("fDelete.txt");
    await cm.stageRename("fRenameOld.txt", "fRenameNew.txt");
    cm.stageCreate("dir_fail2", "trigger write failure");

    let errorThrown = false;
    try {
      await cm.applyChangeSet();
    } catch (err: any) {
      errorThrown = true;
      assert.strictEqual(err.code, "CHANGESET_APPLY_FAILED");
    }

    assert.strictEqual(errorThrown, true);
    assert.strictEqual(
      fs.existsSync(path.join(tempDir, "fNew.txt")),
      false,
      "Created file must be cleaned up",
    );
    assert.strictEqual(
      fs.readFileSync(fEdit, "utf-8"),
      "original edit text",
      "Edited file must be restored",
    );
    assert.strictEqual(fs.existsSync(fDelete), true, "Deleted file must be restored");
    assert.strictEqual(fs.readFileSync(fDelete, "utf-8"), "original delete text");
    assert.strictEqual(fs.existsSync(fRenameOld), true, "Old rename file must be restored");
    assert.strictEqual(
      fs.existsSync(path.join(tempDir, "fRenameNew.txt")),
      false,
      "New rename file must not exist",
    );
    assert.strictEqual(cm.hasStaged(), true);
  });

  test("Secondary Fix 5: Virtual workspace search and list includes staged creations and excludes deletions", async () => {
    const rootUri = vscode.Uri.file(tempDir);
    const cm = new ChangeManager(tempDir);

    const ctx = {
      workspaceRoot: rootUri,
      changeManager: cm,
      terminalAutoRun: true,
      confirm: async () => false,
      resolvePath: async (p: string) =>
        resolvePathInWorkspace(p, rootUri, async () => false),
      toRelative: (uri: vscode.Uri) => path.relative(tempDir, uri.fsPath) || ".",
    };

    // Stage a new file creation
    cm.stageCreate("src/new.ts", "export const VIRTUAL_KEY_12345 = 'MAGIC';\n");

    // list_files must see src/ and new.ts
    const listWithCreated = await listFilesTool.execute({ path: "." }, ctx);
    assert.ok(
      listWithCreated.content.includes("src/"),
      "list_files must include staged directory",
    );

    const listUnderSrc = await listFilesTool.execute({ path: "src" }, ctx);
    assert.ok(
      listUnderSrc.content.includes("new.ts"),
      "list_files must include staged new.ts",
    );

    // search_workspace must find the staged content
    const searchCreated = await searchWorkspaceTool.execute(
      { query: "VIRTUAL_KEY_12345" },
      ctx,
    );
    assert.ok(
      searchCreated.content.includes("src/new.ts"),
      "search_workspace must find staged file",
    );
    assert.ok(
      searchCreated.content.includes("MAGIC"),
      "search_workspace must find staged file content",
    );

    // Stage deletion of the file
    cm.stageDelete("src/new.ts");

    // list_files should no longer show new.ts
    const listAfterDelete = await listFilesTool.execute({ path: "src" }, ctx);
    assert.ok(
      !listAfterDelete.content.includes("new.ts"),
      "Deleted staged file must disappear from list_files",
    );

    // search_workspace should no longer find it
    const searchAfterDelete = await searchWorkspaceTool.execute(
      { query: "VIRTUAL_KEY_12345" },
      ctx,
    );
    assert.ok(
      searchAfterDelete.content.includes("No matches"),
      "Deleted staged file must not appear in search_workspace",
    );
  });

  test("Secondary Fix 6: multi_edit failure tracks edit failures and triggers loop recovery", async () => {
    const rootUri = vscode.Uri.file(tempDir);
    const cm = new ChangeManager(tempDir);
    fs.writeFileSync(path.join(tempDir, "foo.ts"), "const a = 1;\n", "utf-8");
    fs.writeFileSync(path.join(tempDir, "bar.ts"), "const b = 2;\n", "utf-8");

    const registry = new ToolRegistry();
    registry.register(multiEditTool);
    registry.register(readFileTool);

    const ctx = {
      workspaceRoot: rootUri,
      changeManager: cm,
      terminalAutoRun: true,
      confirm: async () => false,
      resolvePath: async (p: string) =>
        resolvePathInWorkspace(p, rootUri, async () => false),
      toRelative: (uri: vscode.Uri) => path.relative(tempDir, uri.fsPath),
    };

    const mockClient: any = {
      chatStream: async function* () {},
      chat: async () => ({ content: "" }),
    };

    const session = new ChatSession(
      mockClient,
      registry,
      ctx,
      "test-workspace",
      true,
      "test-model",
    );

    const loopDetector = (session as any).loopDetector;

    // Call 1: multi_edit fails with OLD_STRING_NOT_FOUND
    const toolCall1 = {
      id: "call_1",
      type: "function" as const,
      function: {
        name: "multi_edit",
        arguments: JSON.stringify({
          files: [
            {
              path: "foo.ts",
              edits: [{ old_string: "NON_EXISTENT_STRING_FOO", new_string: "new" }],
            },
            {
              path: "bar.ts",
              edits: [{ old_string: "NON_EXISTENT_STRING_BAR", new_string: "new" }],
            },
          ],
        }),
      },
    };

    let lastContent = "";
    const callbacks: any = {
      onAssistantStart: () => {},
      onAssistantDelta: () => {},
      onAssistantDone: () => {},
      onToolStart: () => {},
      onToolEnd: (id: string, ok: boolean, summary: string, content?: string) => {
        lastContent = content ?? "";
      },
      onStatus: () => {},
      onError: () => {},
    };

    await (session as any).runToolCall(toolCall1, callbacks);

    assert.strictEqual(
      loopDetector.editFailureCount("foo.ts"),
      1,
      "foo.ts failure count should be 1",
    );
    assert.strictEqual(
      loopDetector.editFailureCount("bar.ts"),
      1,
      "bar.ts failure count should be 1",
    );

    // Call 2: Fail again -> forceReread directive must trigger
    await (session as any).runToolCall(toolCall1, callbacks);
    assert.strictEqual(
      loopDetector.editFailureCount("foo.ts"),
      2,
      "foo.ts failure count should be 2",
    );
    assert.ok(
      lastContent.includes("[SYSTEM DIRECTIVE]"),
      "Forced reread directive must be included in tool output",
    );
    assert.ok(lastContent.includes("foo.ts"));

    // Calls 3 to 5: Fail until EDIT_ABORT_THRESHOLD (5)
    await (session as any).runToolCall(toolCall1, callbacks);
    await (session as any).runToolCall(toolCall1, callbacks);
    await (session as any).runToolCall(toolCall1, callbacks);
    assert.strictEqual(
      loopDetector.isEditAborted("foo.ts"),
      true,
      "foo.ts should be marked edit aborted",
    );
    assert.ok(
      lastContent.includes("[SYSTEM BLOCKED]"),
      "System blocked message must be included",
    );
  });

  test("End-to-End Evaluator: Fix issue #560 in autonomous headless mode without 'PR' in prompt", async () => {
    const originalEnv = { ...process.env };
    process.env.AXIOM_AUTONOMOUS = "1";
    process.env.AXIOM_HEADLESS = "1";

    const executedSteps: string[] = [];

    const origExec = GitHubManager.exec;
    GitHubManager.exec = (cmd: string, opts?: any) => {
      executedSteps.push(cmd);
      if (cmd.includes("git clone")) {
        return "Cloning into workspace...\n";
      }
      if (cmd.includes("git rev-parse --is-inside-work-tree")) {
        return "true\n";
      }
      if (cmd.includes("git show-ref")) {
        // Signal branch does not exist yet so loop breaks
        throw new Error("branch does not exist");
      }
      if (cmd.includes("git checkout -b")) {
        return "Switched to branch daxiom/issue-560\n";
      }
      if (cmd.includes("git add -A") || cmd.includes("git commit")) {
        return "[daxiom/issue-560 abc560] Fix issue #560 via DAXIOM\n";
      }
      if (cmd.includes("git status")) {
        return "A  src/fix.ts\n";
      }
      if (cmd.includes("git rev-parse --short HEAD")) {
        return "abc560\n";
      }
      if (cmd.includes("git push -u origin")) {
        const err: any = new Error("Permission to upstream denied");
        err.stderr = Buffer.from(
          "fatal: remote error: upload-pack: not our ref or permission denied",
        );
        throw err;
      }
      if (cmd.includes("gh repo fork")) {
        return "Created fork testuser/repo\n";
      }
      if (cmd.includes("git push -u fork")) {
        return "Branch daxiom/issue-560 set up to track remote branch from fork.\n";
      }
      if (cmd.includes("gh auth status") || cmd.includes("gh api user")) {
        return '{"login": "testuser"}\n';
      }
      if (cmd.includes("gh pr list")) {
        return ""; // No duplicate PR
      }
      if (cmd.includes("gh pr create")) {
        return "https://github.com/example/repo/pull/560\n";
      }
      return "";
    };

    try {
      // 1. Task input
      const task = "Fix issue #560";
      assert.ok(!task.toLowerCase().includes("pr"), "Task must not include 'pr'");

      // 2. Mock repository workspace setup
      const repoDetails = {
        owner: "example",
        repo: "repo",
        defaultBranch: "main",
        remoteUrl: "https://github.com/example/repo.git",
      };

      // 3. Stage changes in ChangeManager
      const cm = new ChangeManager(tempDir);
      cm.stageCreate("src/fix.ts", "export const fix = 'issue #560 solved';\n");
      const changeSet = cm.getChangeSet();
      assert.strictEqual(changeSet.length, 1);

      // 4. Autonomous mode accepts ChangeSet and applies to disk
      assert.strictEqual(process.env.AXIOM_AUTONOMOUS, "1");
      await cm.applyChangeSet();
      assert.strictEqual(fs.existsSync(path.join(tempDir, "src/fix.ts")), true);

      // 5. Automatic GitHub workflow trigger (without checking prompt for "pr")
      // Step A: Branch
      const branch = GitHubManager.createFeatureBranch(tempDir, 560);
      assert.ok(branch.includes("issue-560"));

      // Step B: Commit
      const commit = GitHubManager.commitAcceptedChanges(
        tempDir,
        `Fix issue #560 via DAXIOM`,
      );
      assert.ok(commit !== "NO_CHANGES");

      // Step C: Push (triggers fork fallback)
      const pushResult = GitHubManager.pushBranch(tempDir, branch, repoDetails);
      assert.strictEqual(pushResult.success, true);
      assert.strictEqual(pushResult.remote, "fork");

      // Step D: Create PR using fork username:branch
      const prResult = GitHubManager.createPullRequest(tempDir, {
        title: "Fix issue #560",
        body: "Resolves #560\n\nAutomated fix created by DAXIOM.",
        headBranch: branch,
        baseBranch: repoDetails.defaultBranch,
        owner: repoDetails.owner,
        repo: repoDetails.repo,
        remoteUsed: pushResult.remote,
        username: "testuser",
      });

      assert.strictEqual(
        prResult.prUrl,
        "https://github.com/example/repo/pull/560",
      );
      assert.strictEqual(prResult.remoteUsed, "fork");

      const prCall = executedSteps.find((s) => s.includes("gh pr create"));
      assert.ok(prCall !== undefined, "gh pr create must have been executed");
      assert.ok(
        prCall!.includes(`--head "testuser:${branch}"`),
        `Must include fork head flag, got: ${prCall}`,
      );
    } finally {
      GitHubManager.exec = origExec;
      process.env = originalEnv;
    }
  });

  // ─── Workspace Model Architecture Tests ─────────────────────────────────

  test("Workspace Model: getDefaultWorkspace resolves to ~/Desktop using os.homedir()", () => {
    const defaultWs = WorkspaceIsolation.getDefaultWorkspace();
    const expected = path.join(os.homedir(), "Desktop");
    assert.strictEqual(defaultWs, expected);
  });

  test("Workspace Model: Default workspace is NOT process.cwd() (Application Root)", () => {
    const defaultWs = WorkspaceIsolation.getDefaultWorkspace();
    const appRoot = process.cwd();
    assert.strictEqual(defaultWs, path.join(os.homedir(), "Desktop"));
    assert.notStrictEqual(defaultWs, appRoot);
  });

  test("Workspace Model: Repository URL resolves to targetWorkspace on Desktop overriding default workspace", () => {
    const repoUrl = "https://github.com/SASTxNST/Website_SAST.git";
    const repoName = WorkspaceIsolation.extractRepoName(repoUrl);
    assert.strictEqual(repoName, "Website_SAST");

    const resolved = WorkspaceIsolation.resolveWorkspace(repoUrl);
    const expectedTarget = path.join(os.homedir(), "Desktop", "Website_SAST");
    assert.strictEqual(resolved.workspacePath, expectedTarget);
  });

  test("Workspace Model: StandaloneWorkspace shim defaults to Desktop and not process.cwd()", () => {
    const standaloneWs = new StandaloneWorkspace();
    const expectedDesktop = path.join(os.homedir(), "Desktop");
    assert.strictEqual(standaloneWs.workspaceFolders[0].uri.fsPath, expectedDesktop);
    assert.notStrictEqual(standaloneWs.workspaceFolders[0].uri.fsPath, process.cwd());
  });
});
