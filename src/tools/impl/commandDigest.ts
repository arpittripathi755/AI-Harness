/**
 * Phase 3: Command output digest for run_command results.
 *
 * Pure helper module — imports only from Node.js standard library.
 * No imports from other harness modules; this entire file counts as part of runCommand.ts
 * for the phase module-count limit.
 *
 * Detects well-known test/build/lint output formats and produces compact actionable
 * digests while always persisting full raw output to a scratch file so the model
 * can retrieve complete details when needed.
 *
 * Falls back to the existing truncateHeadTail behavior for unrecognized formats.
 * Never makes output less informative than the current behavior.
 */

import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Total combined chars (stdout + stderr) at or below which output is considered
 * "short and useful" — left essentially unchanged.
 */
const SHORT_OUTPUT_CHARS = 2_000;

/**
 * Maximum scratch files to keep in .daxiom/scratch/ before pruning oldest.
 */
const MAX_SCRATCH_FILES = 50;

/**
 * Maximum number of diagnostic lines (tsc errors, pytest failures, etc.) to
 * include in a digest before truncating.
 */
const MAX_DIAGNOSTIC_LINES = 25;

/**
 * Maximum number of Jest/pytest failure blocks in the digest.
 */
const MAX_FAILURE_BLOCKS = 5;

/**
 * Maximum lines per failure block in the digest.
 */
const MAX_BLOCK_LINES = 25;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DigestInput {
  /** The shell command that was run. */
  command: string;
  /** Complete stdout from the process. */
  stdout: string;
  /** Complete stderr from the process. */
  stderr: string;
  /** Exit code, or null if the process was killed. */
  exitCode: number | null;
  /** Whether the command timed out. */
  timedOut: boolean;
  /** Whether the command was cancelled via AbortSignal. */
  cancelled: boolean;
  /** Absolute path to the workspace root (used to write scratch files). */
  workspaceRoot: string;
  /**
   * Character limit for the existing truncateHeadTail fallback.
   * Mirrors MAX_OUTPUT_CHARS from runCommand.ts (default 6000).
   */
  maxChars?: number;
}

export interface DigestResult {
  /** Compact digest suitable for injection as the tool-result body. */
  digest: string;
  /**
   * Workspace-relative path to the scratch file, e.g.
   * `.daxiom/scratch/cmd-1234567890-abcdef12.log`.
   * Undefined if the write failed (fail-open).
   */
  scratchRelPath: string | undefined;
  /** Bytes written to the scratch file. */
  rawBytes: number;
  /** Original total chars (stdout.length + stderr.length). */
  originalChars: number;
  /** Characters in the resulting digest. */
  digestChars: number;
  /** Format that was detected. */
  detectedFormat: CommandFormat;
}

export type CommandFormat =
  | "jest"
  | "vitest"
  | "tsc"
  | "eslint"
  | "pytest"
  | "short"
  | "unknown";

// ---------------------------------------------------------------------------
// Internal: head/tail truncation (mirrors contextBudget.truncateHeadTail)
// Duplicated here to keep this module pure (no harness imports).
// ---------------------------------------------------------------------------

function truncateHeadTail(
  text: string,
  maxChars: number,
  headChars = 2_000,
  tailChars = 3_500,
): string {
  if (text.length <= maxChars) {
    return text;
  }
  let headLen = headChars;
  let tailLen = tailChars;
  if (headLen + tailLen >= maxChars) {
    const ratio = headLen / (headLen + tailLen);
    headLen = Math.floor(maxChars * ratio * 0.9);
    tailLen = Math.floor(maxChars * (1 - ratio) * 0.9);
  }
  const head = text.slice(0, headLen);
  const tail = text.slice(text.length - tailLen);
  const middle = text.slice(headLen, text.length - tailLen);
  const omittedLineCount = (middle.match(/\n/g) || []).length;
  return `${head}\n… [${omittedLineCount} lines omitted] …\n${tail}`;
}

// ---------------------------------------------------------------------------
// Internal: scratch file management
// ---------------------------------------------------------------------------

/**
 * Write full raw output to a scratch file.
 * Returns the workspace-relative path on success, or undefined on failure.
 * Fails open — never throws.
 */
export function writeScratch(
  workspaceRoot: string,
  command: string,
  stdout: string,
  stderr: string,
): string | undefined {
  try {
    const scratchDir = path.join(workspaceRoot, ".daxiom", "scratch");
    fs.mkdirSync(scratchDir, { recursive: true });

    pruneScratchFiles(scratchDir);

    const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const fileName = `cmd-${id}.log`;
    const absPath = path.join(scratchDir, fileName);

    // Ensure the scratch path stays inside the workspace (safety check)
    const relToRoot = path.relative(workspaceRoot, absPath);
    if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
      return undefined;
    }

    const parts: string[] = [`$ ${command}`, ""];
    if (stdout.trim()) {
      parts.push("stdout:", stdout);
    }
    if (stderr.trim()) {
      parts.push("stderr:", stderr);
    }

    fs.writeFileSync(absPath, parts.join("\n"), "utf-8");
    return path.join(".daxiom", "scratch", fileName);
  } catch {
    return undefined; // Fail open
  }
}

/**
 * Prune scratch files when there are too many, removing the oldest.
 * Only removes files matching the `cmd-*.log` pattern — safe by construction.
 * Fails open — never throws.
 */
function pruneScratchFiles(scratchDir: string): void {
  try {
    const entries = fs
      .readdirSync(scratchDir)
      .filter((f) => f.startsWith("cmd-") && f.endsWith(".log"))
      .map((f) => {
        try {
          return { name: f, mtime: fs.statSync(path.join(scratchDir, f)).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((e): e is { name: string; mtime: number } => e !== null)
      .sort((a, b) => a.mtime - b.mtime);

    while (entries.length >= MAX_SCRATCH_FILES) {
      const oldest = entries.shift();
      if (oldest) {
        try {
          fs.unlinkSync(path.join(scratchDir, oldest.name));
        } catch {
          // Ignore per-file unlink errors
        }
      }
    }
  } catch {
    // Ignore directory-level errors — fail open
  }
}

// ---------------------------------------------------------------------------
// Internal: format detection
// ---------------------------------------------------------------------------

function detectFormat(
  command: string,
  stdout: string,
  stderr: string,
): CommandFormat {
  const originalLen = stdout.length + stderr.length;

  // Short output — leave unchanged
  if (originalLen <= SHORT_OUTPUT_CHARS) {
    return "short";
  }

  const cmdLower = command.toLowerCase().trim();
  const combined = stdout + "\n" + stderr;

  // Vitest (check before jest — vitest output has distinct markers)
  if (
    cmdLower.includes("vitest") ||
    /\bTest Files\b/i.test(combined) ||
    // Vitest uses Unicode check/cross marks differently from jest
    (/\bDuration\b/i.test(combined) && /\bTest Files\b/i.test(combined))
  ) {
    return "vitest";
  }

  // Jest
  if (
    cmdLower.includes("jest") ||
    /\bTest Suites?:/i.test(combined) ||
    /\bTests?:\s+\d+\s+(?:failed|passed)/i.test(combined) ||
    // Jest failure bullets appear as "  ● TestName"
    /^\s{0,2}●\s/m.test(stdout)
  ) {
    return "jest";
  }

  // TypeScript compiler
  if (
    // Command is literally "tsc" or has "tsc " flags
    /\btsc\b/.test(cmdLower) ||
    /error TS\d+:/i.test(combined) ||
    /Found \d+ error/i.test(combined)
  ) {
    return "tsc";
  }

  // ESLint
  if (
    cmdLower.includes("eslint") ||
    /\d+ errors?,\s*\d+ warnings?/i.test(combined) ||
    // ESLint problem format: "  15:3  error  ..."
    /^\s+\d+:\d+\s+(error|warning)\s+/m.test(combined)
  ) {
    return "eslint";
  }

  // pytest
  if (
    cmdLower.includes("pytest") ||
    /={4,}\s+(?:FAILURES?|ERRORS?)\s+={4,}/i.test(combined) ||
    /^FAILED\s+\S+::/m.test(combined) ||
    /\d+ (?:failed|passed).*in \d+(?:\.\d+)?s/i.test(combined)
  ) {
    return "pytest";
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Internal: format-specific digestors
// ---------------------------------------------------------------------------

/** Extract Jest/Vitest digest. */
function digestJestLike(
  stdout: string,
  stderr: string,
  scratchPath: string | undefined,
  label = "Jest",
): string {
  const combined = stdout + "\n" + stderr;
  const lines = combined.split("\n");
  const sections: string[] = [];

  // Test summary lines
  const testSummaryMatch = combined.match(/\bTests?:\s+[^\n]+/i);
  const suiteSummaryMatch = combined.match(/\bTest (?:Suites?|Files?):\s+[^\n]+/i);
  if (suiteSummaryMatch) sections.push(suiteSummaryMatch[0].trim());
  if (testSummaryMatch) sections.push(testSummaryMatch[0].trim());

  // Duration
  const durationMatch = combined.match(/\bDuration\s*[:\s]+[^\n]+/i);
  if (durationMatch) sections.push(durationMatch[0].trim());

  // Collect failure blocks (lines starting with "  ● " or vitest FAIL marker)
  const failedBlocks: string[] = [];
  let inBlock = false;
  let block: string[] = [];
  let blockLineCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isNewBlock = /^\s{0,4}●\s/.test(line) || /^─{4,}/.test(line);

    if (isNewBlock && !inBlock) {
      inBlock = true;
      block = [line];
      blockLineCount = 1;
    } else if (inBlock) {
      const isEndOfBlock =
        (line.trim() === "" && blockLineCount > 3 && lines[i + 1]?.trim() === "") ||
        (/^\s{0,4}●\s/.test(line) && blockLineCount > 2);

      if (isEndOfBlock || blockLineCount >= MAX_BLOCK_LINES) {
        failedBlocks.push(block.join("\n").trimEnd());
        if (failedBlocks.length >= MAX_FAILURE_BLOCKS) {
          inBlock = false;
          break;
        }
        inBlock = false;
        block = [];
        blockLineCount = 0;
        // Start a new block if this is a new bullet
        if (/^\s{0,4}●\s/.test(line)) {
          inBlock = true;
          block = [line];
          blockLineCount = 1;
        }
      } else {
        block.push(line);
        blockLineCount++;
      }
    }
  }
  if (inBlock && block.length > 0) {
    failedBlocks.push(block.join("\n").trimEnd());
  }

  if (failedBlocks.length > 0) {
    sections.push("\nFailing tests:\n" + failedBlocks.join("\n\n"));
  }

  // FAIL/PASS file list
  const failFiles = lines
    .filter((l) => /^\s*FAIL\s/.test(l))
    .map((l) => l.trim())
    .slice(0, 10);
  if (failFiles.length > 0) {
    sections.push("Failed suites:\n" + failFiles.join("\n"));
  }

  if (sections.length === 0) {
    // No structure found — use tail lines for context
    const tail = lines.slice(-20).join("\n").trim();
    if (tail) sections.push(tail);
  }

  if (scratchPath) {
    sections.push(`\nFull output: ${scratchPath}`);
  }

  return sections.filter(Boolean).join("\n");
}

/** Extract TypeScript compiler digest. */
function digestTsc(
  stdout: string,
  stderr: string,
  scratchPath: string | undefined,
): string {
  const combined = (stdout + "\n" + stderr).trim();
  const sections: string[] = [];

  // Success case
  if (/Found 0 errors/.test(combined)) {
    sections.push("TypeScript: 0 errors (compilation successful)");
    if (scratchPath) sections.push(`Full output: ${scratchPath}`);
    return sections.join("\n");
  }

  // Error count
  const errCountMatch = combined.match(/Found (\d+) errors?/i);
  if (errCountMatch) {
    sections.push(`TypeScript: ${errCountMatch[0]}`);
  }

  // Diagnostic lines: file.ts(line,col): error TSxxxx: message
  const diagnosticRe =
    /^(.+\.(?:ts|tsx|js|jsx))\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;
  const diagnostics: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = diagnosticRe.exec(combined)) !== null) {
    diagnostics.push(
      `${match[1]}(${match[2]},${match[3]}): ${match[4]} ${match[5]}: ${match[6]}`,
    );
    if (diagnostics.length >= MAX_DIAGNOSTIC_LINES) {
      diagnostics.push(
        `… (${MAX_DIAGNOSTIC_LINES}+ diagnostics; see full output for complete list)`,
      );
      break;
    }
  }

  if (diagnostics.length > 0) {
    sections.push("\nDiagnostics:\n" + diagnostics.join("\n"));
  } else if (!errCountMatch) {
    // Unrecognized tsc output — include last 30 lines
    const lines = combined.split("\n");
    sections.push(lines.slice(-30).join("\n"));
  }

  if (scratchPath) {
    sections.push(`\nFull output: ${scratchPath}`);
  }

  return sections.filter(Boolean).join("\n");
}

/** Extract ESLint digest. */
function digestEslint(
  stdout: string,
  stderr: string,
  scratchPath: string | undefined,
): string {
  const combined = (stdout + "\n" + stderr).trim();
  const lines = combined.split("\n");
  const sections: string[] = [];

  // Summary: "X errors, Y warnings"
  const summaryMatch = combined.match(/(\d+)\s+errors?,\s*(\d+)\s+warnings?/i);
  if (summaryMatch) {
    sections.push(`ESLint: ${summaryMatch[0]}`);
  }

  // Extract file + problem lines
  // ESLint output format:
  //   /path/to/file.ts
  //     15:3  error  'x' is not defined  no-undef
  const problemLines: string[] = [];
  let currentFile = "";

  for (const line of lines) {
    // File path line (no leading whitespace, has file extension)
    if (/^[^\s].*\.(ts|tsx|js|jsx|vue|mjs|cjs|svelte)$/i.test(line.trim())) {
      currentFile = line.trim();
      continue;
    }
    // Problem line: "  15:3  error  message  rule-name"
    const problemMatch = line.match(
      /^\s+(\d+:\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)\s*$/,
    );
    if (problemMatch) {
      const prefix = currentFile ? `${currentFile} ` : "";
      problemLines.push(
        `${prefix}${problemMatch[1]}  ${problemMatch[2]}  ${problemMatch[3]}  (${problemMatch[4]})`,
      );
      if (problemLines.length >= MAX_DIAGNOSTIC_LINES) {
        problemLines.push(`… (truncated; see full output)`);
        break;
      }
    }
  }

  if (problemLines.length > 0) {
    sections.push("\nProblems:\n" + problemLines.join("\n"));
  } else if (!summaryMatch) {
    // Unrecognized ESLint output — tail lines
    sections.push(lines.slice(-20).join("\n").trim());
  }

  if (scratchPath) {
    sections.push(`\nFull output: ${scratchPath}`);
  }

  return sections.filter(Boolean).join("\n");
}

/** Extract pytest digest. */
function digestPytest(
  stdout: string,
  stderr: string,
  scratchPath: string | undefined,
): string {
  const combined = (stdout + "\n" + stderr).trim();
  const lines = combined.split("\n");
  const sections: string[] = [];

  // Summary: "=== X failed, Y passed in Zs ==="
  const summaryMatch = combined.match(
    /={4,}\s+(.+?(?:failed|passed|error).+?)\s+={4,}/i,
  );
  if (summaryMatch) {
    sections.push(`pytest: ${summaryMatch[1].trim()}`);
  }

  // FAILED test lines
  const failedTests = lines
    .filter((l) => /^FAILED\s/.test(l.trim()))
    .map((l) => l.trim())
    .slice(0, 20);
  if (failedTests.length > 0) {
    sections.push("\nFailed tests:\n" + failedTests.join("\n"));
  }

  // Failure detail blocks (between "___ test_name ___" lines)
  const failureBlocks: string[] = [];
  let inBlock = false;
  let blockLines: string[] = [];
  let blockCount = 0;

  for (const line of lines) {
    if (/^_{4,}\s+\S.*\s+_{4,}/.test(line)) {
      if (inBlock && blockLines.length > 0) {
        failureBlocks.push(blockLines.join("\n").trimEnd());
        blockCount++;
        if (blockCount >= MAX_FAILURE_BLOCKS) {
          inBlock = false;
          break;
        }
        blockLines = [];
      }
      inBlock = true;
      blockLines = [line];
    } else if (inBlock) {
      if (/^={4,}/.test(line)) {
        // End of failures section
        failureBlocks.push(blockLines.join("\n").trimEnd());
        inBlock = false;
      } else if (blockLines.length < MAX_BLOCK_LINES) {
        blockLines.push(line);
      }
    }
  }
  if (inBlock && blockLines.length > 0) {
    failureBlocks.push(blockLines.join("\n").trimEnd());
  }

  if (failureBlocks.length > 0) {
    sections.push("\nFailure details:\n" + failureBlocks.join("\n\n"));
  } else if (!summaryMatch && failedTests.length === 0) {
    // Unrecognized pytest output
    sections.push(lines.slice(-20).join("\n").trim());
  }

  if (scratchPath) {
    sections.push(`\nFull output: ${scratchPath}`);
  }

  return sections.filter(Boolean).join("\n");
}

/**
 * Unknown format fallback: mirrors the existing truncateHeadTail behavior
 * from runCommand.ts, but additionally includes the scratch-file path.
 * This must never make output less informative than the current behavior.
 */
function digestUnknown(
  stdout: string,
  stderr: string,
  maxChars: number,
  scratchPath: string | undefined,
): string {
  const sections: string[] = [];

  if (stdout.trim()) {
    sections.push(`stdout:\n${truncateHeadTail(stdout, maxChars)}`);
  }
  if (stderr.trim()) {
    sections.push(`stderr:\n${truncateHeadTail(stderr, maxChars)}`);
  }
  if (scratchPath) {
    sections.push(`Full output: ${scratchPath}`);
  }

  return sections.join("\n\n");
}

/** Short output: return essentially unchanged, optionally adding scratch path. */
function digestShort(
  stdout: string,
  stderr: string,
  scratchPath: string | undefined,
  originalChars: number,
): string {
  const sections: string[] = [];

  if (stdout.trim()) {
    sections.push(`stdout:\n${stdout}`);
  }
  if (stderr.trim()) {
    sections.push(`stderr:\n${stderr}`);
  }
  // Only add scratch path for outputs above a tiny threshold (avoids noise for
  // one-liner commands like `echo "ok"`)
  if (scratchPath && originalChars > 200) {
    sections.push(`Full output: ${scratchPath}`);
  }

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Digest command output into a compact, actionable tool-result body.
 *
 * Always writes full raw output to a scratch file for model retrieval.
 * Falls back to existing head/tail truncation for unrecognized formats.
 * Fails open on any internal error.
 *
 * Callers must check DAXIOM_COMMAND_DIGEST themselves; this function always
 * performs digesting regardless of the flag.
 */
export function digestCommandOutput(input: DigestInput): DigestResult {
  const {
    command,
    stdout,
    stderr,
    workspaceRoot,
    maxChars = 6_000,
  } = input;

  const originalChars = stdout.length + stderr.length;
  const rawBytes = Buffer.byteLength(stdout + stderr, "utf-8");

  // Always write scratch file first (so model can retrieve full output)
  const scratchRelPath = writeScratch(workspaceRoot, command, stdout, stderr);

  const format = detectFormat(command, stdout, stderr);

  let digest: string;
  try {
    switch (format) {
      case "short":
        digest = digestShort(stdout, stderr, scratchRelPath, originalChars);
        break;
      case "jest":
        digest = digestJestLike(stdout, stderr, scratchRelPath, "Jest");
        break;
      case "vitest":
        digest = digestJestLike(stdout, stderr, scratchRelPath, "Vitest");
        break;
      case "tsc":
        digest = digestTsc(stdout, stderr, scratchRelPath);
        break;
      case "eslint":
        digest = digestEslint(stdout, stderr, scratchRelPath);
        break;
      case "pytest":
        digest = digestPytest(stdout, stderr, scratchRelPath);
        break;
      case "unknown":
      default:
        digest = digestUnknown(stdout, stderr, maxChars, scratchRelPath);
        break;
    }
  } catch {
    // Safety net: if any parser throws, fall back to unknown/head-tail behavior
    digest = digestUnknown(stdout, stderr, maxChars, scratchRelPath);
  }

  return {
    digest,
    scratchRelPath,
    rawBytes,
    originalChars,
    digestChars: digest.length,
    detectedFormat: format,
  };
}
