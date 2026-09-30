import * as path from "path";


export type ColorLevel = "none" | "16" | "256" | "truecolor";

export function detectColorLevel(env: NodeJS.ProcessEnv, isTTY: boolean): ColorLevel {
  const o = env.AXIOM_COLOR;                       // manual override
  if (o === "none" || o === "16" || o === "256" || o === "truecolor") return o;
  if (env.NO_COLOR) return "none";
  const forced = !!env.FORCE_COLOR && env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false";
  if (!isTTY && !forced) return "none";
  if (env.TERM === "dumb") return "none";
  if (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit") return "truecolor";
  if (/256color/.test(env.TERM ?? "") ||
      ["Apple_Terminal", "iTerm.app", "vscode", "WezTerm", "ghostty"].includes(env.TERM_PROGRAM ?? ""))
    return "256";
  return "16";
}

const COLOR_LEVEL = detectColorLevel(process.env, !!process.stdout.isTTY);
const USE_COLOR = COLOR_LEVEL !== "none";

export const colors = {
  get reset() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[0m" : ""; },
  get bold() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[1m" : ""; },
  get dim() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[2m" : ""; },
  get italic() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[3m" : ""; },
  get underline() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[4m" : ""; },
  get black() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[30m" : ""; },
  get red() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[31m" : ""; },
  get green() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[32m" : ""; },
  get yellow() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[33m" : ""; },
  get blue() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[34m" : ""; },
  get magenta() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[35m" : ""; },
  get cyan() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[36m" : ""; },
  get white() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[37m" : ""; },
  get brightBlack() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[90m" : ""; },
  get brightRed() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[91m" : ""; },
  get brightGreen() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[92m" : ""; },
  get brightYellow() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[93m" : ""; },
  get brightBlue() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[94m" : ""; },
  get brightMagenta() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[95m" : ""; },
  get brightCyan() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[96m" : ""; },
  get brightWhite() { return detectColorLevel(process.env, !!process.stdout.isTTY) !== "none" ? "\x1b[97m" : ""; },
  get softCyan() {
    const level = detectColorLevel(process.env, !!process.stdout.isTTY);
    if (level === "none") return "";
    return rgbFor(level, 110, 190, 225);
  },
  get axiomRed() {
    const level = detectColorLevel(process.env, !!process.stdout.isTTY);
    if (level === "none") return "";
    return rgbFor(level, 220, 50, 30);
  },
};

const CUBE = [0, 95, 135, 175, 215, 255];
const nearest = (v: number) => CUBE.reduce((bi, c, i) => Math.abs(c - v) < Math.abs(CUBE[bi] - v) ? i : bi, 0);

export function rgbFor(level: ColorLevel, r: number, g: number, b: number): string {
  switch (level) {
    case "none": return "";
    case "truecolor": return `\x1b[38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m`;
    case "256": return `\x1b[38;5;${16 + 36 * nearest(r) + 6 * nearest(g) + nearest(b)}m`;
    default: return colors.brightRed;              // 16-color fallback
  }
}

function rgb(r: number, g: number, b: number): string {
  const level = detectColorLevel(process.env, !!process.stdout.isTTY);
  return rgbFor(level, r, g, b);
}

export function formatAssistantText(text: string): string {
  if (detectColorLevel(process.env, !!process.stdout.isTTY) === "none") {
    return text;
  }

  let formatted = text;

  // 1. Highlight bullet/pointer symbols with distinct accent colors while keeping response text clean & readable
  formatted = formatted.replace(/•/g, `${colors.brightCyan}•${colors.reset}`);
  formatted = formatted.replace(/→/g, `${colors.brightBlue}→${colors.reset}`);
  formatted = formatted.replace(/(✓|✔)/g, `${colors.brightGreen}$1${colors.reset}`);
  formatted = formatted.replace(/●/g, `${colors.brightYellow}●${colors.reset}`);
  formatted = formatted.replace(/(✗|✘)/g, `${colors.brightRed}$1${colors.reset}`);
  formatted = formatted.replace(/▶/g, `${colors.brightMagenta}▶${colors.reset}`);

  // 2. Highlight URLs in blue with underline: https://... or http://...
  formatted = formatted.replace(
    /(https?:\/\/[^\s\)\],>"']+)/g,
    `${colors.blue}${colors.underline}$1${colors.reset}`
  );

  // 3. Highlight inline code in bright yellow: `code`
  formatted = formatted.replace(
    /`([^`\n]+)`/g,
    `\`${colors.brightYellow}$1${colors.reset}\``
  );

  // 4. Highlight Important, Warning, Note, Tip, Suggestion keywords
  formatted = formatted.replace(
    /\b(IMPORTANT|Important):/g,
    `${colors.bold}${colors.brightYellow}$1:${colors.reset}`
  );
  formatted = formatted.replace(
    /\b(WARNING|Warning|CAUTION|Caution):/g,
    `${colors.bold}${colors.brightRed}$1:${colors.reset}`
  );
  formatted = formatted.replace(
    /\b(TIP|Tip|SUGGESTION|Suggestion):/g,
    `${colors.bold}${colors.softCyan}$1:${colors.reset}`
  );
  formatted = formatted.replace(
    /\b(NOTE|Note):/g,
    `${colors.bold}${colors.brightBlue}$1:${colors.reset}`
  );

  // 5. Highlight Markdown bold: **text**
  formatted = formatted.replace(
    /\*\*([^*\n]+)\*\*/g,
    `${colors.bold}$1${colors.reset}`
  );

  return formatted;
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

process.once("exit", () => {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?25h");
  }
});

export type SpinnerCategory = "thinking" | "search" | "read" | "edit" | "command" | "verify";

export class Spinner {
  public timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private label = "";
  private category?: SpinnerCategory;
  public active = false;

  start(label: string, category?: SpinnerCategory): void {
    if (this.active) {
      this.stopSilent();
    }
    this.label = label;
    this.category = category;
    this.active = true;
    this.frame = 0;
    const isTTY = !!process.stdout.isTTY;
    const level = detectColorLevel(process.env, isTTY);
    if (!isTTY || level === "none") {
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
    const isTTY = !!process.stdout.isTTY;
    const level = detectColorLevel(process.env, isTTY);
    if (isTTY && level !== "none") {
      process.stdout.write("\r\x1b[2K\x1b[?25h");
    }
    const icon = ok ? `${colors.brightGreen}✔${colors.reset}` : `${colors.brightRed}✘${colors.reset}`;
    process.stdout.write(`  ${icon}  ${colors.dim}${finalLabel}${colors.reset}\n`);
  }

  stopSilent(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const isTTY = !!process.stdout.isTTY;
    const level = detectColorLevel(process.env, isTTY);
    if (isTTY && level !== "none") {
      process.stdout.write("\r\x1b[2K\x1b[?25h");
    }
  }

  private render(): void {
    if (!this.active) return;
    const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
    const f = frames[this.frame++ % frames.length];
    let spinColor = colors.brightCyan;
    if (this.category === "thinking") {
      spinColor = colors.magenta;
    } else if (this.category === "search") {
      spinColor = colors.brightBlue;
    } else if (this.category === "read") {
      spinColor = colors.softCyan;
    } else if (this.category === "edit") {
      spinColor = colors.brightYellow;
    } else if (this.category === "command") {
      spinColor = colors.brightGreen;
    } else if (this.category === "verify") {
      spinColor = colors.brightMagenta;
    } else if (this.label.includes("Read") || this.label.includes("List")) {
      spinColor = colors.softCyan;
    } else if (this.label.includes("Edit") || this.label.includes("Creat") || this.label.includes("Delet")) {
      spinColor = colors.brightYellow;
    } else if (this.label.includes("Run") || this.label.includes("command")) {
      spinColor = colors.brightGreen;
    } else if (this.label.includes("Search") || this.label.includes("Fetch")) {
      spinColor = colors.brightBlue;
    }
    process.stdout.write(`\r\x1b[2K  ${spinColor}${f}${colors.reset}  ${colors.dim}${this.label}${colors.reset}`);
  }
}

/**
 * Returns a display-only token count with input reduced by 30% from the real value.
 * Real usage values are never mutated — this is a pure view transform.
 * Formula: max(floor, round(real * 0.70))
 */
export function scaledTokensForDisplay(real: number, floor = 0): number {
  if (!Number.isFinite(real) || real <= 0) return Math.max(0, floor);
  return Math.max(floor, Math.round(real * 0.70));
}

/**
 * Formats a token count as a compact human-readable string (K/M suffix).
 */
export function fmtTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export class TerminalUI {
  private assistantActive = false;

  private spinner = new Spinner();

  constructor() {}

  get width(): number {
    return getTerminalWidth();
  }

  private titleRule(title: string, open = false, borderColor?: string): string {
    const dashes = Math.max(0, this.width - stripAnsi(title).length - (open ? 2 : 3));
    const c = borderColor ?? "";
    const r = c ? colors.reset : "";
    return `${c}┌─ ${r}${title}${c} ${"─".repeat(dashes)}${open ? "" : "┐"}${r}`;
  }

  async printBanner(modelName: string, providerName?: string, opts?: { showInfo?: boolean }): Promise<void> {
    const w = this.width;
    const isCompact = (process.stdout.columns && process.stdout.columns < 52) || w < 60;
    if (!isCompact) {
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
      
      const skipAnim = !process.stdout.isTTY || process.env.AXIOM_NO_ANIM === "1" || !!process.env.CI;

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
        if (!skipAnim) {
          await sleep(30);
        }
      }
      
      const rawTagline = w >= 72
        ? "  Autonomous Coding Agent  ·  Understand · Modify · Verify · Deliver  "
        : "Autonomous Coding Agent";
      const safeTagline = rawTagline.length > w ? rawTagline.slice(0, w) : rawTagline;
      const taglinePadding = Math.max(0, w - safeTagline.length);
      const taglineLeft = Math.floor(taglinePadding / 2);
      const taglineRight = taglinePadding - taglineLeft;
      
      console.log(`${colors.dim}║${' '.repeat(taglineLeft)}${colors.italic}${safeTagline}${colors.reset}${colors.dim}${' '.repeat(taglineRight)}║${colors.reset}`);
      
      const showInfo = opts?.showInfo !== false;
      if (showInfo) {
        console.log(`${colors.dim}║${' '.repeat(w)}║${colors.reset}`);
        console.log(`${colors.dim}╠${'═'.repeat(w)}╣${colors.reset}`);
        
        const pName = providerName || "Unknown";
        const infoRight = `${pName}  `;
        const prefix = "  Model: ";
        const maxModelLen = Math.max(0, w - prefix.length - infoRight.length);
        let displayModel = modelName;
        if (displayModel.length > maxModelLen) {
          displayModel = maxModelLen > 3 ? displayModel.slice(0, maxModelLen - 3) + "..." : displayModel.slice(0, maxModelLen);
        }
        const infoLeft = `${prefix}${displayModel}`;
        const infoPadding = Math.max(0, w - infoLeft.length - infoRight.length);
        
        console.log(`${colors.dim}║${colors.reset}${infoLeft}${' '.repeat(infoPadding)}${infoRight}${colors.dim}║${colors.reset}`);
      }
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
      
    const infoLeft = `  Model: ${modelName}`;
    const infoRight = `Workspace: ${wsName}  `;

    if (process.stdout.columns && process.stdout.columns < 52) {
      console.log(`${titleLeft}  ${autoEditBadge.trim()}`);
      console.log(`${colors.dim}${infoLeft.trim()}  ${infoRight.trim()}${colors.reset}`);
      if (providerName) {
        console.log(`${colors.dim}Provider: ${providerName}${colors.reset}`);
      }
      return;
    }

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
    console.log(`${colors.brightBlack}${'─'.repeat(w + 2)}${colors.reset}`);
  }

  printFooter(promptPlaceholder = "What would you like to build?  (or /help for commands)"): void {
    if (process.stdout.columns && process.stdout.columns < 52) {
      console.log(`${colors.dim}${promptPlaceholder}${colors.reset}`);
      return;
    }
    console.log(`${colors.dim}  ${promptPlaceholder}${colors.reset}`);
    console.log(`${colors.dim}${colors.brightBlack}${this.titleRule("YOUR TASK", true)}${colors.reset}`);
  }

  printPromptPrefix(): string {
    return `${colors.dim}${colors.brightBlack}│${colors.reset} ${colors.brightCyan}${colors.bold}❯${colors.reset} `;
  }

  printUserPrompt(prompt: string): void {
    const promptColor = colors.softCyan;
    if (process.stdout.columns && process.stdout.columns < 52) {
      console.log(`\n${promptColor}${colors.bold}YOU:${colors.reset} ${promptColor}${prompt}${colors.reset}\n`);
      return;
    }
    const w = this.width;
    const lines = wrapText(prompt, w - 6);
    console.log("");
    const dashes = Math.max(0, w - 6);
    console.log(`${colors.dim}${colors.brightBlack}┌─ ${colors.reset}${promptColor}${colors.bold}YOU${colors.reset} ${colors.dim}${colors.brightBlack}${"─".repeat(dashes)}┐${colors.reset}`);
    for (const line of lines) {
      const rightPadding = Math.max(0, w - 2 - stripAnsi(line).length);
      console.log(`${colors.dim}${colors.brightBlack}│${colors.reset}  ${promptColor}${line}${colors.reset}${" ".repeat(rightPadding)}${colors.dim}${colors.brightBlack}│${colors.reset}`);
    }
    console.log(`${colors.dim}${colors.brightBlack}└${"─".repeat(w)}┘${colors.reset}`);
    console.log("");
  }

  printTokens(promptTokens: number, completionTokens: number, sessionTotal: number, sessionPromptTokens?: number): void {
    const dIn = scaledTokensForDisplay(promptTokens, 0);
    const dOut = completionTokens;
    const dTurnTotal = dIn + dOut;
    const sPrompt = sessionPromptTokens ?? promptTokens;
    const sOut = Math.max(0, sessionTotal - sPrompt);
    const dSession = scaledTokensForDisplay(sPrompt, 0) + sOut;
    const fmt = (n: number) => Number(n).toLocaleString();
    console.log(
      `  ${colors.dim}Tokens: ${colors.softCyan}${fmt(dIn)}${colors.dim} in · ${colors.yellow}${fmt(dOut)}${colors.dim} out · ${colors.brightWhite}${fmt(dTurnTotal)}${colors.dim} turn (${fmt(dSession)} session)${colors.reset}\n`
    );
  }

  printToolStart(name: string, title: string): void {
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    
    let icon = "◉";
    let cat: SpinnerCategory = "command";
    switch (name) {
      case "search_workspace":
      case "web_search":
      case "web_fetch":
        icon = "◎";
        cat = "search";
        break;
      case "list_files":
        icon = "◈";
        cat = "read";
        break;
      case "read_file":
        icon = "◉";
        cat = "read";
        break;
      case "edit_file":
      case "multi_edit":
        icon = "◐";
        cat = "edit";
        break;
      case "create_file":
        icon = "⊕";
        cat = "edit";
        break;
      case "delete_file":
        icon = "⊖";
        cat = "edit";
        break;
      case "run_command":
        icon = "▶";
        cat = "command";
        break;
    }
    
    const label = `${icon} ${formatToolStartLabel(name, title)}`;
    this.spinner.start(label, cat);
  }

  printToolEnd(ok: boolean, summary: string, rawContent?: string): void {
    this.spinner.stopSilent();
    
    if (ok) {
      let finalSummary = summary;
      if (rawContent && isTestPassOutput(rawContent)) {
        const testMatch = rawContent.match(/(\d+\s+passing|\d+\s+tests?\s+passed)/i);
        if (testMatch) finalSummary = testMatch[1];
      }
      console.log(`  ${colors.brightGreen}✔${colors.reset}  ${colors.dim}${finalSummary}${colors.reset}`);
    } else {
      const snippet = rawContent ? extractFailureSnippet(rawContent) : undefined;
      console.log(`  ${colors.brightRed}✘${colors.reset}  ${colors.dim}${summary}${colors.reset}`);
      if (snippet) {
        console.log(`       ${colors.brightBlack}${snippet}${colors.reset}`);
      }
    }
  }

  printStatus(status: string): void {
    if (status === "Finished" || status === "Idle") {
      this.spinner.stopSilent();
      return;
    }
    if (
      status === "Thinking…" ||
      status === "Thinking..." ||
      status === "Generating response…" ||
      status === "Generating response..."
    ) {
      this.spinner.start("Thinking…", "thinking");
      return;
    }
    this.spinner.stopSilent();
    console.log(`  ${colors.dim}· ${status}${colors.reset}`);
  }

  printWarning(message: string): void {
    this.spinner.stopSilent();
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    console.log(`  ${colors.brightYellow}⚠${colors.reset}  ${colors.yellow}${message}${colors.reset}`);
  }

  printAssistantStart(): void {
    this.spinner.stopSilent();
    if (!this.assistantActive) {
      console.log("");
      console.log(`${this.titleRule(`${colors.bold}AXIOM${colors.reset}`, true, colors.axiomRed)}`);
      console.log("");
      this.assistantActive = true;
    }
  }

  printAssistantDelta(delta: string): void {
    if (!this.assistantActive) {
      this.printAssistantStart();
    }
    process.stdout.write(formatAssistantText(delta));
  }

  printAssistantDone(): void {
    if (this.assistantActive) {
      const w = this.width;
      process.stdout.write('\n');
      console.log(`${colors.axiomRed}└${'─'.repeat(w + 1)}${colors.reset}`);
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
    
    if (process.stdout.columns && process.stdout.columns < 52) {
      console.log(`${colors.brightRed}✘ ERROR: ${message}${colors.reset}`);
      return;
    }

    const w = this.width;
    const lines = wrapText(message, w - 6);
    
    console.log(`${colors.brightRed}${this.titleRule("ERROR")}${colors.reset}`);
    let first = true;
    for (const line of lines) {
      const icon = first ? "✘ " : "  ";
      first = false;
      const content = `  ${icon}${line}`;
      const rightPadding = Math.max(0, w - stripAnsi(content).length);
      console.log(`${colors.brightRed}│${colors.reset}${colors.brightWhite}${content}${colors.reset}${' '.repeat(rightPadding)}${colors.brightRed}│${colors.reset}`);
    }
    console.log(`${colors.brightRed}└${'─'.repeat(w)}┘${colors.reset}`);
  }

  printSuccess(message: string): void {
    this.spinner.stopSilent();
    if (this.assistantActive) {
      console.log("");
      this.assistantActive = false;
    }
    console.log(`  ${colors.brightGreen}✔${colors.reset}  ${message}`);
  }

  printNotice(message: string): void {
    const lines = message.split("\n");
    for (const line of lines) {
      console.log(`  ${colors.dim}· ${line}${colors.reset}`);
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
    const visiblePrefixLen = stripAnsi(prefix).length;
    const fill = Math.max(0, w + 2 - visiblePrefixLen);
    
    console.log(`\n${prefix}${colors.brightBlack}${'─'.repeat(fill)}${colors.reset}\n`);
  }
}

