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
import { resolvePathInWorkspace, toRelative } from "./tools/workspace";
import { DEFAULT_BASE_URL } from "./config";
import {
  DEFAULT_MODEL_ID,
  getModelByApiId,
  MODELS,
  resolveModelId,
} from "./shared/models";
import { TerminalUI, colors } from "./cli/tui";

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
  let allowMutations = true; // Auto Edit is enabled by default for autonomous evaluation!

  let cwd = process.cwd();
  let workspaceRoot = vscode.Uri.file(cwd);
  (vscode.workspace as any).workspaceFolders = [
    {
      uri: workspaceRoot,
      name: path.basename(cwd) || "workspace",
      index: 0,
    },
  ];

  const tui = new TerminalUI();

  // Create autonomous tool context: zero confirmation blockers & unrestricted filesystem
  const toolContext: ToolContext = {
    workspaceRoot,
    terminalAutoRun: true,
    autoEdit: true,
    resolvePath: async (input: string) => {
      return resolvePathInWorkspace(input, toolContext.workspaceRoot, async () => true);
    },
    toRelative: (uri: vscode.Uri) => {
      return toRelative(toolContext.workspaceRoot, uri);
    },
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

  // Hook workspace changes from tools (e.g. fetch_repo or cd)
  (toolContext as any).onWorkspaceChanged = (newRoot: vscode.Uri) => {
    cwd = newRoot.fsPath;
    workspaceRoot = newRoot;
    toolContext.workspaceRoot = newRoot;
    session.setWorkspace(newRoot, path.basename(cwd) || cwd);
  };

  async function executeTurn(userText: string): Promise<boolean> {
    const trimmed = userText.trim();
    if (!trimmed) {
      return true;
    }

    // Check for CLI slash commands
    if (trimmed.startsWith("/")) {
      const parts = trimmed.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(" ");

      if (cmd === "/exit" || cmd === "/quit") {
        console.log(`\n${colors.dim}Exiting Axiom. Goodbye!${colors.reset}`);
        process.exit(0);
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
      if (cmd === "/cd") {
        if (!arg) {
          tui.printNotice(`Current directory: ${process.cwd()}`);
          return true;
        }
        const targetPath = arg.startsWith("~")
          ? path.join(process.env.HOME || "", arg.slice(1))
          : arg;
        const resolvedPath = path.isAbsolute(targetPath)
          ? path.normalize(targetPath)
          : path.normalize(path.join(process.cwd(), targetPath));

        if (!fs.existsSync(resolvedPath)) {
          tui.printError(`Directory does not exist: ${resolvedPath}`);
          return true;
        }
        try {
          const stat = fs.statSync(resolvedPath);
          if (!stat.isDirectory()) {
            tui.printError(`Not a directory: ${resolvedPath}`);
            return true;
          }
          process.chdir(resolvedPath);
          const newWorkspaceRoot = vscode.Uri.file(resolvedPath);
          cwd = resolvedPath;
          workspaceRoot = newWorkspaceRoot;
          (vscode.workspace as any).workspaceFolders = [
            {
              uri: newWorkspaceRoot,
              name: path.basename(resolvedPath) || resolvedPath,
              index: 0,
            },
          ];
          toolContext.workspaceRoot = newWorkspaceRoot;
          session.setWorkspace(newWorkspaceRoot, path.basename(resolvedPath) || resolvedPath);
          tui.printNotice(`Working directory moved to: ${resolvedPath}`);
        } catch (err: any) {
          tui.printError(`Failed to change directory: ${err.message}`);
        }
        return true;
      }
      if (cmd === "/pwd") {
        tui.printNotice(`Current directory: ${process.cwd()}`);
        return true;
      }
      if (cmd === "/clone") {
        if (!arg) {
          tui.printNotice("Usage: /clone <repo-url> [dest-dir]");
          return true;
        }
        const [urlArg, destArg] = arg.split(/\s+/);
        tui.printToolStart("fetch_repo", `fetch_repo → ${urlArg}`);
        try {
          const fetchTool = registry.get("fetch_repo");
          if (!fetchTool) {
            tui.printError("fetch_repo tool not registered.");
            return true;
          }
          const result = await fetchTool.execute(
            { url: urlArg, dest_dir: destArg },
            toolContext,
          );
          tui.printToolEnd(!result.isError, result.summary ?? "Done", result.content);
          if (result.content) {
            console.log(`\n${result.content}\n`);
          }
        } catch (err: any) {
          tui.printToolEnd(false, err.message, err.message);
        }
        return true;
      }
      if (cmd === "/issue") {
        if (!arg) {
          tui.printNotice("Usage: /issue <github-issue-url>");
          return true;
        }
        tui.printToolStart("fetch_github_issue", `fetch_github_issue → ${arg}`);
        try {
          const issueTool = registry.get("fetch_github_issue");
          if (!issueTool) {
            tui.printError("fetch_github_issue tool not registered.");
            return true;
          }
          const result = await issueTool.execute({ url: arg }, toolContext);
          tui.printToolEnd(!result.isError, result.summary ?? "Done", result.content);
          if (result.content) {
            console.log(`\n${result.content}\n`);
          }
        } catch (err: any) {
          tui.printToolEnd(false, err.message, err.message);
        }
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
        tui.printNotice("Started new conversation session.");
        return true;
      }
      if (cmd === "/help") {
        tui.printNotice(
          "Commands:\n" +
            "  /clone <url> [dir] - Fetch and clone public Git repository & switch workspace\n" +
            "  /issue <url>       - Fetch and view details of a GitHub issue or PR\n" +
            "  /cd <dir>          - Change working directory to any path on the system\n" +
            "  /pwd               - Print current working directory\n" +
            "  /auto              - Enable Auto Edit mode (autonomous execution, default)\n" +
            "  /plan              - Enable Plan mode (read-only inspection)\n" +
            "  /model <id>        - Switch model (ultra, deepseek-v4-pro, deepseek-flash)\n" +
            "  /models            - List available models\n" +
            "  /new               - Start fresh conversation session\n" +
            "  /exit, /quit       - Exit Axiom\n" +
            "  Ctrl+C             - Cancel running task or exit Axiom\n" +
            "  /help              - Show this help message",
        );
        return true;
      }
      tui.printError(`Unknown command: ${cmd}. Type /help for available commands.`);
      return true;
    }

    // Normal task execution
    let turnFailed = false;
    try {
      await session.send(trimmed, {
        onAssistantStart: () => tui.printAssistantStart(),
        onAssistantDelta: (_id, delta) => tui.printAssistantDelta(delta),
        onAssistantDone: () => tui.printAssistantDone(),
        onToolStart: (_callId, name, title) => tui.printToolStart(name, title),
        onToolEnd: (_callId, ok, summary, content) => {
          if (!ok) {
            turnFailed = true;
          }
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

  // Print TUI header
  tui.printHeader(allowMutations, modelDisplayName, cwd);

  // Check if non-interactive input was piped via stdin (e.g. echo "..." | node cli.js)
  if (!process.stdin.isTTY) {
    let pipedInput = "";
    try {
      pipedInput = fs.readFileSync(0, "utf-8").trim();
    } catch {
      pipedInput = "";
    }
    if (pipedInput) {
      console.log(`\n${colors.bold}${colors.coral}Task:${colors.reset} ${pipedInput}\n`);
      await executeTurn(pipedInput);
    }
    return;
  }

  // Set up persistent readline interface for interactive terminal
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: tui.printPromptPrefix(),
  });

  // Handle Ctrl+C (SIGINT): cancel running turn or exit cleanly when idle
  rl.on("SIGINT", () => {
    if (session.busy) {
      tui.printNotice("\nCancelling active task (press Ctrl+C again to exit)...");
      session.cancel();
      rl.prompt();
    } else {
      console.log(`\n${colors.dim}Exiting Axiom. Goodbye!${colors.reset}`);
      process.exit(0);
    }
  });

  process.on("SIGINT", () => {
    if (session.busy) {
      session.cancel();
    } else {
      console.log(`\n${colors.dim}Exiting Axiom. Goodbye!${colors.reset}`);
      process.exit(0);
    }
  });

  // Check if initial task was provided via command line arguments
  const cliArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (cliArgs.length > 0) {
    const task = cliArgs.join(" ");
    console.log(`\n${colors.bold}${colors.coral}Task:${colors.reset} ${task}\n`);
    await executeTurn(task);
    // DO NOT EXIT! Keep the session open and wait for further user input or Ctrl+C
    console.log("");
  }

  // Interactive prompt loop: stays alive unless user presses Ctrl+C
  tui.printPromptBox();
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
      try {
        await executeTurn(trimmed);
      } catch (err: any) {
        tui.printError(err.message || String(err));
      }
      rl.resume();
    }

    console.log("");
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(`\n${colors.dim}Exiting Axiom. Goodbye!${colors.reset}`);
    process.exit(0);
  });
}

// Keep process alive and handle uncaught exceptions without crashing out
process.on("uncaughtException", (err) => {
  console.error(`\n${colors.red}Uncaught error:${colors.reset} ${err.message || err}`);
});

process.on("unhandledRejection", (reason) => {
  console.error(`\n${colors.red}Unhandled rejection:${colors.reset}`, reason);
});

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
