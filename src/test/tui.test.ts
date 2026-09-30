import * as assert from "assert";
import {
  detectColorLevel,
  rgbFor,
  TerminalUI,
  Spinner,
  colors,
  stripAnsi,
  formatAssistantText,
} from "../cli/tui";

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

  suite("6. Formatting and highlights", () => {
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
  });
});
