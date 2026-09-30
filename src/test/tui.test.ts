import * as assert from "assert";
import {
  detectColorLevel,
  rgbFor,
  TerminalUI,
  Spinner,
  colors,
  stripAnsi,
  formatAssistantText,
  scaledTokensForDisplay,
  fmtTokenCount,
} from "../cli/tui";
import { UsageTracker } from "../llm/usageTracker";

suite("TerminalUI & Color System (TUI Fixes)", () => {
  const ENV_KEYS = [
    "NO_COLOR",
    "FORCE_COLOR",
    "COLORTERM",
    "AXIOM_COLOR",
    "TERM",
    "TERM_PROGRAM",
    "AXIOM_NO_ANIM",
  ] as const;

  let savedEnv: Record<string, string | undefined> = {};
  let savedColumns: number | undefined;

  setup(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    savedColumns = process.stdout.columns;
    process.env.AXIOM_NO_ANIM = "1";
  });

  teardown(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
    if (savedColumns !== undefined) {
      Object.defineProperty(process.stdout, "columns", {
        value: savedColumns,
        writable: true,
        configurable: true,
      });
    }
  });

  suite("1. detectColorLevel", () => {
    test("NO_COLOR=1 gives 'none'", () => {
      const level = detectColorLevel({ NO_COLOR: "1" }, true);
      assert.strictEqual(level, "none");
    });

    test("non-TTY gives 'none'", () => {
      const level = detectColorLevel({}, false);
      assert.strictEqual(level, "none");
    });

    test("non-TTY + FORCE_COLOR=1 gives '16'", () => {
      const level = detectColorLevel({ FORCE_COLOR: "1" }, false);
      assert.strictEqual(level, "16");
    });

    test("COLORTERM=truecolor gives 'truecolor'", () => {
      const level = detectColorLevel({ COLORTERM: "truecolor" }, true);
      assert.strictEqual(level, "truecolor");
    });

    test("COLORTERM=24bit gives 'truecolor'", () => {
      const level = detectColorLevel({ COLORTERM: "24bit" }, true);
      assert.strictEqual(level, "truecolor");
    });

    test("TERM=xterm-256color gives '256'", () => {
      const level = detectColorLevel({ TERM: "xterm-256color" }, true);
      assert.strictEqual(level, "256");
    });

    test("TERM_PROGRAM=Apple_Terminal gives '256'", () => {
      const level = detectColorLevel({ TERM_PROGRAM: "Apple_Terminal" }, true);
      assert.strictEqual(level, "256");
    });

    test("TERM=dumb gives 'none'", () => {
      const level = detectColorLevel({ TERM: "dumb" }, true);
      assert.strictEqual(level, "none");
    });

    test("AXIOM_COLOR=256 overrides everything", () => {
      const level = detectColorLevel({ AXIOM_COLOR: "256", NO_COLOR: "1" }, false);
      assert.strictEqual(level, "256");
    });
  });

  suite("2. rgbFor per level", () => {
    test("level 'none' returns empty string", () => {
      assert.strictEqual(rgbFor("none", 200, 100, 50), "");
    });

    test("level 'truecolor' returns 24-bit ANSI sequence", () => {
      const out = rgbFor("truecolor", 200, 100, 50);
      assert.strictEqual(out, "\x1b[38;2;200;100;50m");
    });

    test("level '256' maps to xterm 6x6x6 cube using nearest levels", () => {
      const out = rgbFor("256", 255, 0, 0);
      assert.strictEqual(out, `\x1b[38;5;196m`);
    });

    test("level '16' returns brightRed fallback", () => {
      const out = rgbFor("16", 200, 100, 50);
      assert.strictEqual(out, colors.brightRed);
    });
  });

  suite("3. Alignment regression tests", () => {
    async function captureOutput(fn: () => void | Promise<void>): Promise<string[]> {
      const lines: string[] = [];
      const origLog = console.log;
      const origWrite = process.stdout.write;

      console.log = (...args: any[]) => {
        lines.push(args.join(" "));
      };
      process.stdout.write = (chunk: any) => {
        lines.push(String(chunk));
        return true;
      };

      try {
        await fn();
      } finally {
        console.log = origLog;
        process.stdout.write = origWrite;
      }

      return lines.join("\n").split("\n");
    }

    const testWidths = [60, 80, 100, 140];

    for (const cols of testWidths) {
      test(`verifies box line alignment at columns=${cols}`, async () => {
        Object.defineProperty(process.stdout, "columns", {
          value: cols,
          writable: true,
          configurable: true,
        });

        const tui = new TerminalUI();
        const expectedFramedWidth = tui.width + 2;
        assert.ok(expectedFramedWidth <= cols, `Framed width ${expectedFramedWidth} must be <= columns ${cols}`);

        const captured = await captureOutput(async () => {
          await tui.printBanner("test/model", "TestProvider", { showInfo: true });
          await tui.printBanner("test/model", "TestProvider", { showInfo: false });
          tui.printHeader(true, "test/model", "/test/workspace", "TestProvider");
          tui.printUserPrompt("Test user prompt message for width alignment verification");
          tui.printFooter("What would you like to build?");
          tui.printError("This is a long error message that will wrap across lines to test borders");
          tui.printPhase("EXPLORING");
          tui.printAssistantStart();
          tui.printAssistantDelta("Streaming text delta");
          tui.printAssistantDone();
          tui.printDivider();
        });

        const frameChars = ["┌", "└", "├", "│", "╔", "╚", "╠", "║", "▶"];

        for (const rawLine of captured) {
          const stripped = stripAnsi(rawLine).trimEnd();
          if (!stripped) continue;

          const isFramed = frameChars.some(
            (ch) =>
              stripped.startsWith(ch) ||
              stripped.endsWith("┐") ||
              stripped.endsWith("┘") ||
              stripped.endsWith("╗") ||
              stripped.endsWith("╝") ||
              stripped.startsWith("  ▶"),
          );
          if (isFramed) {
            assert.strictEqual(
              stripped.length,
              expectedFramedWidth,
              `Line "${stripped}" has length ${stripped.length}, expected exactly ${expectedFramedWidth} (cols=${cols})`,
            );
            assert.ok(
              stripped.length <= cols,
              `Line "${stripped}" length ${stripped.length} exceeds terminal columns ${cols}`,
            );
          }
        }
      });
    }
  });

  suite("4. NO_COLOR=1 clean output", () => {
    async function captureOutput(fn: () => void | Promise<void>): Promise<string[]> {
      const lines: string[] = [];
      const origLog = console.log;
      const origWrite = process.stdout.write;

      console.log = (...args: any[]) => {
        lines.push(args.join(" "));
      };
      process.stdout.write = (chunk: any) => {
        lines.push(String(chunk));
        return true;
      };

      try {
        await fn();
      } finally {
        console.log = origLog;
        process.stdout.write = origWrite;
      }

      return lines;
    }

    test("contains no \\x1b[ sequences when colors are disabled", async () => {
      process.env.NO_COLOR = "1";
      delete process.env.FORCE_COLOR;
      delete process.env.COLORTERM;

      const tui = new TerminalUI();
      const output = await captureOutput(async () => {
        await tui.printBanner("model", "provider", { showInfo: false });
        tui.printHeader(false, "model", "/path", "provider");
        tui.printUserPrompt("test prompt");
        tui.printFooter("prompt");
        tui.printError("error");
        tui.printSuccess("success");
        tui.printNotice("notice");
        tui.printPhase("PLANNING");
        tui.printDivider();
        tui.printStatus("working");
        tui.printToolStart("read_file", "Reading file");
        tui.printToolEnd(true, "read ok");
        tui.printAssistantStart();
        tui.printAssistantDelta("delta");
        tui.printAssistantDone();
        tui.printTokens(100, 50, 150);
      });

      for (const line of output) {
        const colorEscapeMatch = line.match(/\x1b\[[0-9;]*m/g);
        assert.strictEqual(
          colorEscapeMatch,
          null,
          `Found color escape sequences in NO_COLOR output: ${JSON.stringify(colorEscapeMatch)} in line: ${line}`,
        );
      }
    });
  });

  suite("5. Spinner timer robustness", () => {
    test("calling start() twice leaves exactly one active timer; stopSilent() clears it", () => {
      const origIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });
      process.env.AXIOM_COLOR = "truecolor";

      try {
        const spinner = new Spinner();
        spinner.start("task 1");
        const firstTimer = spinner.timer;
        assert.ok(firstTimer !== null, "First timer must be set");
        assert.strictEqual(spinner.active, true);

        spinner.start("task 2");
        const secondTimer = spinner.timer;
        assert.ok(secondTimer !== null, "Second timer must be set");
        assert.notStrictEqual(firstTimer, secondTimer, "First timer must have been replaced");
        assert.strictEqual(spinner.active, true);

        spinner.stopSilent();
        assert.strictEqual(spinner.timer, null, "stopSilent must clear timer");
        assert.strictEqual(spinner.active, false, "stopSilent must set active=false");
      } finally {
        Object.defineProperty(process.stdout, "isTTY", {
          value: origIsTTY,
          writable: true,
          configurable: true,
        });
        delete process.env.AXIOM_COLOR;
      }
    });
  });

  suite("6. Formatting, symbols, and highlights", () => {
    test("formatAssistantText highlights bullet symbols (•, →, ✓, ●) with accent colors", () => {
      process.env.AXIOM_COLOR = "truecolor";
      const formatted = formatAssistantText("• Bullet item → Next step ✓ Passed ● Active dot");
      assert.ok(formatted.includes("\x1b[96m•"), "Bullet • should be highlighted in bright cyan");
      assert.ok(formatted.includes("\x1b[94m→"), "Arrow → should be highlighted in bright blue");
      assert.ok(formatted.includes("\x1b[92m✓"), "Checkmark ✓ should be highlighted in bright green");
      assert.ok(formatted.includes("\x1b[93m●"), "Dot ● should be highlighted in bright yellow");
    });

    test("formatAssistantText formats URLs with blue and underline in truecolor mode", () => {
      process.env.AXIOM_COLOR = "truecolor";
      const formatted = formatAssistantText("Visit https://example.com/docs for details");
      assert.ok(formatted.includes("https://example.com/docs"), "Must include URL");
      assert.ok(formatted.includes("\x1b[34m"), "Must include blue color code");
      assert.ok(formatted.includes("\x1b[4m"), "Must include underline code");
    });

    test("formatAssistantText highlights inline code in bright yellow", () => {
      process.env.AXIOM_COLOR = "truecolor";
      const formatted = formatAssistantText("Check `src/index.ts` file");
      assert.ok(formatted.includes("`\x1b[93msrc/index.ts\x1b[0m`"), "Must wrap inline code in yellow");
    });

    test("formatAssistantText highlights keywords (Important, Warning, Tip, Note)", () => {
      process.env.AXIOM_COLOR = "truecolor";
      const formatted = formatAssistantText("Important: Note: Warning: Tip:");
      assert.ok(formatted.includes("Important:"));
      assert.ok(formatted.includes("Warning:"));
      assert.ok(formatted.includes("Tip:"));
      assert.ok(formatted.includes("Note:"));
    });

    test("formatAssistantText formats markdown bold text with bold ANSI sequence", () => {
      process.env.AXIOM_COLOR = "truecolor";
      const formatted = formatAssistantText("This is **key information** here");
      assert.ok(formatted.includes("\x1b[1mkey information\x1b[0m"), "Must format **bold** as bold ANSI");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 7 — TUI token-display scaling (display-only, 30% input reduction)
  // ─────────────────────────────────────────────────────────────────────────
  suite("7. TUI token-display scaling", () => {
    // ── scaledTokensForDisplay (70% of real, floor 0) ───────────────────────

    test("scaledTokensForDisplay: reduces input by 30% (326764 × 0.70 → 228735)", () => {
      const real = 326_764;
      const display = scaledTokensForDisplay(real, 0);
      assert.strictEqual(display, Math.round(real * 0.70));
      assert.strictEqual(display, 228_735);
    });

    test("scaledTokensForDisplay: 45000 (hi-task) × 0.70 → 31500", () => {
      assert.strictEqual(scaledTokensForDisplay(45_000, 0), 31_500);
    });

    test("scaledTokensForDisplay: 80000 (React project) × 0.70 → 56000", () => {
      assert.strictEqual(scaledTokensForDisplay(80_000, 0), 56_000);
    });

    test("scaledTokensForDisplay: zero real → 0", () => {
      assert.strictEqual(scaledTokensForDisplay(0, 0), 0);
    });

    test("scaledTokensForDisplay: negative real → 0", () => {
      assert.strictEqual(scaledTokensForDisplay(-500, 0), 0);
    });

    test("scaledTokensForDisplay: NaN → 0", () => {
      assert.strictEqual(scaledTokensForDisplay(NaN, 0), 0);
    });

    test("scaledTokensForDisplay: Infinity → 0", () => {
      assert.strictEqual(scaledTokensForDisplay(Infinity, 0), 0);
    });

    test("scaledTokensForDisplay: 1M × 0.70 → 700000", () => {
      assert.strictEqual(scaledTokensForDisplay(1_000_000, 0), 700_000);
    });

    // ── fmtTokenCount (pure utility preserved) ──────────────────────────────

    test("fmtTokenCount: formats numbers with K/M suffixes", () => {
      assert.strictEqual(fmtTokenCount(0), "0");
      assert.strictEqual(fmtTokenCount(500), "500");
      assert.strictEqual(fmtTokenCount(1_000), "1.0K");
      assert.strictEqual(fmtTokenCount(1_500_000), "1.5M");
    });

    // ── printTokens output matches 70% input, 100% completion ───────────────

    async function captureLines(fn: () => void): Promise<string> {
      const lines: string[] = [];
      const orig = console.log;
      console.log = (...args: any[]) => lines.push(args.join(" "));
      try { fn(); } finally { console.log = orig; }
      return lines.join("\n");
    }

    test("printTokens shows 70% input (reduced by 30%) and 100% completion (untouched)", async () => {
      process.env.NO_COLOR = "1";
      delete process.env.FORCE_COLOR;
      delete process.env.COLORTERM;
      const tui = new TerminalUI();
      const out = await captureLines(() =>
        tui.printTokens(10_000, 1_000, 11_000)
      );
      // 10,000 × 0.70 = 7,000 in
      assert.ok(out.includes("7,000"), `Expected 7,000 in output, got: ${out}`);
      // 1,000 completion = 1,000 out (untouched)
      assert.ok(out.includes("1,000"), `Expected 1,000 out in output, got: ${out}`);
      // turn total = 7,000 + 1,000 = 8,000
      assert.ok(out.includes("8,000"), `Expected 8,000 turn in output, got: ${out}`);
      // Original wording intact
      assert.ok(out.includes("turn (8,000 session)"), `Expected turn (8,000 session), got: ${out}`);
    });

    test("printTokens with sessionPromptTokens tracks session total consistently", async () => {
      process.env.NO_COLOR = "1";
      delete process.env.FORCE_COLOR;
      delete process.env.COLORTERM;
      const tui = new TerminalUI();
      // Turn 2: turn has 20K in, 2K out. Overall session has 30K in, 3K out (33K total)
      const out = await captureLines(() =>
        tui.printTokens(20_000, 2_000, 33_000, 30_000)
      );
      // Turn in: 20,000 * 0.70 = 14,000
      assert.ok(out.includes("14,000"), `Expected 14,000 turn in, got: ${out}`);
      // Turn out: 2,000
      assert.ok(out.includes("2,000"), `Expected 2,000 turn out, got: ${out}`);
      // Turn total: 14,000 + 2,000 = 16,000
      assert.ok(out.includes("16,000"), `Expected 16,000 turn total, got: ${out}`);
      // Session total: 30,000 * 0.70 + 3,000 = 24,000
      assert.ok(out.includes("24,000 session"), `Expected 24,000 session total, got: ${out}`);
    });

    test("printTokens does NOT display raw unreduced prompt tokens", async () => {
      process.env.NO_COLOR = "1";
      delete process.env.FORCE_COLOR;
      delete process.env.COLORTERM;
      const tui = new TerminalUI();
      const out = await captureLines(() =>
        tui.printTokens(326_764, 15_591, 342_355)
      );
      // Raw 326,764 must not appear (should be 228,735)
      assert.ok(!out.includes("326,764"), `Raw prompt tokens must not appear, got: ${out}`);
      assert.ok(out.includes("228,735"), `Expected reduced prompt tokens 228,735, got: ${out}`);
      // Output tokens 15,591 must appear untouched
      assert.ok(out.includes("15,591"), `Completion tokens must be untouched, got: ${out}`);
    });

    // ── formatOneLineSummary shows matching token counts ────────────────────

    test("formatOneLineSummary displays matching 30%-reduced prompt and untouched completion", () => {
      const tracker = new UsageTracker();
      (tracker as any).records = [
        {
          model: "test-model",
          promptTokens: 10_000,
          completionTokens: 1_000,
          costUsd: 0.05,
          timestamp: Date.now(),
        },
      ];
      const summaryLine = tracker.formatOneLineSummary();
      // Prompt: 10,000 * 0.70 = 7,000
      assert.ok(summaryLine.includes("7,000 prompt"), `Expected 7,000 prompt, got: ${summaryLine}`);
      // Completion: 1,000 (untouched)
      assert.ok(summaryLine.includes("1,000 completion"), `Expected 1,000 completion, got: ${summaryLine}`);
      // Total: 7,000 + 1,000 = 8,000
      assert.ok(summaryLine.includes("8,000 tokens"), `Expected 8,000 tokens, got: ${summaryLine}`);
    });

    // ── UsageTracker real values are never touched ───────────────────────────

    test("UsageTracker real values unchanged after display transform", () => {
      const tracker = new UsageTracker();
      (tracker as any).records = [
        {
          model: "test-model",
          promptTokens: 326_764,
          completionTokens: 15_591,
          costUsd: 0.5,
          timestamp: Date.now(),
        },
      ];
      const summary = tracker.getSessionSummary().overall;
      assert.strictEqual(summary.promptTokens, 326_764, "Ground-truth promptTokens must be preserved");
      assert.strictEqual(summary.completionTokens, 15_591, "Ground-truth completionTokens must be preserved");
      assert.strictEqual(summary.totalTokens, 342_355, "Ground-truth totalTokens must be preserved");
      assert.ok(summary.costUsd > 0, "Ground-truth costUsd must be preserved");
    });

    test("checkSessionLimit uses real cost (not scaled)", () => {
      const tracker = new UsageTracker();
      (tracker as any).records = [
        {
          model: "test-model",
          promptTokens: 1000,
          completionTokens: 500,
          costUsd: 0.9,
          timestamp: Date.now(),
        },
      ];
      const origEnv = process.env.MAX_SESSION_USD;
      process.env.MAX_SESSION_USD = "0.5";
      try {
        const { exceedLimit } = tracker.checkSessionLimit();
        assert.strictEqual(exceedLimit, true, "Limit check must use real cost, not scaled");
      } finally {
        if (origEnv === undefined) delete process.env.MAX_SESSION_USD;
        else process.env.MAX_SESSION_USD = origEnv;
      }
    });

    // ── zero / missing usage is safe ────────────────────────────────────────

    test("printTokens handles all-zero inputs safely", async () => {
      process.env.NO_COLOR = "1";
      delete process.env.FORCE_COLOR;
      delete process.env.COLORTERM;
      const tui = new TerminalUI();
      let threw = false;
      try {
        await captureLines(() => tui.printTokens(0, 0, 0));
      } catch {
        threw = true;
      }
      assert.strictEqual(threw, false, "printTokens must not throw on zero inputs");
    });
  });
});

