import * as fs from "fs";
import * as path from "path";

// ─── Task Phase ───────────────────────────────────────────────────────────────

/**
 * Explicit lifecycle phases for a single agent task.
 *
 * EXPLORING  – reading, searching, understanding the codebase
 * EDITING    – actively making file changes
 * VERIFYING  – running tests/build/lint after edits
 * DONE       – agent has declared the task complete
 */
export type TaskPhase =
  | "EXPLORING"
  | "PLANNING"
  | "EDITING"
  | "VERIFYING"
  | "REVIEWING"
  | "COMMITTING"
  | "CREATING_PR"
  | "COMPLETED"
  | "DONE"
  | "BLOCKED"
  | "FAILED";

export const PHASE_LABELS: Record<TaskPhase, string> = {
  EXPLORING: "Exploring codebase",
  PLANNING: "Formulating plan",
  EDITING: "Editing files",
  VERIFYING: "Verifying changes",
  REVIEWING: "Reviewing change set",
  COMMITTING: "Creating commit",
  CREATING_PR: "Creating pull request",
  COMPLETED: "Completed",
  DONE: "Complete",
  BLOCKED: "Blocked",
  FAILED: "Failed",
};

// ─── Budget ───────────────────────────────────────────────────────────────────

export interface TaskBudget {
  /** Maximum number of tool calls for a single task (0 = unlimited). */
  maxToolCalls: number;
  /** Maximum wall-clock ms for a single task (0 = unlimited). */
  maxRuntimeMs: number;
}

export const DEFAULT_BUDGET: TaskBudget = {
  maxToolCalls: parseInt(process.env.DAXIOM_MAX_TOOL_CALLS ?? "200", 10),
  maxRuntimeMs: parseInt(process.env.DAXIOM_MAX_RUNTIME_MS ?? "900000", 10), // 15 min
};

// ─── Repo Profile ─────────────────────────────────────────────────────────────

/**
 * Lightweight per-workspace profile cached for the session.
 * Built once on first task; reused on follow-up tasks in the same workspace;
 * invalidated when the user switches workspace.
 */
export interface RepoProfile {
  workspacePath: string;
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "none";
  testCommand: string | null;
  buildCommand: string | null;
  lintCommand: string | null;
  defaultBranch: string | null;
  keyDirectories: string[];
  detectedAt: number;
}

/**
 * Detect a repository profile by inspecting package.json, Makefile, etc.
 * This is synchronous and fast (no network calls, no tool round-trips).
 */
export function detectRepoProfile(workspacePath: string): RepoProfile {
  let packageManager: RepoProfile["packageManager"] = "none";
  let testCommand: string | null = null;
  let buildCommand: string | null = null;
  let lintCommand: string | null = null;
  let defaultBranch: string | null = null;
  const keyDirectories: string[] = [];

  // Detect package manager
  if (fs.existsSync(path.join(workspacePath, "bun.lockb"))) {
    packageManager = "bun";
  } else if (fs.existsSync(path.join(workspacePath, "pnpm-lock.yaml"))) {
    packageManager = "pnpm";
  } else if (fs.existsSync(path.join(workspacePath, "yarn.lock"))) {
    packageManager = "yarn";
  } else if (fs.existsSync(path.join(workspacePath, "package-lock.json"))) {
    packageManager = "npm";
  }

  // Read package.json scripts
  const pkgPath = path.join(workspacePath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
        scripts?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      const pm = packageManager !== "none" ? packageManager : "npm";
      const run = `${pm} run`;

      if (scripts["test"]) testCommand = `${run} test`;
      else if (scripts["test:run"]) testCommand = `${run} test:run`;
      else if (scripts["jest"]) testCommand = `${run} jest`;

      if (scripts["build"]) buildCommand = `${run} build`;
      else if (scripts["compile"]) buildCommand = `${run} compile`;

      if (scripts["lint"]) lintCommand = `${run} lint`;
      else if (scripts["check"]) lintCommand = `${run} check`;
    } catch {
      // ignore parse errors
    }
  }

  // Fallback: check Makefile for test/build/lint targets
  if (!testCommand || !buildCommand) {
    const makefilePath = path.join(workspacePath, "Makefile");
    if (fs.existsSync(makefilePath)) {
      try {
        const makefile = fs.readFileSync(makefilePath, "utf-8");
        if (!testCommand && /^test:/m.test(makefile)) testCommand = "make test";
        if (!buildCommand && /^build:/m.test(makefile)) buildCommand = "make build";
        if (!lintCommand && /^lint:/m.test(makefile)) lintCommand = "make lint";
      } catch {
        // ignore
      }
    }
  }

  // Fallback: detect pytest, cargo, etc.
  if (!testCommand) {
    if (fs.existsSync(path.join(workspacePath, "pytest.ini")) ||
        fs.existsSync(path.join(workspacePath, "setup.cfg")) ||
        fs.existsSync(path.join(workspacePath, "pyproject.toml"))) {
      testCommand = "python -m pytest";
    } else if (fs.existsSync(path.join(workspacePath, "Cargo.toml"))) {
      testCommand = "cargo test";
      buildCommand ??= "cargo build";
    } else if (fs.existsSync(path.join(workspacePath, "go.mod"))) {
      testCommand = "go test ./...";
      buildCommand ??= "go build ./...";
    }
  }

  // Detect default git branch
  try {
    const headRef = fs.readFileSync(path.join(workspacePath, ".git", "HEAD"), "utf-8").trim();
    const match = headRef.match(/^ref: refs\/heads\/(.+)$/);
    if (match) defaultBranch = match[1];
  } catch {
    // not a git repo or HEAD unreadable
  }

  // Key directories (src, lib, tests, etc.)
  for (const dir of ["src", "lib", "pkg", "app", "test", "tests", "spec"]) {
    if (fs.existsSync(path.join(workspacePath, dir))) {
      keyDirectories.push(dir);
    }
  }

  return {
    workspacePath,
    packageManager,
    testCommand,
    buildCommand,
    lintCommand,
    defaultBranch,
    keyDirectories,
    detectedAt: Date.now(),
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Per-task state machine that tracks the current phase, budget consumption,
 * and which files were edited during this task.
 *
 * The CLI creates a new Orchestrator for each user task (not each tool call).
 * It is read by ChatSession to inject phase context into the system prompt
 * and to gate the handoff to ChangeSet review.
 */
export class Orchestrator {
  private _phase: TaskPhase = "EXPLORING";
  private toolCallCount = 0;
  private readonly startMs: number = Date.now();
  private readonly filesEdited = new Set<string>();
  private readonly filesReadSet = new Set<string>();
  private lastVerification: { command: string; success: boolean } | null = null;
  private budgetWarnFired = false;

  constructor(
    private readonly budget: TaskBudget = DEFAULT_BUDGET,
    private readonly repoProfile: RepoProfile | null = null,
  ) {}

  get phase(): TaskPhase {
    return this._phase;
  }

  get editedFiles(): ReadonlySet<string> {
    return this.filesEdited;
  }

  get readFiles(): ReadonlySet<string> {
    return this.filesReadSet;
  }

  get verificationResult(): { command: string; success: boolean } | null {
    return this.lastVerification;
  }

  get toolCalls(): number {
    return this.toolCallCount;
  }

  get elapsedMs(): number {
    return Date.now() - this.startMs;
  }

  /** Record a file read. */
  onRead(filePath: string): void {
    this.filesReadSet.add(filePath);
  }

  /** Record verification execution outcome. */
  onVerificationRun(command: string, success: boolean): void {
    this.lastVerification = { command, success };
  }

  // ─── Phase transitions ───────────────────────────────────────────────────

  /** Advance phase to PLANNING. */
  onPlanning(): void {
    if (this._phase === "EXPLORING") {
      this._phase = "PLANNING";
    }
  }

  /** Advance phase the moment a mutation is attempted (independent of success). */
  onMutationAttempt(filePath?: string): void {
    if (this._phase === "EXPLORING" || this._phase === "PLANNING") {
      this._phase = "EDITING";
    }
  }

  /** Record a successful mutation. */
  onMutation(filePath: string): void {
    this.filesEdited.add(filePath);
    if (this._phase === "EXPLORING" || this._phase === "PLANNING") {
      this._phase = "EDITING";
    }
  }

  /** Advance phase when the agent runs a verification command. */
  onVerification(): void {
    if (this._phase === "EDITING") {
      this._phase = "VERIFYING";
    }
  }

  /** Advance phase to reviewing changes. */
  onReview(): void {
    this._phase = "REVIEWING";
  }

  /** Advance phase to committing changes. */
  onCommit(): void {
    this._phase = "COMMITTING";
  }

  /** Advance phase to creating PR. */
  onCreatingPR(): void {
    this._phase = "CREATING_PR";
  }

  /** Mark task as completed. */
  markCompleted(): void {
    this._phase = "COMPLETED";
  }

  /** Mark task as done. */
  markDone(): void {
    this._phase = "DONE";
  }

  /** Mark task as blocked. */
  markBlocked(_reason?: string): void {
    this._phase = "BLOCKED";
  }

  /** Mark task as failed. */
  markFailed(_reason?: string): void {
    this._phase = "FAILED";
  }

  // ─── Budget ──────────────────────────────────────────────────────────────

  /**
   * Increment tool call count. Returns a string status message if the budget
   * is being approached or exhausted, otherwise undefined.
   */
  onToolCall(): BudgetStatus | undefined {
    this.toolCallCount++;
    const { maxToolCalls, maxRuntimeMs } = this.budget;

    // Hard abort checks
    if (maxToolCalls > 0 && this.toolCallCount >= maxToolCalls) {
      return { type: "abort", reason: "tool_calls", count: this.toolCallCount, max: maxToolCalls };
    }
    if (maxRuntimeMs > 0 && this.elapsedMs >= maxRuntimeMs) {
      return { type: "abort", reason: "timeout", elapsed: this.elapsedMs, max: maxRuntimeMs };
    }

    // Soft warn at 70%
    if (!this.budgetWarnFired) {
      const callPct = maxToolCalls > 0 ? this.toolCallCount / maxToolCalls : 0;
      const timePct = maxRuntimeMs > 0 ? this.elapsedMs / maxRuntimeMs : 0;
      if (callPct >= 0.7 || timePct >= 0.7) {
        this.budgetWarnFired = true;
        const detail =
          callPct >= 0.7
            ? `${this.toolCallCount}/${maxToolCalls} tool calls used`
            : `${Math.round(this.elapsedMs / 1000)}s/${maxRuntimeMs / 1000}s elapsed`;
        return {
          type: "warn",
          reason: callPct >= 0.7 ? "tool_calls" : "timeout",
          detail,
          phase: this._phase,
        };
      }
    }

    return undefined;
  }

  // ─── Repo profile helpers ────────────────────────────────────────────────

  /** Return the test command if the repo has one, null otherwise. */
  get testCommand(): string | null {
    return this.repoProfile?.testCommand ?? null;
  }

  get buildCommand(): string | null {
    return this.repoProfile?.buildCommand ?? null;
  }

  /** Format profile info for injection into the system prompt. */
  formatProfileForPrompt(): string {
    if (!this.repoProfile) return "";
    const lines: string[] = [];
    if (this.repoProfile.testCommand) {
      lines.push(`Test command: \`${this.repoProfile.testCommand}\``);
    }
    if (this.repoProfile.buildCommand) {
      lines.push(`Build command: \`${this.repoProfile.buildCommand}\``);
    }
    if (this.repoProfile.lintCommand) {
      lines.push(`Lint command: \`${this.repoProfile.lintCommand}\``);
    }
    if (this.repoProfile.defaultBranch) {
      lines.push(`Default branch: ${this.repoProfile.defaultBranch}`);
    }
    if (this.repoProfile.keyDirectories.length > 0) {
      lines.push(`Key directories: ${this.repoProfile.keyDirectories.join(", ")}`);
    }
    return lines.length > 0 ? lines.join("\n") : "";
  }

  /**
   * Build a graceful-stop summary for when the budget is exhausted.
   */
  buildBudgetExhaustedSummary(): string {
    const lines: string[] = [
      `[SYSTEM] Task budget exhausted after ${this.toolCallCount} tool calls / ${Math.round(this.elapsedMs / 1000)}s.`,
      `Current phase: ${this._phase}`,
    ];
    if (this.filesEdited.size > 0) {
      lines.push(`Files modified so far: ${Array.from(this.filesEdited).join(", ")}`);
    } else {
      lines.push("No file changes have been made yet.");
    }
    lines.push(
      "Please summarize what you have found/tried so far and what is blocking completion. " +
      "The user will decide how to proceed.",
    );
    return lines.join("\n");
  }
}

export interface BudgetStatus {
  type: "warn" | "abort";
  reason: "tool_calls" | "timeout";
  count?: number;
  max?: number;
  elapsed?: number;
  detail?: string;
  phase?: TaskPhase;
}
