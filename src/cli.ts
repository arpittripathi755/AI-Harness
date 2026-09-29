#!/usr/bin/env node

if (typeof (process as any).loadEnvFile === "function") {
  try {
    (process as any).loadEnvFile();
  } catch {
    /* ignore missing or unreadable .env file */
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("[DAXIOM ERROR] Unhandled promise rejection:", reason instanceof Error ? reason.stack || reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[DAXIOM ERROR] Uncaught exception:", err instanceof Error ? err.stack || err.message : err);
});

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
import { checkBroadWorkspaceWarning } from "./tools/workspaceSafety";
import {
  getModelByApiId,
  getModelDisplayName,
  MODELS,
  resolveModelId,
  isOpenRouterModelId,
  getMaxTokens,
} from "./shared/models";
import { TerminalUI, colors } from "./cli/tui";
import { WorkspaceIsolation } from "./cli/workspaceIsolation";
import { GitHubManager } from "./git/GitHubManager";
import { LLMClient } from "./llm/LLMClient";
import {
  detectProviders,
  buildProviderClient,
  type ProviderClient,
} from "./llm/ProviderClient";
import { CANONICAL_MODEL } from "./llm/providers";

function cleanKey(val?: string): string | undefined {
  if (!val) {
    return undefined;
  }
  const cleaned = val.trim().replace(/^["'“”]+|["'“”]+$/g, "");
  return cleaned.length > 0 ? cleaned : undefined;
}

function getCliApiKey(): string | undefined {
  // OPENROUTER_API_KEY or AI_API_KEY — never logged or displayed.
  return cleanKey(
    process.env.OPENROUTER_API_KEY ||
    process.env.AI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY
  );
}



async function main(): Promise<void> {
  const apiKey = getCliApiKey();
  if (!apiKey) {
    console.error(`\n\x1b[91m┌─ CONFIGURATION ERROR ─────────────────────────────────────────┐\x1b[0m`);
    console.error(`\x1b[91m│\x1b[0m  ✘  No API key configured.                                     \x1b[91m│\x1b[0m`);
    console.error(`\x1b[91m│\x1b[0m                                                                \x1b[91m│\x1b[0m`);
    console.error(`\x1b[91m│\x1b[0m  Set one of these in your .env file:                            \x1b[91m│\x1b[0m`);
    console.error(`\x1b[91m│\x1b[0m    NVIDIA_API_KEY=nvapi-...                                    \x1b[91m│\x1b[0m`);
    console.error(`\x1b[91m│\x1b[0m    AI_API_KEY=...                                              \x1b[91m│\x1b[0m`);
    console.error(`\x1b[91m└────────────────────────────────────────────────────────────────┘\x1b[0m\n`);
    process.exit(1);
  }

  // Deterministic configuration priority:
  // CLI argument (--model) -> Environment configuration (MODEL / AI_MODEL) -> Default configuration
  let cliModel: string | undefined;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--model" && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
      cliModel = process.argv[i + 1].trim();
    } else if (a.startsWith("--model=")) {
      cliModel = a.slice("--model=".length).trim();
    }
  }

  const configuredModel =
    cliModel ||
    process.env.MODEL?.trim() ||
    process.env.AI_MODEL?.trim();

  // Single authoritative source of truth for the active OpenRouter model ID
  let activeModelId = configuredModel ? resolveModelId(configuredModel) : CANONICAL_MODEL;

  const envBaseUrl =
    process.env.BASE_URL?.trim() ||
    process.env.AI_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim();

  // ── Provider Detection ──────────────────────────────────────────────────────
  // Probe configured or default providers (OpenRouter, AWS Bedrock). The API key is never logged.
  console.log("Detecting LLM providers...");
  let providerClient: ProviderClient;
  try {
    const detection = await detectProviders(apiKey, undefined, envBaseUrl, activeModelId);
    for (const s of detection.statuses) {
      if (s.available) {
        console.log(`  ✓ ${s.name}: available`);
      } else {
        // Error details must never include the raw API key
        console.log(`  ✗ ${s.name}: unavailable`);
      }
    }
    providerClient = buildProviderClient(detection, apiKey);
    providerClient.setModel(activeModelId);
    console.log(`  → Using: ${providerClient.providerName}`);
  } catch (err: any) {
    console.error(`\n[DAXIOM] Fatal: ${err.message}`);
    process.exit(1);
  }

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
        resolvePathInWorkspace(input, root, async () => true),
      toRelative: (uri: vscode.Uri) => toRelative(root, uri),
      confirm: async () => true,
      switchWorkspace: async (newPath: string) => {
        const newRoot = vscode.Uri.file(newPath);
        const folderName = path.basename(newPath);
        (vscode.workspace as any).workspaceFolders = [
          { uri: newRoot, name: folderName, index: 0 },
        ];
        toolContext = buildToolContext(newRoot);
        if (session) {
          session.setWorkspace(toolContext, folderName);
        }
        currentWorkspaceRoot = newRoot;
        currentWorkspacePath = newPath;
        tui.printNotice(`Workspace switched to: ${newPath}`);
      },
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

  // Build the LLMClient wrapping the selected ProviderClient
  const llmClientForSession = LLMClient.fromProviderClient(
    providerClient,
    apiKey,
    getMaxTokens(),
  );
  llmClientForSession.setModel(activeModelId);

  let session = new (ChatSession as any)(
    llmClientForSession,
    registry,
    toolContext,
    path.basename(defaultWorkspace),
    allowMutations,
    activeModelId,
    chats.active.history,
  ) as ChatSession;

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
        console.log(`  ${colors.bold}Model:${colors.reset}        ${getModelDisplayName(activeModelId)} (${activeModelId})`);
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
        const targetModel = arg.trim();
        if (!targetModel) {
          tui.printError("Usage: /model <model-name>\nExamples:\n  /model deepseek/deepseek-chat\n  /model qwen/qwen3-coder\n  /model deepseek/deepseek-v4.1-flash");
          return true;
        }
        activeModelId = resolveModelId(targetModel);
        if (!isOpenRouterModelId(activeModelId)) {
          tui.printError(
            `Invalid model format: "${targetModel}". OpenRouter models must use the "provider/model-name" format.\n` +
            `Type /models to view all verified OpenRouter models.`
          );
          return true;
        }
        process.env.MODEL = activeModelId;
        process.env.AI_MODEL = activeModelId;
        session.setModel(activeModelId);
        providerClient.setModel(activeModelId);
        llmClientForSession.setModel(activeModelId);

        const displayName = getModelDisplayName(activeModelId);
        tui.printHeader(allowMutations, displayName, currentWorkspacePath, providerClient.providerName);
        tui.printSuccess(`Model switched to: ${displayName} (${activeModelId})`);
        return true;
      }
      if (cmd === "/base-url") {
        const targetUrl = arg.trim();
        if (!targetUrl) {
          tui.printError("Usage: /base-url <base-url>");
          return true;
        }
        try {
          const parsed = new URL(targetUrl);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error("Protocol must be http: or https:");
          }
        } catch {
          tui.printError(`Invalid URL: ${targetUrl}. Must be a valid http:// or https:// URL.`);
          return true;
        }
        process.env.BASE_URL = targetUrl;
        process.env.AI_BASE_URL = targetUrl;
        session.setEndpoint(targetUrl, apiKey!);
        providerClient.setBaseUrl(targetUrl);
        tui.printSuccess("Base URL changed");
        tui.printSuccess(`Provider endpoint: ${targetUrl}`);
        return true;
      }
      if (cmd === "/config") {
        const activeBaseUrl = providerClient.providerBaseUrl.replace(/\/+$/, "");
        console.log(`\n${colors.bold}${colors.cyan}DAXIOM CONFIGURATION${colors.reset}\n`);
        console.log(`${colors.bold}Model:${colors.reset}\n${getModelDisplayName(activeModelId)} (${activeModelId})\n`);
        console.log(`${colors.bold}Max Tokens:${colors.reset}\n${getMaxTokens()}\n`);
        console.log(`${colors.bold}Base URL:${colors.reset}\n${activeBaseUrl}\n`);
        console.log(`${colors.bold}API Key:${colors.reset}\n${apiKey ? `${colors.green}Configured ✓${colors.reset}` : `${colors.red}Missing ✗${colors.reset}`}\n`);
        console.log(`${colors.bold}Auto Edit:${colors.reset}\n${allowMutations ? "ON" : "OFF"}\n`);
        console.log(`${colors.bold}Workspace:${colors.reset}\n${currentWorkspacePath}\n`);
        return true;
      }
      if (cmd === "/models") {
        const groups = new Map<string, typeof MODELS>();
        for (const m of MODELS) {
          const g = m.provider || "Other";
          if (!groups.has(g)) {
            groups.set(g, []);
          }
          groups.get(g)!.push(m);
        }
        let listStr = "Available registered models on OpenRouter:\n";
        for (const [grp, list] of groups.entries()) {
          listStr += `\n  ${colors.bold}${grp}${colors.reset}:\n`;
          for (const m of list) {
            const activeMark = m.apiModelId === activeModelId ? ` ${colors.green}(active)${colors.reset}` : "";
            const ctxStr = m.contextLength ? ` [${Math.round(m.contextLength / 1024)}k ctx]` : "";
            listStr += `    • ${colors.cyan}${m.displayName}${colors.reset} → \`${m.apiModelId}\`${ctxStr}${activeMark}\n`;
          }
        }
        listStr += `\nSwitch model using: /model <model-id>`;
        tui.printNotice(listStr);
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
        console.log(`\n${colors.bold}${colors.cyan}Available commands:${colors.reset}\n`);
        console.log(`  ${colors.bold}/help${colors.reset}\n    Show available commands.\n`);
        console.log(`  ${colors.bold}/model <model>${colors.reset}\n    Change the active AI model.\n`);
        console.log(`  ${colors.bold}/base-url <url>${colors.reset}\n    Change the active LLM provider endpoint.\n`);
        console.log(`  ${colors.bold}/config${colors.reset}\n    Show current configuration.\n`);
        console.log(`  ${colors.bold}/clear${colors.reset}\n    Clear the current conversation.\n`);
        console.log(`  ${colors.bold}/new${colors.reset}\n    Start a new conversation.\n`);
        console.log(`  ${colors.bold}/auto${colors.reset}\n    Enable Auto Edit mode (autonomous execution).\n`);
        console.log(`  ${colors.bold}/plan${colors.reset}\n    Enable Plan mode (read-only inspection).\n`);
        console.log(`  ${colors.bold}/diff${colors.reset}\n    Preview staged ChangeSet diff.\n`);
        console.log(`  ${colors.bold}/status${colors.reset}\n    Show session status, read/staged files, and git details.\n`);
        console.log(`  ${colors.bold}/git${colors.reset}\n    Show repository, branch, and remote details.\n`);
        console.log(`  ${colors.bold}/repo <url>${colors.reset}\n    Clone a GitHub repo to Desktop and switch workspace.\n`);
        console.log(`  ${colors.bold}/pr${colors.reset}\n    Commit accepted changes, push branch, and create GitHub PR.\n`);
        console.log(`  ${colors.bold}/models${colors.reset}\n    List available models.\n`);
        console.log(`  ${colors.bold}/exit${colors.reset}\n    Exit Daxiom.\n`);
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

      // Fully autonomous execution: automatically apply all staged changes immediately to disk
      // Zero confirmation dialogs, zero review questions, zero manual approval blockers
      if (currentChangeManager.hasStaged()) {
        const changeSet = currentChangeManager.getChangeSet();
        await currentChangeManager.applyChangeSet();
        tui.printNotice(`✓ Changes applied immediately to disk (${changeSet.length} file${changeSet.length === 1 ? "" : "s"}).`);

        // Only run PR workflow if explicitly requested via environment variable AXIOM_AUTO_PR=1
        if (process.env.AXIOM_AUTO_PR === "1" && !process.env.AXIOM_SKIP_PR) {
          const repoDetails = GitHubManager.getRepoDetails(currentWorkspacePath);
          if (repoDetails && changeSet.length > 0) {
            await runPrWorkflow(trimmed);
          }
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
  if (process.stdout.isTTY) {
    await tui.printBanner(getModelDisplayName(activeModelId), providerClient.providerName, { showInfo: false });
  }
  tui.printHeader(allowMutations, getModelDisplayName(activeModelId), currentWorkspacePath, providerClient.providerName);
  console.log(`${colors.dim}  Workspace: ${currentWorkspacePath}${colors.reset}\n`);
  if (process.env.AXIOM_DEBUG === "1") {
    console.log(`${colors.dim}  Application Root:  ${applicationRoot}${colors.reset}`);
    console.log(`${colors.dim}  Default Workspace: ${defaultWorkspace}${colors.reset}\n`);
  }

  checkBroadWorkspaceWarning(currentWorkspacePath, (msg) => tui.printNotice(msg));

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
  tui.printFooter("What would you like to build?  (or /help for commands)");

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
    console.log("\n" + colors.brightBlack + "  Exiting AXIOM. Goodbye." + colors.reset + "\n");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
