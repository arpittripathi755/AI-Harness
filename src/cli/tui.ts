import * as path from "path";

const USE_COLOR =
  !process.env.NO_COLOR &&
  (process.stdout.isTTY || process.env.FORCE_COLOR === "1");

export const colors = {
  reset: USE_COLOR ? "\x1b[0m" : "",
  bold: USE_COLOR ? "\x1b[1m" : "",
  dim: USE_COLOR ? "\x1b[2m" : "",
  italic: USE_COLOR ? "\x1b[3m" : "",
  // Claude Code warm coral & pastel palette (256-color with ANSI fallbacks)
  coral: USE_COLOR ? "\x1b[38;5;209m" : "", // Claude coral
  amber: USE_COLOR ? "\x1b[38;5;214m" : "", // Warm gold
  cyan: USE_COLOR ? "\x1b[38;5;44m" : "",   // Soft cyan
  purple: USE_COLOR ? "\x1b[38;5;141m" : "", // Soft lavender
  slate: USE_COLOR ? "\x1b[38;5;244m" : "",  // Muted gray
  green: USE_COLOR ? "\x1b[38;5;77m" : "",   // Mint green
  red: USE_COLOR ? "\x1b[38;5;203m" : "",     // Soft red
  white: USE_COLOR ? "\x1b[97m" : "",
  // Background pill chips
  bgGreen: USE_COLOR ? "\x1b[48;5;22m" : "",
  bgYellow: USE_COLOR ? "\x1b[48;5;58m" : "",
  bgCyan: USE_COLOR ? "\x1b[48;5;24m" : "",
  bgCoral: USE_COLOR ? "\x1b[48;5;52m" : "",
};

export function getTerminalWidth(): number {
  const cols = process.stdout.columns || 80;
  return Math.min(Math.max(cols - 2, 60), 96);
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

    // Stylized Axiom ASCII Logo (Claude Code aesthetic)
    const logoLines = [
      "   █████╗ ██╗  ██╗██╗ ██████╗ ███╗   ███╗",
      "  ██╔══██╗╚██╗██╔╝██║██╔═══██╗████╗ ████║",
      "  ███████║ ╚███╔╝ ██║██║   ██║██╔████╔██║",
      "  ██╔══██║ ██╔██╗ ██║██║   ██║██║╚██╔╝██║",
      "  ██║  ██║██╔╝ ██╗██║╚██████╔╝██║ ╚═╝ ██║",
      "  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝",
    ];

    console.log("");
    for (const line of logoLines) {
      console.log(`  ${colors.coral}${colors.bold}${line}${colors.reset}`);
    }

    console.log(
      `\n  ${colors.bold}${colors.white}Axiom${colors.reset} ${colors.dim}v0.0.1${colors.reset} ${colors.slate}· Autonomous AI Coding Agent & Issue Solver${colors.reset}`,
    );

    // Claude Code style status pill badges
    const autoEditBadge = autoEdit
      ? `${colors.bgGreen}${colors.green}${colors.bold} ▰ AUTO EDIT: ON ${colors.reset}`
      : `${colors.bgYellow}${colors.amber}${colors.bold} ▰ PLAN MODE (READ-ONLY) ${colors.reset}`;

    const unrestrictedBadge = `${colors.bgCyan}${colors.cyan}${colors.bold} ▰ UNRESTRICTED ACCESS ${colors.reset}`;

    console.log(`\n  ${autoEditBadge}  ${unrestrictedBadge}`);

    // Context metadata line
    const relDir = path.basename(workspacePath) || workspacePath;
    console.log(
      `  ${colors.slate}Model:${colors.reset} ${colors.cyan}${modelName}${colors.reset}  ${colors.slate}Cwd:${colors.reset} ${colors.amber}${relDir}${colors.reset} ${colors.dim}(${workspacePath})${colors.reset}`,
    );

    console.log(
      `  ${colors.dim}Type ${colors.coral}/help${colors.dim} for commands · ${colors.coral}/clone <url>${colors.dim} to fetch repo · ${colors.coral}/cd <dir>${colors.dim} to move anywhere · ${colors.coral}Ctrl+C${colors.dim} to quit${colors.reset}`,
    );

    // Divider bar
    console.log(`\n  ${colors.slate}${"─".repeat(w - 4)}${colors.reset}\n`);
  }

  printPromptBox(placeholder = "What would you like to build or solve?"): void {
    const w = this.width;
    const title = ` ${placeholder} `;
    const innerW = Math.min(w - 4, 76);
    const lineLen = Math.max(2, innerW - title.length);

    console.log(`  ${colors.slate}╭─${colors.reset}${colors.bold}${colors.white}${title}${colors.reset}${colors.slate}${"─".repeat(lineLen)}╮${colors.reset}`);
    console.log(`  ${colors.slate}│${colors.reset} ${colors.dim}Type a task, issue URL, or command. Axiom keeps running until Ctrl+C.${colors.reset}`);
    console.log(`  ${colors.slate}╰${"─".repeat(innerW + 2)}╯${colors.reset}\n`);
  }

  printFooter(placeholder = "What would you like to build or solve?"): void {
    this.printPromptBox(placeholder);
  }

  printPromptPrefix(): string {
    return `  ${colors.coral}${colors.bold}❯${colors.reset} `;
  }

  printToolStart(name: string, title: string): void {
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    const { icon, label } = formatToolCard(name, title);
    console.log(`  ${icon} ${colors.amber}${label}${colors.reset}`);
  }

  printToolEnd(ok: boolean, summary: string, rawContent?: string): void {
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }

    if (ok) {
      if (rawContent && isTestPassOutput(rawContent)) {
        const testMatch = rawContent.match(
          /(\d+\s+passing|\d+\s+tests?\s+passed)/i,
        );
        const passSummary = testMatch ? testMatch[1] : summary;
        console.log(`    ${colors.green}${colors.bold}✔${colors.reset} ${colors.green}${passSummary}${colors.reset}`);
      } else {
        console.log(`    ${colors.green}${colors.bold}✔${colors.reset} ${colors.dim}${summary}${colors.reset}`);
      }
    } else {
      const failureExtract = rawContent
        ? extractFailureSnippet(rawContent)
        : undefined;
      console.log(`    ${colors.red}${colors.bold}✖${colors.reset} ${colors.red}${summary}${colors.reset}`);
      if (failureExtract) {
        console.log(`      ${colors.red}${failureExtract}${colors.reset}`);
      }
    }
  }

  printAssistantDelta(delta: string): void {
    process.stdout.write(delta);
  }

  printDivider(): void {
    const w = this.width;
    console.log(`\n  ${colors.slate}${"─".repeat(w - 4)}${colors.reset}\n`);
  }

  printStatus(status: string): void {
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    console.log(`  ${colors.slate}⋯ ${status}${colors.reset}`);
  }

  printAssistantStart(): void {
    if (!this.assistantActive) {
      console.log(`\n  ${colors.coral}╭─ Axiom ────────────────────────────────────────────────────────${colors.reset}`);
      this.assistantActive = true;
    }
  }

  printAssistantDone(): void {
    if (this.assistantActive) {
      console.log(`\n  ${colors.coral}╰────────────────────────────────────────────────────────────────${colors.reset}\n`);
      this.assistantActive = false;
    }
  }

  printError(message: string): void {
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    console.log(`  ${colors.red}${colors.bold}✖ Error:${colors.reset} ${colors.red}${message}${colors.reset}`);
  }

  printNotice(message: string): void {
    console.log(`  ${colors.dim}${message}${colors.reset}`);
  }
}

function formatToolCard(
  name: string,
  title: string,
): { icon: string; label: string } {
  switch (name) {
    case "fetch_github_issue": {
      const match = title.match(/→\s*(.+)$/);
      return {
        icon: `${colors.purple}📋${colors.reset}`,
        label: match ? `Fetching GitHub issue: ${match[1]}` : `Fetching GitHub issue...`,
      };
    }
    case "fetch_repo": {
      const match = title.match(/→\s*(.+)$/);
      return {
        icon: `${colors.coral}⚡${colors.reset}`,
        label: match ? `Cloning repository: ${match[1]}` : `Cloning repository...`,
      };
    }
    case "search_workspace": {
      const match = title.match(/→\s*(.+)$/);
      return {
        icon: `${colors.cyan}⚡${colors.reset}`,
        label: match ? `Searching workspace for "${match[1]}"` : `Searching workspace...`,
      };
    }
    case "list_files": {
      const match = title.match(/→\s*(.+)$/);
      return {
        icon: `${colors.purple}📁${colors.reset}`,
        label: match ? `Listing files in ${match[1]}` : `Listing workspace files`,
      };
    }
    case "read_file": {
      const match = title.match(/→\s*(.+)$/);
      return {
        icon: `${colors.cyan}📖${colors.reset}`,
        label: match ? `Reading ${match[1]}` : `Reading file...`,
      };
    }
    case "edit_file":
    case "multi_edit": {
      const match = title.match(/→\s*(.+)$/);
      return {
        icon: `${colors.amber}✏️ ${colors.reset}`,
        label: match ? `Editing ${match[1]}` : `Editing file...`,
      };
    }
    case "create_file": {
      const match = title.match(/→\s*(.+)$/);
      return {
        icon: `${colors.green}➕${colors.reset}`,
        label: match ? `Creating ${match[1]}` : `Creating file...`,
      };
    }
    case "delete_file": {
      const match = title.match(/→\s*(.+)$/);
      return {
        icon: `${colors.red}🗑️ ${colors.reset}`,
        label: match ? `Deleting ${match[1]}` : `Deleting file...`,
      };
    }
    case "rename_file": {
      const match = title.match(/→\s*(.+)$/);
      return {
        icon: `${colors.amber}🔄${colors.reset}`,
        label: match ? `Renaming ${match[1]}` : `Renaming file...`,
      };
    }
    case "run_command": {
      const match = title.match(/→\s*(.+)$/);
      return {
        icon: `${colors.coral}⚙️ ${colors.reset}`,
        label: match ? `Running \`${match[1]}\`` : `Running shell command...`,
      };
    }
    default:
      return {
        icon: `${colors.cyan}◉${colors.reset}`,
        label: title || `Executing ${name}...`,
      };
  }
}

function isTestPassOutput(output: string): boolean {
  return (
    /\d+\s+passing/i.test(output) ||
    /\d+\s+tests?\s+passed/i.test(output) ||
    /tests?:\s+\d+\s+passed/i.test(output) ||
    /ok\s+\d+\s+-\s+/i.test(output)
  );
}

function extractFailureSnippet(output: string): string | undefined {
  const lines = output.split("\n");
  for (const line of lines) {
    if (
      /error:|failed:|AssertionError|FAIL\s/i.test(line) &&
      !line.startsWith("$")
    ) {
      return line.trim().slice(0, 100);
    }
  }
  return undefined;
}
