import * as path from "path";

const USE_COLOR =
  !process.env.NO_COLOR &&
  (process.stdout.isTTY || process.env.FORCE_COLOR === "1");

const TRUECOLOR = (process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit') && USE_COLOR;

export const colors = {
  reset: USE_COLOR ? "\x1b[0m" : "",
  bold: USE_COLOR ? "\x1b[1m" : "",
  dim: USE_COLOR ? "\x1b[2m" : "",
  italic: USE_COLOR ? "\x1b[3m" : "",
  underline: USE_COLOR ? "\x1b[4m" : "",
  black: USE_COLOR ? "\x1b[30m" : "",
  red: USE_COLOR ? "\x1b[31m" : "",
  green: USE_COLOR ? "\x1b[32m" : "",
  yellow: USE_COLOR ? "\x1b[33m" : "",
  blue: USE_COLOR ? "\x1b[34m" : "",
  magenta: USE_COLOR ? "\x1b[35m" : "",
  cyan: USE_COLOR ? "\x1b[36m" : "",
  white: USE_COLOR ? "\x1b[37m" : "",
  brightBlack: USE_COLOR ? "\x1b[90m" : "",
  brightRed: USE_COLOR ? "\x1b[91m" : "",
  brightGreen: USE_COLOR ? "\x1b[92m" : "",
  brightYellow: USE_COLOR ? "\x1b[93m" : "",
  brightBlue: USE_COLOR ? "\x1b[94m" : "",
  brightMagenta: USE_COLOR ? "\x1b[95m" : "",
  brightCyan: USE_COLOR ? "\x1b[96m" : "",
  brightWhite: USE_COLOR ? "\x1b[97m" : "",
};

function rgb(r: number, g: number, b: number): string {
  if (TRUECOLOR) return `\x1b[38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m`;
  return colors.red; // fallback 16-color
}

export function getTerminalWidth(): number {
  const cols = process.stdout.columns || 80;
  return Math.min(Math.max(cols - 2, 50), 110);
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[([0-9;]*)m/g, "");
}

export function padBetween(left: string, right: string, width: number): string {
  const visibleLeftLen = stripAnsi(left).length;
  const visibleRightLen = stripAnsi(right).length;
  const spaces = Math.max(1, width - visibleLeftLen - visibleRightLen);
  return left + " ".repeat(spaces) + right;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (stripAnsi(current + ' ' + word).length > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
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
    case "web_search": {
      const match = title.match(/→\s*(.+)$/);
      return match ? `Searching web: ${match[1]}` : `Searching web...`;
    }
    case "web_fetch": {
      const match = title.match(/→\s*(.+)$/);
      return match ? `Fetching web page: ${match[1]}` : `Fetching web page...`;
    }
    default:
      return title || `Executing ${name}...`;
  }
}

class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private label = "";
  private active = false;

  start(label: string): void {
    this.label = label;
    this.active = true;
    this.frame = 0;
    if (!process.stdout.isTTY || !USE_COLOR) {
      process.stdout.write(`  ⠿ ${label}\n`);
      return;
    }
    process.stdout.write("\x1b[?25l");
    this.render();
    this.timer = setInterval(() => this.render(), 80);
  }

  stop(ok: boolean, finalLabel: string): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (process.stdout.isTTY && USE_COLOR) {
      process.stdout.write("\r\x1b[2K\x1b[?25h");
    }
    const icon = ok ? "\x1b[92m✔\x1b[0m" : "\x1b[91m✘\x1b[0m";
    process.stdout.write(`  ${icon}  \x1b[2m${finalLabel}\x1b[0m\n`);
  }

  stopSilent(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (process.stdout.isTTY && USE_COLOR) {
      process.stdout.write("\r\x1b[2K\x1b[?25h");
    }
  }

  private render(): void {
    if (!this.active) return;
    const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
    const f = frames[this.frame++ % frames.length];
    process.stdout.write(`\r\x1b[2K  \x1b[34m${f}\x1b[0m  \x1b[2m${this.label}\x1b[0m`);
  }
}

export class TerminalUI {
  private width: number;
  private assistantActive = false;
  private spinner = new Spinner();

  constructor() {
    this.width = getTerminalWidth();
  }

  async printBanner(modelName: string, providerName?: string): Promise<void> {
    const w = this.width;
    if (w >= 60) {
      const art = [
        " █████╗ ██╗  ██╗██╗ ██████╗ ███╗   ███╗",
        "██╔══██╗╚██╗██╔╝██║██╔═══██╗████╗ ████║",
        "███████║ ╚███╔╝ ██║██║   ██║██╔████╔██║",
        "██╔══██║ ██╔██╗ ██║██║   ██║██║╚██╔╝██║",
        "██║  ██║██╔╝ ██╗██║╚██████╔╝██║ ╚═╝ ██║",
        "╚═╝  ╚═╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝"
      ];
      console.log("");
      console.log(`${colors.dim}╔${'═'.repeat(w)}╗${colors.reset}`);
      console.log(`${colors.dim}║${' '.repeat(w)}║${colors.reset}`);
      
      for (const line of art) {
        let coloredLine = "";
        for (let i = 0; i < line.length; i++) {
          const t = i / Math.max(1, line.length - 1);
          const r = 150 + (255 - 150) * t;
          const g = 15 + (70 - 15) * t;
          const b = 5 + (40 - 5) * t;
          coloredLine += rgb(r, g, b) + line[i];
        }
        coloredLine += colors.reset;
        
        const padding = Math.max(0, w - line.length);
        const leftPad = Math.floor(padding / 2);
        const rightPad = padding - leftPad;
        
        console.log(`${colors.dim}║${colors.reset}${' '.repeat(leftPad)}${coloredLine}${' '.repeat(rightPad)}${colors.dim}║${colors.reset}`);
        await sleep(30);
      }
      
      const tagline = "  Autonomous Coding Agent  ·  Understand · Modify · Verify · Deliver  ";
      const taglinePadding = Math.max(0, w - tagline.length);
      const taglineLeft = Math.floor(taglinePadding / 2);
      const taglineRight = taglinePadding - taglineLeft;
      
      console.log(`${colors.dim}║${' '.repeat(taglineLeft)}${colors.italic}${tagline}${' '.repeat(taglineRight)}║${colors.reset}`);
      console.log(`${colors.dim}║${' '.repeat(w)}║${colors.reset}`);
      console.log(`${colors.dim}╠${'═'.repeat(w)}╣${colors.reset}`);
      
      const pName = providerName || "Unknown";
      const infoLeft = `  Model: ${modelName}`;
      const infoRight = `${pName}  `;
      const infoPadding = Math.max(0, w - infoLeft.length - infoRight.length);
      
      console.log(`${colors.dim}║${infoLeft}${' '.repeat(infoPadding)}${infoRight}║${colors.reset}`);
      console.log(`${colors.dim}╚${'═'.repeat(w)}╝${colors.reset}`);
      console.log("");
    } else {
      const text = "  A X I O M  ";
      let colored = "";
      for (let i = 0; i < text.length; i++) {
        const t = i / Math.max(1, text.length - 1);
        const r = 150 + (255 - 150) * t;
        const g = 15 + (70 - 15) * t;
        const b = 5 + (40 - 5) * t;
        colored += rgb(r, g, b) + text[i];
      }
      colored += colors.reset;
      console.log(`\n${colored}`);
      console.log(`${colors.dim}  Autonomous Coding Agent\n${colors.reset}`);
    }
  }

  printHeader(autoEdit: boolean, modelName: string, workspacePath: string, providerName?: string): void {
    const w = this.width;
    const wsName = path.basename(workspacePath) || workspacePath;
    const top = `┌${'─'.repeat(w)}┐`;
    const mid = `├${'─'.repeat(w)}┤`;
    const bottom = `└${'─'.repeat(w)}┘`;

    const axiomRed = rgb(220, 50, 30);
    const titleLeft = `  ${axiomRed}◆ AXIOM${colors.reset}`;
    
    const autoEditBadge = autoEdit
      ? `${colors.brightGreen}${colors.bold}▸ AUTO EDIT${colors.reset}  `
      : `${colors.brightYellow}${colors.bold}▸ PLAN MODE${colors.reset}  `;
      
    const titleLine = "│" + padBetween(titleLeft, autoEditBadge, w) + "│";
    
    const infoLeft = `  Model: ${modelName}`;
    const infoRight = `Workspace: ${wsName}  `;
    const infoLine = "│" + padBetween(infoLeft, infoRight, w) + "│";

    console.log(`${colors.dim}${colors.brightBlack}${top}${colors.reset}`);
    console.log(`${colors.dim}${colors.brightBlack}│${colors.reset}${padBetween(titleLeft, autoEditBadge, w)}${colors.dim}${colors.brightBlack}│${colors.reset}`);
    console.log(`${colors.dim}${colors.brightBlack}${mid}${colors.reset}`);
    console.log(`${colors.dim}${colors.brightBlack}│${colors.reset}${colors.dim}${padBetween(infoLeft, infoRight, w)}${colors.reset}${colors.dim}${colors.brightBlack}│${colors.reset}`);
    
    if (providerName) {
      const provLeft = `  Provider: ${providerName}`;
      const statusRight = `${colors.brightGreen}● Connected${colors.reset}  `;
      console.log(`${colors.dim}${colors.brightBlack}│${colors.reset}${padBetween(`${colors.dim}${provLeft}${colors.reset}`, statusRight, w)}${colors.dim}${colors.brightBlack}│${colors.reset}`);
    }
    
    console.log(`${colors.dim}${colors.brightBlack}${bottom}${colors.reset}`);
  }

  printDivider(): void {
    const w = this.width;
    console.log(`\x1b[90m${'─'.repeat(w + 2)}\x1b[0m`);
  }

  printFooter(promptPlaceholder = "Type your task here..."): void {
    const w = this.width;
    const topText = " YOUR TASK ";
    const fill = w - topText.length - 2;
    const top = `┌─${colors.brightCyan}${colors.bold}${topText}${colors.reset}${colors.dim}${colors.brightBlack}${'─'.repeat(fill)}┐${colors.reset}`;
    const bottom = `${colors.dim}${colors.brightBlack}└${'─'.repeat(w)}┘${colors.reset}`;
    
    const promptText = `  ${colors.brightCyan}${colors.bold}❯${colors.reset} ${promptPlaceholder}`;
    const promptLine = `${colors.dim}${colors.brightBlack}│${colors.reset}${padBetween(promptText, "", w)}${colors.dim}${colors.brightBlack}│${colors.reset}`;
    
    console.log(`${colors.dim}${colors.brightBlack}┌─${colors.reset}${colors.brightCyan}${colors.bold} YOUR TASK ${colors.reset}${colors.dim}${colors.brightBlack}${'─'.repeat(w - 11)}┐${colors.reset}`);
    console.log(promptLine);
    console.log(bottom);
  }

  printPromptPrefix(): string {
    return '\x1b[96m\x1b[1m❯ \x1b[0m';
  }

  printToolStart(name: string, title: string): void {
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    
    let icon = "◉";
    switch (name) {
      case "search_workspace":
      case "web_search":
      case "web_fetch":
        icon = "◎";
        break;
      case "list_files":
        icon = "◈";
        break;
      case "read_file":
        icon = "◉";
        break;
      case "edit_file":
      case "multi_edit":
        icon = "◐";
        break;
      case "create_file":
        icon = "⊕";
        break;
      case "delete_file":
        icon = "⊖";
        break;
      case "run_command":
        icon = "▶";
        break;
    }
    
    const label = `${icon} ${formatToolStartLabel(name, title)}`;
    this.spinner.start(label);
  }

  printToolEnd(ok: boolean, summary: string, rawContent?: string): void {
    this.spinner.stopSilent();
    
    if (ok) {
      let finalSummary = summary;
      if (rawContent && isTestPassOutput(rawContent)) {
        const testMatch = rawContent.match(/(\d+\s+passing|\d+\s+tests?\s+passed)/i);
        if (testMatch) finalSummary = testMatch[1];
      }
      console.log(`  \x1b[92m✔\x1b[0m  \x1b[2m${finalSummary}\x1b[0m`);
    } else {
      const snippet = rawContent ? extractFailureSnippet(rawContent) : undefined;
      console.log(`  \x1b[91m✘\x1b[0m  \x1b[2m${summary}\x1b[0m`);
      if (snippet) {
        console.log(`       \x1b[90m${snippet}\x1b[0m`);
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
    this.spinner.stopSilent();
    console.log(`  \x1b[2m· ${status}\x1b[0m`);
  }

  printAssistantStart(): void {
    this.spinner.stopSilent();
    if (!this.assistantActive) {
      const w = this.width;
      console.log("");
      console.log(`┌─ \x1b[31mAXIOM\x1b[0m ${'─'.repeat(w - 7)}┐`);
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
      const w = this.width;
      process.stdout.write('\n');
      console.log(`\x1b[2m└${'─'.repeat(w)}┘\x1b[0m`);
      console.log("");
      this.assistantActive = false;
    }
  }

  printError(message: string): void {
    this.spinner.stopSilent();
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    
    const w = this.width;
    const lines = wrapText(message, w - 6);
    
    console.log(`\x1b[91m┌─ ERROR ${'─'.repeat(w - 7)}┐\x1b[0m`);
    let first = true;
    for (const line of lines) {
      const icon = first ? "✘ " : "  ";
      first = false;
      const content = `  ${icon} ${line}`;
      const rightPadding = Math.max(0, w - stripAnsi(content).length);
      console.log(`\x1b[91m│\x1b[0m\x1b[97m${content}\x1b[0m${' '.repeat(rightPadding)}\x1b[91m│\x1b[0m`);
    }
    console.log(`\x1b[91m└${'─'.repeat(w)}┘\x1b[0m`);
  }

  printSuccess(message: string): void {
    this.spinner.stopSilent();
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    console.log(`  \x1b[92m✔\x1b[0m  ${message}`);
  }

  printNotice(message: string): void {
    const lines = message.split("\n");
    for (const line of lines) {
      console.log(`  \x1b[2m· ${line}\x1b[0m`);
    }
  }

  printPhase(phase: string): void {
    this.spinner.stopSilent();
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    
    const phaseColor: Record<string, string> = {
      EXPLORING: colors.blue,
      PLANNING: colors.cyan,
      EDITING: colors.yellow,
      VERIFYING: colors.magenta,
      COMPLETED: colors.brightGreen,
      DONE: colors.brightGreen,
      FAILED: colors.brightRed,
      BLOCKED: colors.brightRed,
    };
    
    const c = phaseColor[phase] ?? colors.dim;
    const w = this.width;
    const prefix = `  ${c}▶ ${phase}${colors.reset} `;
    const visiblePrefixLen = stripAnsi(`  ▶ ${phase} `).length;
    const fill = Math.max(0, w - visiblePrefixLen + 2);
    
    console.log(`\n${prefix}\x1b[90m${'─'.repeat(fill)}\x1b[0m\n`);
  }
}
