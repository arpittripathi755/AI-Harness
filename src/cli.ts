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
  let allowMutations = true; // Auto Edit is enabled by default in evaluation mode!

  const cwd = process.cwd();
  const workspaceRoot = vscode.Uri.file(cwd);
  (vscode.workspace as any).workspaceFolders = [
    {
      uri: workspaceRoot,
      name: path.basename(cwd) || "workspace",
      index: 0,
    },
  ];

  const tui = new TerminalUI();

  // Create autonomous tool context: zero confirmation blockers
  const toolContext: ToolContext = {
    workspaceRoot,
    terminalAutoRun: true,
    autoEdit: true,
    resolvePath: async (input: string) => {
      return resolvePathInWorkspace(input, workspaceRoot, async () => true);
    },
    toRelative: (uri: vscode.Uri) => {
      return toRelative(workspaceRoot, uri);
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
        return false;
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
        tui.printNotice("Started new conversation session.");
        return true;
      }
      if (cmd === "/help") {
        tui.printNotice(
          "Commands:\n" +
          "  /auto        - Enable Auto Edit mode (autonomous execution, default)\n" +
          "  /plan        - Enable Plan mode (read-only inspection)\n" +
          "  /model <id>  - Switch model (ultra, deepseek-v4-pro, deepseek-flash)\n" +
          "  /models      - List available models\n" +
          "  /new         - Start fresh conversation\n" +
          "  /exit, /quit - Exit Daxiom TUI\n" +
          "  /help        - Show this help message"
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

  // Check if non-interactive input was provided via command line arguments
  const cliArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (cliArgs.length > 0) {
    const task = cliArgs.join(" ");
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

  const rl = readline.createInterface({
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
