#!/usr/bin/env node

import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import * as vscode from "vscode";
import { execSync } from "child_process";
import { ChatSession } from "./agent/ChatSession";
import { ConversationManager } from "./agent/ConversationManager";
import { InMemoryMemento } from "./standalone/vscodeShim";
import { createToolRegistry } from "./tools";
import type { ToolContext } from "./tools/types";
import { resolvePathInWorkspace, toRelative } from "./tools/workspace";
import { DEFAULT_BASE_URL } from "./config";
import {
  DEFAULT_MODEL_ID,
  getModelByApiId,
  MODELS,
  resolveModelId,
} from "./shared/models";
import { TerminalUI, colors } from "./cli/tui";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GitHub input parser
// ---------------------------------------------------------------------------

interface GitHubIssueRef {
  repoUrl: string;      // normalized HTTPS URL with .git
  owner: string;
  repo: string;
  issueNumber: number;
}

interface GitHubRepoRef {
  repoUrl: string;
  owner: string;
  repo: string;
}

/** Normalize SSH or bare GitHub URLs to HTTPS with .git suffix. */
function normalizeGitHubUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}.git`;
  return trimmed.replace(/\.git$/, "") + ".git";
}

/** Parse owner/repo from a normalized GitHub HTTPS URL. */
function parseOwnerRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/**
 * Try to parse user input as a GitHub issue-solving request.
 * Handles:
 *   https://github.com/owner/repo.git solve issue #42
 *   https://github.com/owner/repo fix issue 91
 *   https://github.com/owner/repo/issues/42
 *   owner/repo#42 solve
 */
function parseGitHubIssueInput(input: string): GitHubIssueRef | null {
  const trimmed = input.trim();

  // Full issue URL by itself: https://github.com/owner/repo/issues/42
  const issueLinkMatch = trimmed.match(
    /^(https?:\/\/github\.com\/[^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/i,
  );
  if (issueLinkMatch) {
    const rawRepo = issueLinkMatch[1];
    const repoUrl = normalizeGitHubUrl(rawRepo);
    const parsed = parseOwnerRepo(repoUrl);
    if (parsed) {
      return { repoUrl, owner: parsed.owner, repo: parsed.repo, issueNumber: parseInt(issueLinkMatch[2], 10) };
    }
  }

  // Pattern: <github-url> <verb> issue #N  (or "issue N")
  const verbIssueMatch = trimmed.match(
    /^((?:https?:\/\/github\.com\/|git@github\.com:)[^\s]+?(?:\.git)?)\s+(?:solve|fix|resolve|address|work on|handle|implement|close)s?\s+(?:issue\s+)?#?(\d+)/i,
  );
  if (verbIssueMatch) {
    const repoUrl = normalizeGitHubUrl(verbIssueMatch[1]);
    const parsed = parseOwnerRepo(repoUrl);
    if (parsed) {
      return { repoUrl, owner: parsed.owner, repo: parsed.repo, issueNumber: parseInt(verbIssueMatch[2], 10) };
    }
  }

  // owner/repo#N format
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^#\s]+)#(\d+)/);
  if (shortMatch) {
    const repoUrl = `https://github.com/${shortMatch[1]}/${shortMatch[2]}.git`;
    return {
      repoUrl,
      owner: shortMatch[1],
      repo: shortMatch[2],
      issueNumber: parseInt(shortMatch[3], 10),
    };
  }

  return null;
}

/** Parse a bare GitHub repo URL (no issue number). */
function parseGitHubRepoInput(input: string): GitHubRepoRef | null {
  const trimmed = input.trim();
  const repoMatch = trimmed.match(/^((?:https?:\/\/github\.com\/|git@github\.com:)[^\s]+)/i);
  if (!repoMatch) return null;
  const repoUrl = normalizeGitHubUrl(repoMatch[1]);
  const parsed = parseOwnerRepo(repoUrl);
  if (!parsed) return null;
  return { repoUrl, owner: parsed.owner, repo: parsed.repo };
}

// ---------------------------------------------------------------------------
// Active repository context (persisted across turns in a session)
// ---------------------------------------------------------------------------

interface ActiveRepoContext {
  owner: string;
  repo: string;
  repoUrl: string;
  root: string;
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apiKey = getCliApiKey();
  if (!apiKey) {
    console.error("┌──────────────────────────────────────────────────────────────┐");
    console.error("│ ERROR: AI_API_KEY environment variable is not set.           │");
    console.error("│                                                              │");
    console.error("│ Please export your API key before running:                  │");
    console.error("│   export AI_API_KEY=\"<your-api-key>\"                         │");
    console.error("│   make run                                                   │");
    console.error("└──────────────────────────────────────────────────────────────┘");
    process.exit(1);
  }

  const baseUrl = getCliBaseUrl();
  let currentModelId = getCliModelId();
  let allowMutations = true; // Auto Edit ON by default

  let cwd = process.cwd();
  let workspaceRoot = vscode.Uri.file(cwd);
  (vscode.workspace as any).workspaceFolders = [
    { uri: workspaceRoot, name: path.basename(cwd) || "workspace", index: 0 },
  ];

  const tui = new TerminalUI();

  const toolContext: ToolContext = {
    workspaceRoot,
    terminalAutoRun: true,
    autoEdit: true,
    resolvePath: async (input: string) => {
      return resolvePathInWorkspace(input, toolContext.workspaceRoot, async () => true);
    },
    toRelative: (uri: vscode.Uri) => toRelative(toolContext.workspaceRoot, uri),
    confirm: async () => true,
  };

  const registry = createToolRegistry();
  const memento = new InMemoryMemento();
  const chats = new ConversationManager(memento);

  const modelInfo = getModelByApiId(currentModelId);
  const modelDisplayName = modelInfo?.displayName ?? currentModelId;

  let session = ChatSession.create(
    { baseUrl, model: currentModelId, apiKey },
    registry,
    toolContext,
    path.basename(cwd),
    allowMutations,
    chats.active.history,
  );

  // Active repo context survives across turns
  let activeRepo: ActiveRepoContext | null = null;

  // Wire workspace-changed callback — called by fetch_repo and run_command cd
  (toolContext as any).onWorkspaceChanged = (newRoot: vscode.Uri) => {
    cwd = newRoot.fsPath;
    workspaceRoot = newRoot;
    toolContext.workspaceRoot = newRoot;
    (vscode.workspace as any).workspaceFolders = [
      { uri: newRoot, name: path.basename(cwd) || cwd, index: 0 },
    ];
    session.setWorkspace(newRoot, path.basename(cwd) || cwd);
  };

  // ---------------------------------------------------------------------------
  // Orchestration: clone repo + fetch issue, then hand off to agent
  // ---------------------------------------------------------------------------

  async function orchestrateGitHubIssue(ref: GitHubIssueRef): Promise<void> {
    const { repoUrl, owner, repo, issueNumber } = ref;
    const cloneBase = path.join(process.env.HOME ?? "/tmp", ".axiom", "repos");
    const targetPath = path.join(cloneBase, repo);

    tui.printSectionHeader(`GitHub Issue Solver — ${owner}/${repo} #${issueNumber}`);

    // Step 1: Fetch issue
    tui.printOrchestrationStep("Fetching issue details", `#${issueNumber} from ${owner}/${repo}`);
    const issueRegistry = registry;
    const fetchIssueTool = issueRegistry.get("fetch_github_issue");
    let issueContext = "";
    if (fetchIssueTool) {
      try {
        const result = await fetchIssueTool.execute(
          { url: `https://github.com/${owner}/${repo}/issues/${issueNumber}` },
          toolContext,
        );
        if (!result.isError) {
          issueContext = result.content;
          tui.printOrchestrationDone("Issue fetched", result.summary);
        } else {
          tui.printError(`Failed to fetch issue: ${result.summary}`);
          issueContext = `Issue #${issueNumber} from ${owner}/${repo} (could not be fetched automatically, proceed by inspecting the repository)`;
        }
      } catch (err: any) {
        tui.printError(`Issue fetch error: ${err.message}`);
        issueContext = `Issue #${issueNumber} from ${owner}/${repo}`;
      }
    }

    // Step 2: Clone/fetch repo
    tui.printOrchestrationStep("Preparing repository", repoUrl);
    const fetchRepoTool = registry.get("fetch_repo");
    let repoRoot = targetPath;
    if (fetchRepoTool) {
      try {
        const result = await fetchRepoTool.execute(
          { url: repoUrl, dest_dir: targetPath },
          toolContext,
        );
        if (!result.isError) {
          tui.printOrchestrationDone("Repository ready", targetPath);
          // toolContext.workspaceRoot is updated by fetch_repo via onWorkspaceChanged
          repoRoot = toolContext.workspaceRoot?.fsPath ?? targetPath;
        } else {
          tui.printError(`Clone failed: ${result.summary}`);
          return;
        }
      } catch (err: any) {
        tui.printError(`Clone error: ${err.message}`);
        return;
      }
    }

    // Update active repo context
    activeRepo = { owner, repo, repoUrl, root: repoRoot };

    // Step 3: Build the task prompt and hand off to agent
    const taskPrompt =
      `TASK: Solve GitHub issue #${issueNumber} in the repository ${owner}/${repo}.\n\n` +
      `REPOSITORY: ${repoUrl}\n` +
      `REPOSITORY ROOT (already cloned): ${repoRoot}\n` +
      `OWNER: ${owner}\n` +
      `REPO: ${repo}\n` +
      `ISSUE NUMBER: ${issueNumber}\n\n` +
      `ISSUE DETAILS:\n${issueContext}\n\n` +
      `The repository is already cloned at ${repoRoot}. ` +
      `All file tools are already pointed at this directory. ` +
      `Begin by inspecting the repository structure, then implement the fix, run tests, and report.`;

    tui.printSectionHeader("Agent Working");

    let turnFailed = false;
    try {
      await session.send(taskPrompt, {
        onAssistantStart: () => tui.printAssistantStart(),
        onAssistantDelta: (_id, delta) => tui.printAssistantDelta(delta),
        onAssistantDone: () => tui.printAssistantDone(),
        onToolStart: (_callId, name, title) => tui.printToolStart(name, title),
        onToolEnd: (_callId, ok, summary, content) => {
          if (!ok) turnFailed = true;
          tui.printToolEnd(ok, summary, content);
        },
        onStatus: (status) => tui.printStatus(status),
        onError: (err) => {
          turnFailed = true;
          tui.printError(err);
        },
      });

      chats.active.history = session.exportHistory();
      chats.active.taskMemory = session.exportTaskMemory();
      chats.save();
    } catch (err: any) {
      tui.printError(err.message || String(err));
    }
  }

  // ---------------------------------------------------------------------------
  // executeTurn — handles slash commands + natural-language GitHub orchestration
  // ---------------------------------------------------------------------------

  async function executeTurn(userText: string): Promise<boolean> {
    const trimmed = userText.trim();
    if (!trimmed) return true;

    // --- Slash commands ---
    if (trimmed.startsWith("/")) {
      const parts = trimmed.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(" ");

      if (cmd === "/exit" || cmd === "/quit") {
        return false;
      }
      if (cmd === "/plan") {
        allowMutations = false;
        toolContext.autoEdit = false;
        session.setMode(false);
        tui.printNotice("Switched to Plan Mode (read-only inspection).");
        return true;
      }
      if (cmd === "/auto") {
        allowMutations = true;
        toolContext.autoEdit = true;
        session.setMode(true);
        tui.printNotice("Switched to Auto Edit Mode (autonomous execution).");
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
        tui.printNotice(
          "Available models:\n" +
            MODELS.map((m) => `  - ${m.displayName} (${m.apiModelId})`).join("\n"),
        );
        return true;
      }
      if (cmd === "/new") {
        session.cancel();
        chats.create();
        session.reset();
        activeRepo = null;
        tui.printNotice("Started new conversation session.");
        return true;
      }
      if (cmd === "/clone") {
        if (!arg) {
          tui.printNotice("Usage: /clone <github-url> [branch]");
          return true;
        }
        const [cloneUrl, branch] = arg.split(/\s+/);
        const fetchRepoTool = registry.get("fetch_repo");
        if (fetchRepoTool) {
          tui.printOrchestrationStep("Cloning repository", cloneUrl);
          const cloneArgs: Record<string, unknown> = { url: cloneUrl };
          if (branch) cloneArgs.branch = branch;
          const result = await fetchRepoTool.execute(cloneArgs, toolContext);
          if (!result.isError) {
            tui.printOrchestrationDone("Cloned", result.summary);
            const repoName = path.basename(cloneUrl.replace(/\.git$/, ""));
            const parsed = parseOwnerRepo(normalizeGitHubUrl(cloneUrl));
            if (parsed) {
              activeRepo = {
                owner: parsed.owner,
                repo: parsed.repo,
                repoUrl: normalizeGitHubUrl(cloneUrl),
                root: toolContext.workspaceRoot?.fsPath ?? process.cwd(),
              };
            }
          } else {
            tui.printError(result.content);
          }
        }
        return true;
      }
      if (cmd === "/issue") {
        if (!arg) {
          tui.printNotice("Usage: /issue <github-issue-url>  OR  /issue <owner/repo> <number>");
          return true;
        }
        const fetchIssueTool = registry.get("fetch_github_issue");
        if (fetchIssueTool) {
          tui.printOrchestrationStep("Fetching issue", arg);
          const result = await fetchIssueTool.execute({ url: arg }, toolContext);
          if (!result.isError) {
            tui.printOrchestrationDone("Issue fetched", result.summary);
            console.log("\n" + result.content);
          } else {
            tui.printError(result.content);
          }
        }
        return true;
      }
      if (cmd === "/cd") {
        const dir = arg || process.env.HOME || "/";
        const runCmd = registry.get("run_command");
        if (runCmd) {
          const result = await runCmd.execute({ command: `cd ${dir}` }, toolContext);
          tui.printNotice(result.content);
        }
        return true;
      }
      if (cmd === "/pwd") {
        tui.printNotice(`Working directory: ${toolContext.workspaceRoot?.fsPath ?? process.cwd()}`);
        return true;
      }
      if (cmd === "/repo") {
        if (activeRepo) {
          tui.printNotice(
            `Active repository: ${activeRepo.owner}/${activeRepo.repo}\n` +
            `URL: ${activeRepo.repoUrl}\n` +
            `Root: ${activeRepo.root}`,
          );
        } else {
          tui.printNotice("No repository active. Paste a GitHub URL to clone one.");
        }
        return true;
      }
      if (cmd === "/help") {
        tui.printNotice(
          "Commands:\n" +
          "  /auto           - Enable Auto Edit mode (autonomous, default)\n" +
          "  /plan           - Enable Plan mode (read-only inspection)\n" +
          "  /model <id>     - Switch model\n" +
          "  /models         - List available models\n" +
          "  /new            - Start fresh conversation\n" +
          "  /clone <url>    - Clone a GitHub repository\n" +
          "  /issue <url>    - Fetch a GitHub issue by URL\n" +
          "  /repo           - Show active repository\n" +
          "  /cd <dir>       - Change working directory\n" +
          "  /pwd            - Show working directory\n" +
          "  /exit, /quit    - Exit Axiom\n" +
          "  /help           - Show this help\n\n" +
          "GitHub shortcut:\n" +
          "  https://github.com/owner/repo.git solve issue #42\n" +
          "  → Axiom will clone the repo, fetch the issue, and fix it autonomously.",
        );
        return true;
      }
      tui.printError(`Unknown command: ${cmd}. Type /help for available commands.`);
      return true;
    }

    // --- GitHub issue orchestration (pre-LLM fast-path) ---
    const issueRef = parseGitHubIssueInput(trimmed);
    if (issueRef) {
      await orchestrateGitHubIssue(issueRef);
      return true;
    }

    // --- Bare GitHub repo URL: just clone and switch workspace ---
    const repoRef = parseGitHubRepoInput(trimmed);
    if (repoRef && !trimmed.includes(" ")) {
      // User pasted just a URL with no trailing text
      const fetchRepoTool = registry.get("fetch_repo");
      if (fetchRepoTool) {
        tui.printOrchestrationStep("Cloning repository", repoRef.repoUrl);
        const result = await fetchRepoTool.execute({ url: repoRef.repoUrl }, toolContext);
        if (!result.isError) {
          tui.printOrchestrationDone("Repository ready", result.summary);
          activeRepo = {
            owner: repoRef.owner,
            repo: repoRef.repo,
            repoUrl: repoRef.repoUrl,
            root: toolContext.workspaceRoot?.fsPath ?? process.cwd(),
          };
          tui.printNotice(`Active repo: ${repoRef.owner}/${repoRef.repo}. Now type: solve issue #<N>`);
        } else {
          tui.printError(result.content);
        }
      }
      return true;
    }

    // --- Two-step: "solve issue #N" when repo is already active ---
    if (activeRepo) {
      const issueOnlyMatch = trimmed.match(
        /^(?:solve|fix|resolve|address|work on|handle|implement|close)s?\s+(?:issue\s+)?#?(\d+)$/i,
      );
      if (issueOnlyMatch) {
        const issueNumber = parseInt(issueOnlyMatch[1], 10);
        await orchestrateGitHubIssue({
          repoUrl: activeRepo.repoUrl,
          owner: activeRepo.owner,
          repo: activeRepo.repo,
          issueNumber,
        });
        return true;
      }
    }

    // --- Normal agent turn ---
    let turnFailed = false;
    try {
      await session.send(trimmed, {
        onAssistantStart: () => tui.printAssistantStart(),
        onAssistantDelta: (_id, delta) => tui.printAssistantDelta(delta),
        onAssistantDone: () => tui.printAssistantDone(),
        onToolStart: (_callId, name, title) => tui.printToolStart(name, title),
        onToolEnd: (_callId, ok, summary, content) => {
          if (!ok) turnFailed = true;
          tui.printToolEnd(ok, summary, content);
        },
        onStatus: (status) => tui.printStatus(status),
        onError: (err) => {
          turnFailed = true;
          tui.printError(err);
        },
      });

      chats.active.history = session.exportHistory();
      chats.active.taskMemory = session.exportTaskMemory();
      chats.save();
    } catch (err: any) {
      turnFailed = true;
      tui.printError(err.message || String(err));
    }

    return !turnFailed;
  }

  // ---------------------------------------------------------------------------
  // Startup: print header
  // ---------------------------------------------------------------------------

  tui.printHeader(allowMutations, modelDisplayName, cwd);

  // --- CLI argument mode (non-interactive, single task) ---
  const cliArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (cliArgs.length > 0) {
    const task = cliArgs.join(" ");
    console.log(`\n${colors.bold}${colors.brightCyan}Task:${colors.reset} ${task}\n`);
    await executeTurn(task);
    // After CLI task, drop into interactive mode (don't exit)
    // unless running in piped mode
  }

  // --- Piped stdin mode ---
  if (!process.stdin.isTTY) {
    let pipedInput = "";
    try {
      pipedInput = fs.readFileSync(0, "utf-8").trim();
    } catch {
      pipedInput = "";
    }
    if (pipedInput) {
      console.log(`\n${colors.bold}${colors.brightCyan}Task:${colors.reset} ${pipedInput}\n`);
      const success = await executeTurn(pipedInput);
      process.exit(success ? 0 : 1);
    }
  }

  // --- Interactive TUI ---
  console.log(`${colors.dim}Type /help for commands. Press Ctrl+C to exit.${colors.reset}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.bold}${colors.brightCyan}❯ ${colors.reset}`,
    terminal: true,
  });

  rl.prompt();

  let isBusy = false;

  rl.on("line", async (line) => {
    const trimmed = line.trim();

    if (trimmed === "/exit" || trimmed === "/quit" || trimmed === "exit" || trimmed === "quit") {
      rl.close();
      return;
    }

    if (trimmed && !isBusy) {
      isBusy = true;
      rl.pause();

      const continueLoop = await executeTurn(trimmed);
      if (!continueLoop) {
        rl.close();
        return;
      }

      isBusy = false;
      rl.resume();
    }

    console.log("");
    rl.prompt();
  });

  rl.on("SIGINT", () => {
    if (session.busy) {
      session.cancel();
      isBusy = false;
      console.log(`\n${colors.dim}Cancelled.${colors.reset}`);
      rl.resume();
      rl.prompt();
    } else {
      console.log(`\n${colors.dim}Exiting Axiom. Goodbye!${colors.reset}`);
      process.exit(0);
    }
  });

  rl.on("close", () => {
    console.log(`\n${colors.dim}Exiting Axiom. Goodbye!${colors.reset}`);
    process.exit(0);
  });

  // Keep process alive even if stdin closes unexpectedly
  process.on("uncaughtException", (err) => {
    tui.printError(`Uncaught error: ${err.message}`);
  });

  process.on("unhandledRejection", (reason) => {
    tui.printError(`Unhandled rejection: ${String(reason)}`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
