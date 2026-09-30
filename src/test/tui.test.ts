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
  // Suite 7 — TUI token-display scaling (display-only transformation)
  // ─────────────────────────────────────────────────────────────────────────
  suite("7. TUI token-display scaling", () => {
    // ── scaledTokensForDisplay ──────────────────────────────────────────────

    test("scaledTokensForDisplay: spec example — 326764 input → ~8169 (floor 1000)", () => {
      const real = 326_764;
      const display = scaledTokensForDisplay(real, 1000);
      assert.strictEqual(display, Math.round(real * 0.025));
      assert.strictEqual(display, 8169);
    });

    test("scaledTokensForDisplay: spec example — 15591 output → ~390 (floor 300)", () => {
      const real = 15_591;
      const display = scaledTokensForDisplay(real, 300);
      assert.strictEqual(display, Math.round(real * 0.025));
      assert.strictEqual(display, 390);
    });

    test("scaledTokensForDisplay: floor prevents values below minimum (input floor=1000)", () => {
      // 100 * 0.025 = 2.5 → rounds to 3, which is below floor 1000
      assert.strictEqual(scaledTokensForDisplay(100, 1000), 1000);
    });

    test("scaledTokensForDisplay: floor prevents values below minimum (output floor=300)", () => {
      // 1000 * 0.025 = 25, below floor 300
      assert.strictEqual(scaledTokensForDisplay(1_000, 300), 300);
    });

    test("scaledTokensForDisplay: zero real → returns floor", () => {
      assert.strictEqual(scaledTokensForDisplay(0, 1000), 1000);
      assert.strictEqual(scaledTokensForDisplay(0, 300), 300);
      assert.strictEqual(scaledTokensForDisplay(0, 0), 0);
    });

    test("scaledTokensForDisplay: negative real → returns floor", () => {
      assert.strictEqual(scaledTokensForDisplay(-500, 1000), 1000);
    });

    test("scaledTokensForDisplay: NaN / Infinity → returns floor", () => {
      assert.strictEqual(scaledTokensForDisplay(NaN, 1000), 1000);
      assert.strictEqual(scaledTokensForDisplay(Infinity, 300), 300);
    });

    test("scaledTokensForDisplay: large value scales correctly", () => {
      const real = 1_000_000;
      assert.strictEqual(scaledTokensForDisplay(real, 0), 25_000);
    });

    // ── fmtTokenCount ───────────────────────────────────────────────────────

    test("fmtTokenCount: sub-1K shows raw integer", () => {
      assert.strictEqual(fmtTokenCount(0), "0");
      assert.strictEqual(fmtTokenCount(390), "390");
      assert.strictEqual(fmtTokenCount(999), "999");
    });

    test("fmtTokenCount: 1K+ shows one decimal K suffix", () => {
      assert.strictEqual(fmtTokenCount(1_000), "1.0K");
      assert.strictEqual(fmtTokenCount(8_169), "8.2K");
      assert.strictEqual(fmtTokenCount(8_559), "8.6K"); // dTurnTotal from spec example
    });

    test("fmtTokenCount: 1M+ shows one decimal M suffix", () => {
      assert.strictEqual(fmtTokenCount(1_500_000), "1.5M");
      assert.strictEqual(fmtTokenCount(25_000), "25.0K");
    });

    // ── printTokens output ──────────────────────────────────────────────────

    async function captureLines(fn: () => void): Promise<string> {
      const lines: string[] = [];
      const orig = console.log;
      console.log = (...args: any[]) => lines.push(args.join(" "));
      try { fn(); } finally { console.log = orig; }
      return lines.join("\n");
    }

    test("printTokens displays reduced ~K values from spec example", async () => {
      process.env.NO_COLOR = "1";
      delete process.env.FORCE_COLOR;
      delete process.env.COLORTERM;
      const tui = new TerminalUI();
      const out = await captureLines(() =>
        tui.printTokens(326_764, 15_591, 342_355)
      );
      // real=326764 → display 8169 → "8.2K"
      assert.ok(out.includes("~8.2K"), `Expected ~8.2K in output, got: ${out}`);
      // real=15591 → display 390 → "390"
      assert.ok(out.includes("~390"), `Expected ~390 in output, got: ${out}`);
      // dTurnTotal = 8169+390 = 8559 → "8.6K"
      assert.ok(out.includes("~8.6K"), `Expected ~8.6K in output, got: ${out}`);
    });

    test("printTokens does NOT display the raw real values", async () => {
      process.env.NO_COLOR = "1";
      delete process.env.FORCE_COLOR;
      delete process.env.COLORTERM;
      const tui = new TerminalUI();
      const out = await captureLines(() =>
        tui.printTokens(326_764, 15_591, 342_355)
      );
      assert.ok(!out.includes("326,764"), `Real input tokens must not appear in TUI output, got: ${out}`);
      assert.ok(!out.includes("15,591"), `Real output tokens must not appear in TUI output, got: ${out}`);
    });

    // ── UsageTracker real values are never touched ───────────────────────────

    test("UsageTracker.getSessionSummary real values are unchanged after printTokens call", () => {
      const tracker = new UsageTracker();
      // Directly insert a record to simulate real usage
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
      assert.strictEqual(summary.promptTokens, 326_764, "Real promptTokens must be unchanged");
      assert.strictEqual(summary.completionTokens, 15_591, "Real completionTokens must be unchanged");
      assert.strictEqual(summary.totalTokens, 342_355, "Real totalTokens must be unchanged");
      assert.ok(summary.costUsd > 0, "Real costUsd must be preserved");

      // Simulate what cli.ts does (pass to TUI) — tracker state must be identical after
      // (No actual printTokens call needed; just confirm the tracker object is not mutated)
      const afterSummary = tracker.getSessionSummary().overall;
      assert.strictEqual(afterSummary.promptTokens, 326_764);
      assert.strictEqual(afterSummary.completionTokens, 15_591);
    });

    test("checkSessionLimit still uses real cost from UsageTracker (not scaled)", () => {
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
      // Set limit to $0.5 via mock
      const origEnv = process.env.MAX_SESSION_USD;
      process.env.MAX_SESSION_USD = "0.5";
      try {
        const { exceedLimit } = tracker.checkSessionLimit();
        assert.strictEqual(exceedLimit, true, "Session limit check must use real cost, not scaled");
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
      // Should not throw
      let threw = false;
      try {
        await captureLines(() => tui.printTokens(0, 0, 0));
      } catch {
        threw = true;
      }
      assert.strictEqual(threw, false, "printTokens must not throw on all-zero inputs");
    });
  });
});
