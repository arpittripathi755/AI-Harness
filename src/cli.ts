#!/usr/bin/env node

import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import * as vscode from "vscode";
import { ChatSession } from "./agent/ChatSession";
import { ConversationManager } from "./agent/ConversationManager";
import { InMemoryMemento } from "./standalone/vscodeShim";
import { createToolRegistry } from "./tools";
import type { ToolContext } from "./tools/types";
import { ChangeManager } from "./tools/changes";
import { resolvePathInWorkspace, toRelative } from "./tools/workspace";
import { DEFAULT_BASE_URL } from "./config";
import {
  DEFAULT_MODEL_ID,
  getModelByApiId,
  MODELS,
  resolveModelId,
} from "./shared/models";
import { TerminalUI, colors } from "./cli/tui";
import { WorkspaceIsolation } from "./cli/workspaceIsolation";
import { GitHubManager } from "./git/GitHubManager";

function getCliApiKey(): string | undefined {
  return (
    process.env.AI_API_KEY?.trim() ||
    process.env.DEEPSEEK_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim()
  );
}

function getCliBaseUrl(): string {
  const raw =
    process.env.AI_BASE_URL?.trim() ||
    process.env.DEEPSEEK_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "") + "/";
}

function getCliModelId(): string {
  const raw = process.env.AI_MODEL?.trim() || process.env.MODEL_ID?.trim();
  return resolveModelId(raw);
}

async function main(): Promise<void> {
  const apiKey = getCliApiKey();
  if (!apiKey) {
    console.error("┌──────────────────────────────────────────────────────────────┐");
    console.error("│ ERROR: AI_API_KEY environment variable is not set.           │");
    console.error("│                                                              │");
    console.error("│ Please export your API key before running:                   │");
    console.error("│   export AI_API_KEY=\"<your-api-key>\"                         │");
    console.error("│   make run                                                   │");
    console.error("└──────────────────────────────────────────────────────────────┘");
    process.exit(1);
  }

  const baseUrl = getCliBaseUrl();
  let currentModelId = getCliModelId();
  let allowMutations = true; // Auto Edit is enabled by default in evaluation mode!

  // 1. Host / Application Root: where DAXIOM itself is installed.
  // This is ONLY the application runtime directory and must NOT be used as the coding workspace.
  const applicationRoot = process.cwd();
  void applicationRoot;

  // 2. Default Workspace: ~/Desktop when no repository is explicitly selected.
  // Never uses process.cwd() as the default coding workspace.
  const defaultWorkspace = WorkspaceIsolation.getDefaultWorkspace();
  const workspaceRoot = vscode.Uri.file(defaultWorkspace);
  (vscode.workspace as any).workspaceFolders = [
    {
      uri: workspaceRoot,
      name: path.basename(defaultWorkspace) || "Desktop",
      index: 0,
    },
  ];

  const tui = new TerminalUI();

  let currentWorkspaceRoot = workspaceRoot;
  let currentWorkspacePath = defaultWorkspace;
  let currentChangeManager = new ChangeManager(defaultWorkspace);
  let rl: readline.Interface | undefined;

  /**
   * Rebuild the ToolContext for a new workspace root.
   */
  function buildToolContext(root: vscode.Uri): ToolContext {
    currentChangeManager = new ChangeManager(root.fsPath);
    return {
      workspaceRoot: root,
      terminalAutoRun: true,
      autoEdit: true,
      changeManager: currentChangeManager,
      resolvePath: async (input: string) =>
        resolvePathInWorkspace(input, root, async () => false),
      toRelative: (uri: vscode.Uri) => toRelative(root, uri),
      confirm: async () => false,
    };
  }

  // Create autonomous tool context: zero confirmation blockers
  let toolContext: ToolContext = buildToolContext(workspaceRoot);

  const registry = createToolRegistry();
  const memento = new InMemoryMemento();
  const chats = new ConversationManager(memento);

  if (process.env.AXIOM_FRESH_SESSION === "1") {
    chats.create();
    currentChangeManager.clear();
  }

  const modelInfo = getModelByApiId(currentModelId);
  const modelDisplayName = modelInfo?.displayName ?? currentModelId;

  let session = ChatSession.create(
    { baseUrl, model: currentModelId, apiKey },
    registry,
    toolContext,
    path.basename(defaultWorkspace),
    allowMutations,
    chats.active.history,
  );

  /**
   * Clone a GitHub repository to the Desktop and switch the session workspace.
   * Returns the new workspace path, or undefined on failure.
   */
  async function switchToRepo(repoUrl: string): Promise<string | undefined> {
    tui.printNotice(`Resolving workspace for: ${repoUrl}`);
    try {
      const { workspacePath, existed } = WorkspaceIsolation.resolveWorkspace(repoUrl);

      if (!existed) {
        tui.printNotice(`Cloning into ${workspacePath} …`);
        WorkspaceIsolation.cloneRepository(repoUrl, workspacePath);
        tui.printNotice(`Cloned successfully.`);
      } else {
        tui.printNotice(`Using existing workspace: ${workspacePath}`);
      }

      // Switch VS Code workspace shim
      const newRoot = vscode.Uri.file(workspacePath);
      const repoName = path.basename(workspacePath);
      (vscode.workspace as any).workspaceFolders = [
        { uri: newRoot, name: repoName, index: 0 },
      ];

      toolContext = buildToolContext(newRoot);
      session.setWorkspace(toolContext, repoName);
      currentWorkspaceRoot = newRoot;
      currentWorkspacePath = workspacePath;

      tui.printNotice(`Workspace: ${workspacePath}`);
      return workspacePath;
    } catch (err: any) {
      tui.printError(`Failed to switch workspace: ${err.message || String(err)}`);
      return undefined;
    }
  }

  /**
   * Execute full Git branch, push, and PR creation workflow.
   */
  async function runPrWorkflow(taskDescription?: string): Promise<boolean> {
    const details = GitHubManager.getRepoDetails(currentWorkspacePath);
    if (!details) {
      tui.printError("Cannot create PR: current workspace is not a GitHub repository.");
      return false;
    }

    const auth = GitHubManager.checkAuth(currentWorkspacePath);
    if (!auth.authenticated) {
      tui.printError(`Cannot create PR: ${auth.error}`);
      return false;
    }

    tui.printNotice("Starting GitHub PR workflow...");

    // 1. If any staged changes remain, apply them first
    if (currentChangeManager.hasStaged()) {
      tui.printNotice("Applying staged changes before commit...");
      await currentChangeManager.applyChangeSet();
      tui.printNotice("✓ Changes applied to disk.");
    }

    // 2. Parse issue number if mentioned
    let issueNum: number | undefined;
    if (taskDescription) {
      const match = taskDescription.match(/#(\d+)/);
      if (match) {
        issueNum = parseInt(match[1], 10);
      }
    }

    // 3. Create feature branch
    tui.printNotice("Creating feature branch...");
    const branchName = GitHubManager.createFeatureBranch(currentWorkspacePath, issueNum);
    tui.printNotice(`✓ Switched to branch: ${branchName}`);

    // 4. Commit changes
    const commitMsg = issueNum
      ? `Fix issue #${issueNum} via DAXIOM`
      : (taskDescription ? `DAXIOM: ${taskDescription.slice(0, 50)}` : "Fix changes via DAXIOM");

    tui.printNotice("Committing changes...");
    const commitHash = GitHubManager.commitAcceptedChanges(currentWorkspacePath, commitMsg);
    if (commitHash === "NO_CHANGES") {
      tui.printNotice("No changes to commit.");
      return false;
    } else {
      tui.printNotice(`✓ Created commit: ${commitHash}`);
    }

    // 5. Push branch (upstream or fork fallback)
    tui.printNotice("Pushing branch...");
    const pushResult = GitHubManager.pushBranch(currentWorkspacePath, branchName, details);
    if (!pushResult.success) {
      tui.printError(`Push failed: ${pushResult.error}. Branch ${branchName} preserved locally.`);
      return false;
    }
    tui.printNotice(`✓ Pushed to remote: ${pushResult.remote}`);

    // 6. Create PR
    tui.printNotice("Creating pull request...");
    const prTitle = issueNum ? `Fix issue #${issueNum}` : (taskDescription?.slice(0, 70) || "DAXIOM automated changes");
    const prBody = issueNum
      ? `Resolves #${issueNum}\n\nAutomated fix created by DAXIOM.`
      : `Automated changes created by DAXIOM for task:\n> ${taskDescription || "code update"}`;

    const prResult = GitHubManager.createPullRequest(currentWorkspacePath, {
      title: prTitle,
      body: prBody,
      headBranch: branchName,
      baseBranch: details.defaultBranch,
      owner: details.owner,
      repo: details.repo,
      remoteUsed: pushResult.remote,
    });

    if (prResult.prUrl) {
      tui.printNotice(`✓ PR created: ${prResult.prUrl}`);
      return true;
    } else {
      tui.printError(prResult.error || "Failed to create PR. Branch and commit were preserved.");
      return false;
    }
  }

  /**
   * Helper to prompt the user during ChangeSet review.
   */
  function askReviewChoice(r: readline.Interface): Promise<string> {
    return new Promise((resolve) => {
      r.question(
        `\n${colors.bold}${colors.green}Select an option [1-3, default 2]: ${colors.reset}`,
        (answer) => {
          resolve(answer.trim() || "2");
        },
      );
    });
  }

  /**
   * Detect if a user message begins with a GitHub URL and auto-switch workspace.
   * Returns the remaining task text (URL stripped from prefix).
   */
  function extractRepoUrl(text: string): { repoUrl: string | undefined; taskText: string } {
    const match = text.match(
      /^(https?:\/\/(?:www\.)?github\.com\/[^\s]+(?:\.git)?)(?:\s+(.*))?$/si,
    );
    if (match) {
      return { repoUrl: match[1], taskText: (match[2] ?? "").trim() };
    }
    // Also handle git@github.com:user/repo.git at start
    const sshMatch = text.match(/^(git@github\.com:[^\s]+(?:\.git)?)(?:\s+(.*))?$/si);
    if (sshMatch) {
      return { repoUrl: sshMatch[1], taskText: (sshMatch[2] ?? "").trim() };
    }
    return { repoUrl: undefined, taskText: text };
  }

  // 3. Target Repository Workspace:
  // Auto-switch to repo if passed via REPO environment variable or --repo CLI flag
  let initialRepo = process.env.REPO?.trim();
  const rawArgs = process.argv.slice(2);
  const taskArgs: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--repo") {
      if (rawArgs[i + 1] && !rawArgs[i + 1].startsWith("--")) {
        initialRepo = rawArgs[i + 1].trim();
        i++;
      }
      continue;
    }
    if (arg.startsWith("--repo=")) {
      initialRepo = arg.slice("--repo=".length).trim();
      continue;
    }
    if (arg.startsWith("--")) {
      continue;
    }
    taskArgs.push(arg);
  }

  if (initialRepo) {
    await switchToRepo(initialRepo);
  }

  async function executeTurn(userText: string): Promise<boolean> {
    const trimmed = userText.trim();
    if (!trimmed) {
      return true; // empty input: stay in REPL
    }

    // Check for CLI slash commands
    if (trimmed.startsWith("/")) {
      const parts = trimmed.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(" ");

      if (cmd === "/exit" || cmd === "/quit") {
        return false;
      }
      if (cmd === "/diff") {
        if (!currentChangeManager.hasStaged()) {
          tui.printNotice("No staged changes in the current task.");
          return true;
        }
        const changeSet = currentChangeManager.getChangeSet();
        console.log(`\n${colors.bold}${colors.cyan}--- ChangeSet Preview (${changeSet.length} file${changeSet.length === 1 ? "" : "s"}) ---${colors.reset}`);
        for (const entry of changeSet) {
          console.log(`\n${colors.yellow}[${entry.type.toUpperCase()}]${colors.reset} ${entry.path}`);
          if (entry.diff) {
            console.log(entry.diff);
          }
        }
        return true;
      }
      if (cmd === "/status") {
        const phase = session.currentPhase ?? "EXPLORING";
        const readFiles = Array.from(session.readFiles);
        const stagedEntries = currentChangeManager.getChangeSet();
        const verification = session.verificationResult;
        const repoDetails = GitHubManager.getRepoDetails(currentWorkspacePath);
        const auth = GitHubManager.checkAuth(currentWorkspacePath);

        console.log(`\n${colors.bold}${colors.cyan}=== DAXIOM Status ===${colors.reset}`);
        console.log(`  ${colors.bold}Workspace:${colors.reset}    ${currentWorkspacePath}`);
        console.log(`  ${colors.bold}Phase:${colors.reset}        ${colors.yellow}${phase}${colors.reset}`);
        console.log(`  ${colors.bold}Model:${colors.reset}        ${modelDisplayName} (${currentModelId})`);
        console.log(`  ${colors.bold}Mode:${colors.reset}         ${allowMutations ? "Auto Edit (Autonomous)" : "Plan (Read-Only)"}`);
        console.log(`  ${colors.bold}Files Read:${colors.reset}   ${readFiles.length > 0 ? readFiles.join(", ") : "(none)"}`);
        console.log(`  ${colors.bold}Staged:${colors.reset}       ${stagedEntries.length > 0 ? stagedEntries.map(e => `${e.path} (${e.type})`).join(", ") : "(none)"}`);
        console.log(`  ${colors.bold}Verification:${colors.reset} ${verification ? `${verification.command} -> ${verification.success ? "PASSED" : "FAILED"}` : "(none run)"}`);
        if (repoDetails) {
          console.log(`  ${colors.bold}GitHub Repo:${colors.reset}  ${repoDetails.owner}/${repoDetails.repo} (${repoDetails.defaultBranch})`);
        }
        console.log(`  ${colors.bold}GitHub Auth:${colors.reset}  ${auth.authenticated ? `Logged in as @${auth.username}` : `Not authenticated (${auth.error})`}`);
        console.log("");
        return true;
      }
      if (cmd === "/clear") {
        if (currentChangeManager.hasStaged()) {
          currentChangeManager.rejectAll();
        }
        session.reset();
        tui.printNotice("Current task state and staged changes cleared. Phase reset to EXPLORING.");
        return true;
      }
      if (cmd === "/git") {
        const details = GitHubManager.getRepoDetails(currentWorkspacePath);
        if (!details) {
          tui.printNotice(`Not a Git repository: ${currentWorkspacePath}`);
          return true;
        }
        const auth = GitHubManager.checkAuth(currentWorkspacePath);
        console.log(`\n${colors.bold}${colors.cyan}=== Git Information ===${colors.reset}`);
        console.log(`  ${colors.bold}Remote:${colors.reset}         ${details.remoteUrl}`);
        console.log(`  ${colors.bold}Owner/Repo:${colors.reset}     ${details.owner}/${details.repo}`);
        console.log(`  ${colors.bold}Default Branch:${colors.reset} ${details.defaultBranch}`);
        console.log(`  ${colors.bold}Auth Status:${colors.reset}    ${auth.authenticated ? `@${auth.username}` : auth.error}`);
        console.log("");
        return true;
      }
      if (cmd === "/pr") {
        await runPrWorkflow(arg);
        return true;
      }
      if (cmd === "/plan") {
        allowMutations = false;
        toolContext.autoEdit = false;
        session.setMode(false);
        tui.printNotice("Switched to Plan Mode (Read-Only).");
        return true;
      }
      if (cmd === "/auto") {
        allowMutations = true;
        toolContext.autoEdit = true;
        session.setMode(true);
        tui.printNotice("Switched to Auto Edit Mode (Autonomous Execution).");
        return true;
      }
      if (cmd === "/model") {
        if (!arg) {
          tui.printNotice(`Current model: ${currentModelId}`);
          return true;
        }
        currentModelId = resolveModelId(arg);
        session.setModel(currentModelId);
        const name = getModelByApiId(currentModelId)?.displayName ?? currentModelId;
        tui.printNotice(`Model switched to: ${name} (${currentModelId})`);
        return true;
      }
      if (cmd === "/models") {
        tui.printNotice("Available models:\n" +
          MODELS.map((m) => `  - ${m.displayName} (${m.apiModelId})`).join("\n"));
        return true;
      }
      if (cmd === "/new") {
        session.cancel();
        chats.create();
        session.reset();
        currentChangeManager.clear();
        tui.printNotice("Started new conversation session.");
        return true;
      }
      if (cmd === "/help") {
        tui.printNotice(
          "Commands:\n" +
          "  /diff        - Preview staged ChangeSet diff\n" +
          "  /status      - Show session status, read/staged files, git & auth details\n" +
          "  /clear       - Clear current task state and discard staged overlay\n" +
          "  /pr          - Commit accepted changes, push branch, and create GitHub PR\n" +
          "  /git         - Show repository, branch, and remote details\n" +
          "  /auto        - Enable Auto Edit mode (autonomous execution, default)\n" +
          "  /plan        - Enable Plan mode (read-only inspection)\n" +
          "  /model <id>  - Switch model (ultra, deepseek-v4-pro, deepseek-flash)\n" +
          "  /models      - List available models\n" +
          "  /repo <url>  - Clone a GitHub repo to Desktop and switch workspace\n" +
          "  /new         - Start fresh conversation\n" +
          "  /exit, /quit - Exit Daxiom TUI\n" +
          "  /help        - Show this help message"
        );
        return true;
      }
      if (cmd === "/repo") {
        if (!arg) {
          tui.printError("Usage: /repo <github-url>");
          return true;
        }
        await switchToRepo(arg);
        return true;
      }
      tui.printError(`Unknown command: ${cmd}. Type /help for available commands.`);
      return true;
    }

    // Auto-detect GitHub URL at the start of the task and switch workspace
    const { repoUrl, taskText } = extractRepoUrl(trimmed);
    if (repoUrl) {
      const switched = await switchToRepo(repoUrl);
      if (!switched) {
        return true; // workspace switch failed; don't proceed
      }
      if (!taskText) {
        tui.printNotice(
          `Workspace switched. Describe your task for this repository.`,
        );
        return true;
      }
      return executeTurn(taskText);
    }

    // Normal task execution
    try {
      await session.send(trimmed, {
        onAssistantStart: () => tui.printAssistantStart(),
        onAssistantDelta: (_id, delta) => tui.printAssistantDelta(delta),
        onAssistantDone: () => tui.printAssistantDone(),
        onToolStart: (_callId, name, title) => tui.printToolStart(name, title),
        onToolEnd: (_callId, ok, summary, content) => {
          tui.printToolEnd(ok, summary, content);
        },
        onStatus: (status) => tui.printStatus(status),
        onPhaseChange: (phase) => tui.printPhase(phase),
        onError: (err) => {
          tui.printError(err);
        },
      });

      chats.active.history = session.exportHistory();
      chats.active.taskMemory = session.exportTaskMemory();
      chats.save();

      // ChangeSet review boundary
      if (currentChangeManager.hasStaged()) {
        const changeSet = currentChangeManager.getChangeSet();
        console.log(`\n${colors.bold}${colors.cyan}=== ChangeSet Review (${changeSet.length} file${changeSet.length === 1 ? "" : "s"}) ===${colors.reset}`);
        for (const entry of changeSet) {
          console.log(`  ${colors.yellow}[${entry.type.toUpperCase()}]${colors.reset} ${entry.path}`);
        }

        const isAutonomous =
          process.env.AXIOM_AUTONOMOUS === "1" ||
          !process.stdin.isTTY;

        if (isAutonomous) {
          tui.printNotice("Autonomous mode: Auto-applying staged changes...");
          await currentChangeManager.applyChangeSet();
          tui.printNotice("✓ Changes applied to disk.");

          const repoDetails = GitHubManager.getRepoDetails(currentWorkspacePath);
          if (repoDetails && changeSet.length > 0) {
            await runPrWorkflow(trimmed);
          }
        } else if (rl) {
          console.log(`\n${colors.bold}Options:${colors.reset}`);
          console.log("  [1] Accept & Create PR");
          console.log("  [2] Accept Only");
          console.log("  [3] Reject All");

          const choice = await askReviewChoice(rl);
          if (choice === "1") {
            await currentChangeManager.applyChangeSet();
            tui.printNotice("✓ Changes applied to disk.");
            await runPrWorkflow(trimmed);
          } else if (choice === "3") {
            currentChangeManager.rejectAll();
            tui.printNotice("Staged changes discarded. Zero disk modifications made.");
          } else {
            // Default: Accept Only
            await currentChangeManager.applyChangeSet();
            tui.printNotice("✓ Changes applied to disk.");
          }
        } else {
          // Non-interactive fallback
          await currentChangeManager.applyChangeSet();
          tui.printNotice("✓ Changes applied to disk.");
        }
      }
    } catch (err: any) {
      tui.printError(err.message || String(err));
    }

    // ALWAYS return true: task completion or tool errors must NOT close the REPL.
    // The only way to exit is via explicit /exit, /quit, or Ctrl+D.
    return true;
  }

  // Print TUI header with active workspace name (Desktop by default, or target repo if switched)
  tui.printHeader(allowMutations, modelDisplayName, currentWorkspacePath);

  console.log(`${colors.dim}  Application Root:  ${applicationRoot}${colors.reset}`);
  console.log(`${colors.dim}  Default Workspace: ${defaultWorkspace}${colors.reset}`);
  console.log(`${colors.dim}  Active Workspace:  ${currentWorkspacePath}${colors.reset}\n`);

  // Check if non-interactive input was provided via command line arguments
  if (taskArgs.length > 0) {
    const task = taskArgs.join(" ");
    console.log(`\n${colors.bold}${colors.cyan}Task:${colors.reset} ${task}\n`);
    const success = await executeTurn(task);
    process.exit(success ? 0 : 1);
  }

  // Check if non-interactive input was piped via stdin
  if (!process.stdin.isTTY) {
    let pipedInput = "";
    try {
      pipedInput = fs.readFileSync(0, "utf-8").trim();
    } catch {
      pipedInput = "";
    }
    if (pipedInput) {
      console.log(`\n${colors.bold}${colors.cyan}Task:${colors.reset} ${pipedInput}\n`);
      const success = await executeTurn(pipedInput);
      process.exit(success ? 0 : 1);
    }
  }

  // Interactive TUI prompt
  tui.printFooter("Enter task... (or /help)");

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: tui.printPromptPrefix(),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (
      trimmed === "/exit" ||
      trimmed === "/quit" ||
      trimmed === "exit" ||
      trimmed === "quit"
    ) {
      rl.close();
      return;
    }

    if (trimmed) {
      rl.pause();
      const continueLoop = await executeTurn(trimmed);
      if (!continueLoop) {
        rl.close();
        return;
      }
      rl.resume();
    }

    console.log("");
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(`\n${colors.dim}Exiting Daxiom. Goodbye!${colors.reset}`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
