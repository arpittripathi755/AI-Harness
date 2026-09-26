import * as assert from "assert";
import { LoopDetector } from "../agent/LoopDetector";
import { WorkspaceIsolation } from "../cli/workspaceIsolation";
import {
  Orchestrator,
  DEFAULT_BUDGET,
  detectRepoProfile,
  type TaskBudget,
} from "../agent/Orchestrator";

// ─── LoopDetector Tests ───────────────────────────────────────────────────────

suite("LoopDetector", () => {
  // --- Basic loop detection ---

  test("returns undefined for unique tool calls", () => {
    const d = new LoopDetector();
    assert.strictEqual(d.record("read_file", { path: "a.ts" }, "content A"), undefined);
    assert.strictEqual(d.record("read_file", { path: "b.ts" }, "content B"), undefined);
  });

  test("returns warn after 3 identical consecutive (name+args) calls", () => {
    const d = new LoopDetector();
    const args = { path: "same.ts" };
    d.record("read_file", args, "content");
    d.record("read_file", args, "content");
    const warning = d.record("read_file", args, "content");
    assert.ok(warning, "Expected a warning");
    assert.strictEqual(warning!.type, "warn");
    assert.strictEqual(warning!.repetitions, 3);
  });

  test("returns abort after 6 identical consecutive (name+args) calls", () => {
    const d = new LoopDetector();
    const args = { path: "stuck.ts" };
    let last;
    for (let i = 0; i < 6; i++) {
      last = d.record("read_file", args, "same result");
    }
    assert.ok(last, "Expected an abort");
    assert.strictEqual(last!.type, "abort");
    assert.strictEqual(last!.repetitions, 6);
  });

  test("same (name+args) with different result still triggers loop — args-only comparison", () => {
    const d = new LoopDetector();
    const args = { command: "git status" };
    // Different results (state changed) but same tool+args — should be detected
    d.record("run_command", args, "result A");
    d.record("run_command", args, "result B"); // different result, still same args
    const w = d.record("run_command", args, "result C");
    assert.ok(w, "Same name+args should trigger loop regardless of result");
    assert.strictEqual(w!.type, "warn");
  });

  test("recordSuccess clears consecutive count", () => {
    const d = new LoopDetector();
    const args = { path: "f.ts" };
    d.record("read_file", args, "same");
    d.record("read_file", args, "same");
    d.recordSuccess();
    const warning = d.record("read_file", args, "same");
    assert.strictEqual(warning, undefined, "Should reset after success");
  });

  test("reset clears all history", () => {
    const d = new LoopDetector();
    const args = { path: "x.ts" };
    d.record("read_file", args, "x");
    d.record("read_file", args, "x");
    d.reset();
    assert.strictEqual(d.size, 0);
    assert.strictEqual(d.record("read_file", args, "x"), undefined);
  });

  test("different tool names with same args do not trigger loop", () => {
    const d = new LoopDetector();
    const args = { path: "f.ts" };
    d.record("read_file", args, "content");
    d.record("edit_file", args, "content");
    const w = d.record("read_file", args, "content");
    assert.strictEqual(w, undefined, "Different tool names should not trigger loop");
  });

  test("same tool different args do not trigger loop", () => {
    const d = new LoopDetector();
    for (let i = 0; i < 5; i++) {
      const w = d.record("read_file", { path: `file${i}.ts` }, "content");
      assert.strictEqual(w, undefined);
    }
  });

  // --- Edit failure loop detection ---

  test("recordEditFailure returns false below threshold", () => {
    const d = new LoopDetector();
    assert.strictEqual(d.recordEditFailure("src/foo.ts"), false);
  });

  test("recordEditFailure returns true at threshold (2 consecutive failures)", () => {
    const d = new LoopDetector();
    d.recordEditFailure("src/foo.ts");
    assert.strictEqual(d.recordEditFailure("src/foo.ts"), true);
  });

  test("clearEditFailure resets counter for a file", () => {
    const d = new LoopDetector();
    d.recordEditFailure("src/foo.ts");
    d.clearEditFailure("src/foo.ts");
    assert.strictEqual(d.editFailureCount("src/foo.ts"), 0);
    assert.strictEqual(d.recordEditFailure("src/foo.ts"), false, "Counter should be reset");
  });

  test("edit failure counters are per-file (independent)", () => {
    const d = new LoopDetector();
    d.recordEditFailure("a.ts");
    d.recordEditFailure("b.ts");
    // Neither file has reached threshold yet (each has only 1 failure)
    assert.strictEqual(d.editFailureCount("a.ts"), 1);
    assert.strictEqual(d.editFailureCount("b.ts"), 1);
    // Second failure on a.ts should trigger
    assert.strictEqual(d.recordEditFailure("a.ts"), true);
    // b.ts still at 1
    assert.strictEqual(d.editFailureCount("b.ts"), 1);
  });

  test("recordSuccess clears edit failure counters", () => {
    const d = new LoopDetector();
    d.recordEditFailure("src/foo.ts");
    d.recordSuccess();
    assert.strictEqual(d.editFailureCount("src/foo.ts"), 0);
  });

  // --- Search near-duplicate detection ---

  test("recordFailedSearch returns false below threshold", () => {
    const d = new LoopDetector();
    assert.strictEqual(d.recordFailedSearch("Button component"), false);
    assert.strictEqual(d.recordFailedSearch("Button component"), false);
  });

  test("recordFailedSearch returns true at threshold (3 similar searches)", () => {
    const d = new LoopDetector();
    d.recordFailedSearch("Button component");
    d.recordFailedSearch("Button component");
    assert.strictEqual(d.recordFailedSearch("Button component"), true);
  });

  test("recordFailedSearch normalizes queries (case-insensitive)", () => {
    const d = new LoopDetector();
    d.recordFailedSearch("Button.tsx");
    d.recordFailedSearch("button.tsx");  // same after normalization
    assert.strictEqual(d.recordFailedSearch("BUTTON.TSX"), true, "Should normalize case");
  });

  test("clearSearchFailures resets all search tracking", () => {
    const d = new LoopDetector();
    d.recordFailedSearch("something");
    d.recordFailedSearch("something");
    d.clearSearchFailures();
    assert.strictEqual(d.recordFailedSearch("something"), false);
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

  test("sanitizes special characters in repo name", () => {
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

// ─── Orchestrator Tests ───────────────────────────────────────────────────────

suite("Orchestrator", () => {
  // --- Phase transitions ---

  test("starts in EXPLORING phase", () => {
    const o = new Orchestrator();
    assert.strictEqual(o.phase, "EXPLORING");
  });

  test("advances to EDITING on first mutation", () => {
    const o = new Orchestrator();
    o.onMutation("src/foo.ts");
    assert.strictEqual(o.phase, "EDITING");
  });

  test("advances to VERIFYING on verification after EDITING", () => {
    const o = new Orchestrator();
    o.onMutation("src/foo.ts");
    o.onVerification();
    assert.strictEqual(o.phase, "VERIFYING");
  });

  test("onVerification has no effect in EXPLORING phase", () => {
    const o = new Orchestrator();
    o.onVerification(); // no edits yet
    assert.strictEqual(o.phase, "EXPLORING");
  });

  test("markDone sets DONE from any phase", () => {
    const o = new Orchestrator();
    o.markDone();
    assert.strictEqual(o.phase, "DONE");
  });

  test("tracks edited files correctly", () => {
    const o = new Orchestrator();
    o.onMutation("src/a.ts");
    o.onMutation("src/b.ts");
    assert.ok(o.editedFiles.has("src/a.ts"));
    assert.ok(o.editedFiles.has("src/b.ts"));
    assert.strictEqual(o.editedFiles.size, 2);
  });

  // --- Budget enforcement ---

  test("returns undefined below soft budget threshold", () => {
    const budget: TaskBudget = { maxToolCalls: 10, maxRuntimeMs: 0 };
    const o = new Orchestrator(budget);
    for (let i = 0; i < 6; i++) {
      assert.strictEqual(o.onToolCall(), undefined); // 60% — no warn yet
    }
  });

  test("returns warn at 70% of tool call budget", () => {
    const budget: TaskBudget = { maxToolCalls: 10, maxRuntimeMs: 0 };
    const o = new Orchestrator(budget);
    for (let i = 0; i < 6; i++) o.onToolCall();
    const warn = o.onToolCall(); // 7/10 = 70%
    assert.ok(warn, "Expected a budget warning at 70%");
    assert.strictEqual(warn!.type, "warn");
  });

  test("returns abort at 100% of tool call budget", () => {
    const budget: TaskBudget = { maxToolCalls: 5, maxRuntimeMs: 0 };
    const o = new Orchestrator(budget);
    let status;
    for (let i = 0; i < 5; i++) {
      status = o.onToolCall();
    }
    assert.ok(status, "Expected abort at budget limit");
    assert.strictEqual(status!.type, "abort");
    assert.strictEqual(status!.reason, "tool_calls");
  });

  test("budget abort in EXPLORING phase includes explanation in summary", () => {
    const budget: TaskBudget = { maxToolCalls: 1, maxRuntimeMs: 0 };
    const o = new Orchestrator(budget);
    o.onToolCall(); // triggers abort
    const summary = o.buildBudgetExhaustedSummary();
    assert.ok(summary.includes("EXPLORING"), "Summary should mention EXPLORING phase");
    assert.ok(summary.includes("No file changes"), "Should mention no changes made");
  });

  test("budget abort with edits mentions modified files in summary", () => {
    const budget: TaskBudget = { maxToolCalls: 1, maxRuntimeMs: 0 };
    const o = new Orchestrator(budget);
    o.onMutation("src/main.ts");
    o.onToolCall();
    const summary = o.buildBudgetExhaustedSummary();
    assert.ok(summary.includes("src/main.ts"), "Should list modified files");
  });

  test("warn only fires once (not on every subsequent call)", () => {
    const budget: TaskBudget = { maxToolCalls: 10, maxRuntimeMs: 0 };
    const o = new Orchestrator(budget);
    for (let i = 0; i < 7; i++) o.onToolCall(); // first 7: triggers warn at 7
    // Call 8 and 9 should NOT be another warn (already fired)
    const r8 = o.onToolCall();
    const r9 = o.onToolCall();
    assert.ok(!r8 || r8.type !== "warn", "Second call should not re-warn");
    assert.ok(!r9 || r9.type !== "warn", "Third call should not re-warn");
  });

  // --- Repo profile detection ---

  test("detectRepoProfile returns null test/build commands for empty dir", () => {
    const profile = detectRepoProfile("/tmp");
    assert.strictEqual(profile.testCommand, null);
    assert.strictEqual(profile.buildCommand, null);
    assert.strictEqual(profile.packageManager, "none");
  });

  test("detectRepoProfile detects npm test from this repo", () => {
    // The AI-Harness repo itself has a package.json with "test" script
    const profile = detectRepoProfile(
      require("path").join(__dirname, "..", ".."),
    );
    assert.ok(profile.testCommand !== null, "Should detect npm test");
    assert.ok(profile.testCommand!.includes("test"), "Test command should include 'test'");
  });
});
