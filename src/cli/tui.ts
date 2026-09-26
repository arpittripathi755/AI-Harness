import * as path from "path";

const USE_COLOR =
  !process.env.NO_COLOR &&
  (process.stdout.isTTY || process.env.FORCE_COLOR === "1");

export const colors = {
  reset: USE_COLOR ? "\x1b[0m" : "",
  bold: USE_COLOR ? "\x1b[1m" : "",
  dim: USE_COLOR ? "\x1b[2m" : "",
  cyan: USE_COLOR ? "\x1b[36m" : "",
  green: USE_COLOR ? "\x1b[32m" : "",
  yellow: USE_COLOR ? "\x1b[33m" : "",
  red: USE_COLOR ? "\x1b[31m" : "",
  magenta: USE_COLOR ? "\x1b[35m" : "",
  blue: USE_COLOR ? "\x1b[34m" : "",
};

const DEFAULT_WIDTH = 64;

export function getTerminalWidth(): number {
  const cols = process.stdout.columns || 80;
  return Math.min(Math.max(cols - 2, 50), 80);
}

export function padBetween(left: string, right: string, width: number): string {
  const visibleLeftLen = stripAnsi(left).length;
  const visibleRightLen = stripAnsi(right).length;
  const spaces = Math.max(1, width - visibleLeftLen - visibleRightLen);
  return left + " ".repeat(spaces) + right;
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export class TerminalUI {
  private width: number;
  private assistantActive = false;

  constructor() {
    this.width = getTerminalWidth();
  }

  printHeader(autoEdit: boolean, modelName: string, workspacePath: string): void {
    const w = this.width;
    const top = "┌" + "─".repeat(w) + "┐";
    const mid = "├" + "─".repeat(w) + "┤";

    const titleLeft = `  ${colors.bold}${colors.cyan}DAXIOM${colors.reset}`;
    const autoEditBadge = autoEdit
      ? `${colors.bold}${colors.green}AUTO EDIT: ON${colors.reset}  `
      : `${colors.bold}${colors.yellow}PLAN MODE (READ-ONLY)${colors.reset}  `;
    const titleLine = "│" + padBetween(titleLeft, autoEditBadge, w) + "│";

    const wsName = path.basename(workspacePath) || workspacePath;
    const infoLeft = `  ${colors.dim}Model: ${modelName}${colors.reset}`;
    const infoRight = `${colors.dim}Workspace: ${wsName}${colors.reset}  `;
    const infoLine = "│" + padBetween(infoLeft, infoRight, w) + "│";

    console.log(top);
    console.log(titleLine);
    console.log(mid);
    console.log(infoLine);
    console.log(mid);
  }

  printDivider(): void {
    const w = this.width;
    console.log("├" + "─".repeat(w) + "┤");
  }

  printFooter(promptPlaceholder = "Enter task..."): void {
    const w = this.width;
    const mid = "├" + "─".repeat(w) + "┤";
    const bottom = "└" + "─".repeat(w) + "┘";
    const promptText = `  ${colors.dim}> ${promptPlaceholder}${colors.reset}`;
    const promptLine = "│" + padBetween(promptText, "", w) + "│";

    console.log(mid);
    console.log(promptLine);
    console.log(bottom);
  }

  printPromptPrefix(): string {
    return `${colors.bold}${colors.cyan}> ${colors.reset}`;
  }

  printToolStart(name: string, title: string): void {
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    const label = formatToolStartLabel(name, title);
    console.log(`  ${colors.yellow}◉${colors.reset} ${label}`);
  }

  printToolEnd(ok: boolean, summary: string, rawContent?: string): void {
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }

    if (ok) {
      // Check if command output indicates tests passed
      if (rawContent && isTestPassOutput(rawContent)) {
        const testMatch = rawContent.match(/(\d+\s+passing|\d+\s+tests?\s+passed)/i);
        const passSummary = testMatch ? testMatch[1] : summary;
        console.log(`  ${colors.green}✓${colors.reset} ${passSummary}`);
      } else {
        console.log(`  ${colors.green}✓${colors.reset} ${summary}`);
      }
    } else {
      // If tests failed or command failed, show failure
      const failureExtract = rawContent ? extractFailureSnippet(rawContent) : undefined;
      console.log(`  ${colors.red}✗${colors.reset} ${summary}`);
      if (failureExtract) {
        console.log(`    ${colors.red}${failureExtract}${colors.reset}`);
      }
    }
  }

  printStatus(status: string): void {
    if (
      status === "Finished" ||
      status === "Idle" ||
      status === "Thinking…" ||
      status === "Generating response…"
    ) {
      return;
    }
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    console.log(`  ${colors.yellow}◉${colors.reset} ${status}`);
  }

  printAssistantStart(): void {
    if (!this.assistantActive) {
      console.log(`\n  ${colors.bold}${colors.blue}Agent${colors.reset}`);
      this.assistantActive = true;
    }
  }

  printAssistantDelta(delta: string): void {
    if (!this.assistantActive) {
      this.printAssistantStart();
    }
    process.stdout.write(delta);
  }

  printAssistantDone(): void {
    if (this.assistantActive) {
      process.stdout.write("\n\n");
      this.assistantActive = false;
    }
  }

  printError(message: string): void {
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    console.log(`  ${colors.red}✗ ${message}${colors.reset}`);
  }

  printNotice(message: string): void {
    console.log(`  ${colors.cyan}\u2139 ${message}${colors.reset}`);
  }

  printPhase(phase: string): void {
    const phaseColor: Record<string, string> = {
      EXPLORING: colors.blue,
      EDITING: colors.yellow,
      VERIFYING: colors.magenta,
      DONE: colors.green,
    };
    const c = phaseColor[phase] ?? colors.dim;
    console.log(`  ${c}\u25B6 Phase: ${phase}${colors.reset}`);
  }
}

function formatToolStartLabel(name: string, title: string): string {
  switch (name) {
    case "search_workspace":
      return `Searching workspace...`;
    case "list_files":
      return `Listing files in workspace...`;
    case "read_file": {
      const match = title.match(/→\s*(.+)$/);
      return match ? `Reading ${match[1]}` : `Reading file...`;
    }
    case "edit_file":
    case "multi_edit": {
      const match = title.match(/→\s*(.+)$/);
      return match ? `Editing ${match[1]}` : `Editing file...`;
    }
    case "create_file": {
      const match = title.match(/→\s*(.+)$/);
      return match ? `Creating ${match[1]}` : `Creating file...`;
    }
    case "delete_file": {
      const match = title.match(/→\s*(.+)$/);
      return match ? `Deleting ${match[1]}` : `Deleting file...`;
    }
    case "rename_file": {
      const match = title.match(/→\s*(.+)$/);
      return match ? `Renaming ${match[1]}` : `Renaming file...`;
    }
    case "run_command": {
      const match = title.match(/→\s*(.+)$/);
      return match ? `Running ${match[1]}` : `Running command...`;
    }
    default:
      return title || `Executing ${name}...`;
  }
}

function isTestPassOutput(content: string): boolean {
  return (
    /\b(\d+\s+passing|\d+\s+tests?\s+passed|test suites?:\s*\d+\s*passed)\b/i.test(
      content,
    ) && !/\bfailed\b/i.test(content)
  );
}

function extractFailureSnippet(content: string): string | undefined {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /\b(\d+\s+tests?\s+failed|tests? failed|FAIL|AssertionError|Error:)\b/i.test(
        trimmed,
      ) &&
      !trimmed.startsWith("$") &&
      !trimmed.startsWith("exit code")
    ) {
      return trimmed.slice(0, 100);
    }
  }
  return undefined;
}
