import * as assert from "assert";
import { LoopDetector } from "../agent/LoopDetector";
import { WorkspaceIsolation } from "../cli/workspaceIsolation";

// ─── LoopDetector Tests ───────────────────────────────────────────────────────

suite("LoopDetector", () => {
  test("returns undefined for unique tool calls", () => {
    const d = new LoopDetector();
    assert.strictEqual(
      d.record("read_file", { path: "a.ts" }, "content A"),
      undefined,
    );
    assert.strictEqual(
      d.record("read_file", { path: "b.ts" }, "content B"),
      undefined,
    );
  });

  test("returns warn after 3 identical consecutive calls", () => {
    const d = new LoopDetector();
    const args = { path: "same.ts" };
    const result = "same content";
    d.record("read_file", args, result);
    d.record("read_file", args, result);
    const warning = d.record("read_file", args, result);
    assert.ok(warning, "Expected a warning");
    assert.strictEqual(warning!.type, "warn");
    assert.strictEqual(warning!.repetitions, 3);
  });

  test("returns abort after 6 identical consecutive calls", () => {
    const d = new LoopDetector();
    const args = { path: "stuck.ts" };
    const result = "error: not found";
    let last;
    for (let i = 0; i < 6; i++) {
      last = d.record("read_file", args, result);
    }
    assert.ok(last, "Expected an abort");
    assert.strictEqual(last!.type, "abort");
    assert.strictEqual(last!.repetitions, 6);
  });

  test("recordSuccess clears consecutive count", () => {
    const d = new LoopDetector();
    const args = { path: "f.ts" };
    const result = "same";
    d.record("read_file", args, result);
    d.record("read_file", args, result);
    d.recordSuccess(); // progress was made
    const warning = d.record("read_file", args, result);
    assert.strictEqual(warning, undefined, "Should reset after success");
  });

  test("reset clears all history", () => {
    const d = new LoopDetector();
    const args = { path: "x.ts" };
    const result = "x";
    d.record("read_file", args, result);
    d.record("read_file", args, result);
    d.reset();
    assert.strictEqual(d.size, 0);
    const warning = d.record("read_file", args, result);
    assert.strictEqual(warning, undefined);
  });

  test("different tools with same args do not trigger loop", () => {
    const d = new LoopDetector();
    const args = { path: "f.ts" };
    const result = "same result";
    d.record("read_file", args, result);
    d.record("edit_file", args, result);
    const w = d.record("read_file", args, result);
    assert.strictEqual(w, undefined, "Different tool names should not trigger loop");
  });

  test("same tool different args do not trigger loop", () => {
    const d = new LoopDetector();
    for (let i = 0; i < 5; i++) {
      const w = d.record("read_file", { path: `file${i}.ts` }, "content");
      assert.strictEqual(w, undefined);
    }
  });
});

// ─── WorkspaceIsolation Tests ─────────────────────────────────────────────────

suite("WorkspaceIsolation", () => {
  test("extracts repo name from HTTPS URL", () => {
    assert.strictEqual(
      WorkspaceIsolation.extractRepoName("https://github.com/user/my-repo.git"),
      "my-repo",
    );
  });

  test("extracts repo name from HTTPS URL without .git", () => {
    assert.strictEqual(
      WorkspaceIsolation.extractRepoName("https://github.com/org/awesome-project"),
      "awesome-project",
    );
  });

  test("extracts repo name from SSH URL", () => {
    assert.strictEqual(
      WorkspaceIsolation.extractRepoName("git@github.com:user/cool-repo.git"),
      "cool-repo",
    );
  });

  test("sanitizes special characters", () => {
    const name = WorkspaceIsolation.extractRepoName(
      "https://github.com/user/my repo with spaces",
    );
    assert.ok(!/\s/.test(name), "Should not contain spaces");
  });

  test("resolveWorkspace returns non-existent path for fresh repos", () => {
    const url = `https://github.com/test/nonexistent-repo-xyz-${Date.now()}`;
    const { workspacePath, existed } = WorkspaceIsolation.resolveWorkspace(url);
    assert.ok(workspacePath.includes("Desktop"), "Should be on Desktop");
    assert.strictEqual(existed, false);
  });

  test("isGitRepo returns false for non-git directory", () => {
    assert.strictEqual(WorkspaceIsolation.isGitRepo("/tmp"), false);
  });
});
