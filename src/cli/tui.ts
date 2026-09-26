import * as path from "path";

const USE_COLOR =
  !process.env.NO_COLOR &&
  (process.stdout.isTTY || process.env.FORCE_COLOR === "1");

export const colors = {
  reset: USE_COLOR ? "\x1b[0m" : "",
  bold: USE_COLOR ? "\x1b[1m" : "",
  dim: USE_COLOR ? "\x1b[2m" : "",
  italic: USE_COLOR ? "\x1b[3m" : "",
  cyan: USE_COLOR ? "\x1b[36m" : "",
  green: USE_COLOR ? "\x1b[32m" : "",
  yellow: USE_COLOR ? "\x1b[33m" : "",
  red: USE_COLOR ? "\x1b[31m" : "",
  magenta: USE_COLOR ? "\x1b[35m" : "",
  blue: USE_COLOR ? "\x1b[34m" : "",
  brightCyan: USE_COLOR ? "\x1b[96m" : "",
  brightGreen: USE_COLOR ? "\x1b[92m" : "",
  brightYellow: USE_COLOR ? "\x1b[93m" : "",
  brightRed: USE_COLOR ? "\x1b[91m" : "",
  brightWhite: USE_COLOR ? "\x1b[97m" : "",
  bgBlue: USE_COLOR ? "\x1b[44m" : "",
  bgCyan: USE_COLOR ? "\x1b[46m" : "",
};

// AXIOM ASCII logo — coral/cyan gradient effect using ANSI
const AXIOM_LOGO = USE_COLOR
  ? [
      `${colors.brightCyan}${colors.bold}   ▄████████ ▀████    ▐████▀  ▄█   ▄██████▄    ▄▄▄▄███▄▄▄▄   ${colors.reset}`,
      `${colors.cyan}${colors.bold}  ███    ███   ███▌   ████▀  ███  ███    ███  ▄██▀▀▀███▀▀▀██▄ ${colors.reset}`,
      `${colors.brightCyan}${colors.bold}  ███    ███    ███  ▐███   ███▌ ███    ███  ███   ███   ███ ${colors.reset}`,
      `${colors.cyan}${colors.bold}  ███    ███    ▀███▄███▀   ███▌ ███    ███  ███   ███   ███ ${colors.reset}`,
      `${colors.brightCyan}${colors.bold}▀███████████    ████▀██▄   ███▌ ███    ███  ███   ███   ███ ${colors.reset}`,
      `${colors.cyan}${colors.bold}  ███    ███   ▐███  ▀███  ███  ███    ███  ███   ███   ███ ${colors.reset}`,
      `${colors.brightCyan}${colors.bold}  ███    ███  ▄███     ███▄ ███  ███    ███  ███   ███   ███ ${colors.reset}`,
      `${colors.cyan}${colors.bold}  ███    █▀  ████       ███▄█▀    ▀██████▀    ▀█   ███   █▀  ${colors.reset}`,
    ]
  : [
      "   AAAAAA  XX  XX  IIII   OOOO   MM   MM",
      "  AA   AA   XXXX    II   OO  OO  MMM MMM",
      "  AAAAAAA    XX     II   OO  OO  MM M MM",
      "  AA   AA   XXXX    II   OO  OO  MM   MM",
      "  AA   AA  XX  XX  IIII   OOOO   MM   MM",
    ];

export function getTerminalWidth(): number {
  const cols = process.stdout.columns || 80;
  return Math.min(Math.max(cols - 2, 60), 100);
}

export function padBetween(left: string, right: string, width: number): string {
  const visibleLeftLen = stripAnsi(left).length;
  const visibleRightLen = stripAnsi(right).length;
  const spaces = Math.max(1, width - visibleLeftLen - visibleRightLen);
  return left + " ".repeat(spaces) + right;
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
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

    // Top border
    console.log(`${colors.cyan}${colors.bold}╔${"═".repeat(w)}╗${colors.reset}`);

    // Logo
    for (const line of AXIOM_LOGO) {
      const visLen = stripAnsi(line).length;
      const pad = Math.max(0, w - visLen);
      console.log(`${colors.cyan}${colors.bold}║${colors.reset}${line}${" ".repeat(pad)}${colors.cyan}${colors.bold}║${colors.reset}`);
    }

    // Separator
    console.log(`${colors.cyan}${colors.bold}╠${"═".repeat(w)}╣${colors.reset}`);

    // Status bar
    const autoEditBadge = autoEdit
      ? `${colors.bold}${colors.brightGreen}● AUTO EDIT${colors.reset}`
      : `${colors.bold}${colors.brightYellow}● PLAN MODE${colors.reset}`;
    const modeLabel = autoEdit
      ? `${colors.dim}Autonomous Execution${colors.reset}`
      : `${colors.dim}Read-Only Inspection${colors.reset}`;
    const statusLine = `  ${autoEditBadge}  ${modeLabel}`;
    const statusPad = Math.max(1, w - stripAnsi(statusLine).length - 2);
    console.log(
      `${colors.cyan}${colors.bold}║${colors.reset}${statusLine}${" ".repeat(statusPad)}${colors.dim}Axiom v1.0${colors.reset}  ${colors.cyan}${colors.bold}║${colors.reset}`,
    );

    // Separator
    console.log(`${colors.cyan}${colors.bold}╠${"═".repeat(w)}╣${colors.reset}`);

    // Model + workspace info
    const wsName = workspacePath ? (path.basename(workspacePath) || workspacePath) : "~";
    const infoLeft = `  ${colors.dim}Model: ${colors.reset}${colors.brightWhite}${modelName}${colors.reset}`;
    const infoRight = `${colors.dim}Workspace: ${colors.reset}${colors.brightWhite}${wsName}${colors.reset}  `;
    console.log(`${colors.cyan}${colors.bold}║${colors.reset}${padBetween(infoLeft, infoRight, w)}${colors.cyan}${colors.bold}║${colors.reset}`);

    // Bottom border
    console.log(`${colors.cyan}${colors.bold}╠${"═".repeat(w)}╣${colors.reset}`);

    // Hint line
    const hint = `  ${colors.dim}Type a task, paste a GitHub URL, or /help for commands${colors.reset}`;
    const hintPad = Math.max(1, w - stripAnsi(hint).length);
    console.log(`${colors.cyan}${colors.bold}║${colors.reset}${hint}${" ".repeat(hintPad)}${colors.cyan}${colors.bold}║${colors.reset}`);
    console.log(`${colors.cyan}${colors.bold}╚${"═".repeat(w)}╝${colors.reset}`);
    console.log("");
  }

  printDivider(): void {
    const w = this.width;
    console.log(`${colors.dim}${"─".repeat(w + 2)}${colors.reset}`);
  }

  printFooter(promptPlaceholder = "Enter task..."): void {
    console.log(`\n${colors.dim}${promptPlaceholder}${colors.reset}`);
  }

  printPromptPrefix(): string {
    return `${colors.bold}${colors.brightCyan}❯ ${colors.reset}`;
  }

  printToolStart(name: string, title: string): void {
    if (this.assistantActive) {
      process.stdout.write("\n");
      this.assistantActive = false;
    }
    const label = formatToolStartLabel(name, title);
    console.log(`  ${colors.yellow}◉${colors.reset} ${colors.dim}${label}${colors.reset}`);
  }

  printToolEnd(ok: boolean, summary: string, rawContent?: string): void {
    if (this.assistantActive) {
      process.stdout.write("\n");
      this.assistantActive = false;
    }

    if (ok) {
      if (rawContent && isTestPassOutput(rawContent)) {
        const testMatch = rawContent.match(/(\d+\s+passing|\d+\s+tests?\s+passed)/i);
        const passSummary = testMatch ? testMatch[1] : summary;
        console.log(`  ${colors.brightGreen}✔${colors.reset} ${passSummary}`);
      } else {
        console.log(`  ${colors.brightGreen}✔${colors.reset} ${summary}`);
      }
    } else {
      const failureExtract = rawContent ? extractFailureSnippet(rawContent) : undefined;
      console.log(`  ${colors.brightRed}✘${colors.reset} ${summary}`);
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
      process.stdout.write("\n");
      this.assistantActive = false;
    }
    console.log(`  ${colors.yellow}◉${colors.reset} ${colors.dim}${status}${colors.reset}`);
  }

  printAssistantStart(): void {
    if (!this.assistantActive) {
      console.log(`\n  ${colors.bold}${colors.brightCyan}╭─ Axiom${colors.reset}`);
      process.stdout.write(`  ${colors.dim}│${colors.reset} `);
      this.assistantActive = true;
    }
  }

  printAssistantDelta(delta: string): void {
    if (!this.assistantActive) {
      this.printAssistantStart();
    }
    // Prefix each newline with the │ gutter
    const formatted = delta.replace(/\n/g, `\n  ${colors.dim}│${colors.reset} `);
    process.stdout.write(formatted);
  }

  printAssistantDone(): void {
    if (this.assistantActive) {
      process.stdout.write(`\n  ${colors.bold}${colors.brightCyan}╰─${colors.reset}\n\n`);
      this.assistantActive = false;
    }
  }

  printError(message: string): void {
    if (this.assistantActive) {
      process.stdout.write("\n");
      this.assistantActive = false;
    }
    console.log(`  ${colors.brightRed}✘ Error:${colors.reset} ${message}`);
  }

  printNotice(message: string): void {
    console.log(`  ${colors.brightCyan}ℹ${colors.reset} ${message}`);
  }

  /** Print an orchestration step (e.g. cloning, fetching issue). */
  printOrchestrationStep(step: string, detail?: string): void {
    if (this.assistantActive) {
      process.stdout.write("\n");
      this.assistantActive = false;
    }
    console.log(`  ${colors.cyan}◈${colors.reset} ${colors.bold}${step}${colors.reset}${detail ? `  ${colors.dim}${detail}${colors.reset}` : ""}`);
  }

  /** Print success of an orchestration step. */
  printOrchestrationDone(step: string, detail?: string): void {
    if (this.assistantActive) {
      process.stdout.write("\n");
      this.assistantActive = false;
    }
    console.log(`  ${colors.brightGreen}◈${colors.reset} ${colors.bold}${step}${colors.reset}${detail ? `  ${colors.dim}${detail}${colors.reset}` : ""}`);
  }

  /** Print a prominent section header. */
  printSectionHeader(title: string): void {
    if (this.assistantActive) {
      process.stdout.write("\n");
      this.assistantActive = false;
    }
    const w = this.width;
    const line = `── ${title} `;
    const pad = Math.max(0, w - line.length);
    console.log(`\n${colors.cyan}${colors.dim}${line}${"─".repeat(pad)}${colors.reset}`);
  }
}

function formatToolStartLabel(name: string, title: string): string {
  switch (name) {
    case "search_workspace":
      return `Searching workspace...`;
    case "list_files":
      return `Listing files...`;
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
      return match ? `Running: ${match[1]}` : `Running command...`;
    }
    case "fetch_repo": {
      const match = title.match(/→\s*(.+)$/);
      return match ? `Cloning repo: ${match[1]}` : `Cloning repository...`;
    }
    case "fetch_github_issue": {
      const match = title.match(/→\s*(.+)$/);
      return match ? `Fetching issue: ${match[1]}` : `Fetching GitHub issue...`;
    }
    default:
      return title || `Executing ${name}...`;
  }
}

function isTestPassOutput(content: string): boolean {
  return (
    /\b(\d+\s+passing|\d+\s+tests?\s+passed|test suites?:\s*\d+\s*passed)\b/i.test(content) &&
    !/\bfailed\b/i.test(content)
  );
}

function extractFailureSnippet(content: string): string | undefined {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /\b(\d+\s+tests?\s+failed|tests? failed|FAIL|AssertionError|Error:)\b/i.test(trimmed) &&
      !trimmed.startsWith("$") &&
      !trimmed.startsWith("exit code")
    ) {
      return trimmed.slice(0, 120);
    }
  }
  return undefined;
}
