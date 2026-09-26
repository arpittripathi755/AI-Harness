import * as vscode from "vscode";
import * as crypto from "crypto";
import { decode, encode } from "./fsutil";
import { ToolError } from "./types";

/** A single find/replace operation within a file. */
export interface EditOp {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export type EditErrorType =
  | "OLD_STRING_NOT_FOUND"
  | "NOT_UNIQUE"
  | "INVALID_ARGUMENT"
  | "FILE_NOT_FOUND"
  | "INVALID_PATH"
  | "STALE_FILE";

export interface CandidateWindow {
  startLine: number;
  endLine: number;
  content: string;
}

export interface StructuredEditFailure {
  ok: false;
  errorType: EditErrorType;
  filePath?: string;
  totalLines?: number;
  fileSha256?: string;
  candidateWindow?: CandidateWindow | null;
  message: string;
}

export interface StructuredEditSuccess {
  ok: true;
  content: string;
  replacements: number;
}

export type ApplyEditsOutcome = StructuredEditSuccess | StructuredEditFailure;

/** Parse and validate a raw edit op from tool arguments. */
export function parseEditOp(raw: unknown): EditOp {
  if (!raw || typeof raw !== "object") {
    throw new ToolError("Each edit must be an object with old_string/new_string.");
  }
  const op = raw as Record<string, unknown>;
  if (typeof op.old_string !== "string" || typeof op.new_string !== "string") {
    throw new ToolError("Each edit requires string old_string and new_string.");
  }
  if (op.old_string === op.new_string) {
    throw new ToolError("old_string and new_string must differ.");
  }
  return {
    old_string: op.old_string,
    new_string: op.new_string,
    replace_all: op.replace_all === true,
  };
}

/** Compute SHA-256 hash of a string content. */
export function computeSha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Best-effort search to locate nearby candidate lines for diagnostic reporting
 * when exact match fails. Does NOT modify code or weaken exact matching.
 */
export function findCandidateWindow(source: string, needle: string): CandidateWindow | null {
  if (!needle.trim()) {
    return null;
  }
  const sourceLines = source.split("\n");
  const needleLines = needle
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (needleLines.length === 0 || sourceLines.length === 0) {
    return null;
  }

  let bestLine = -1;
  let maxScore = 0;

  const needleTokens = new Set(
    needle
      .toLowerCase()
      .split(/[^a-zA-Z0-9_$]+/)
      .filter((t) => t.length > 2),
  );

  for (let i = 0; i < sourceLines.length; i++) {
    const line = sourceLines[i];
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    // Check if any substantial needle line is contained within this line
    for (const nl of needleLines) {
      if (nl.length > 4 && trimmedLine.includes(nl)) {
        bestLine = i;
        maxScore = 100;
        break;
      }
    }
    if (maxScore === 100) {
      break;
    }

    // Token overlap comparison
    const lineTokens = line
      .toLowerCase()
      .split(/[^a-zA-Z0-9_$]+/)
      .filter((t) => t.length > 2);
    let matchCount = 0;
    for (const t of lineTokens) {
      if (needleTokens.has(t)) {
        matchCount++;
      }
    }
    const score = lineTokens.length > 0 ? matchCount / (lineTokens.length + needleTokens.size) : 0;
    if (score > maxScore && score > 0.2) {
      maxScore = score;
      bestLine = i;
    }
  }

  if (bestLine === -1) {
    return null;
  }

  const startLine = Math.max(1, bestLine - 2); // 1-based line numbers
  const endLine = Math.min(sourceLines.length, bestLine + 4);
  const windowSlice = sourceLines.slice(startLine - 1, endLine);
  const content = windowSlice
    .map((line, idx) => `${String(startLine + idx).padStart(4)} | ${line}`)
    .join("\n");

  return { startLine, endLine, content };
}

/**
 * Apply a sequence of find/replace edits to a source string. Each `old_string`
 * must match exactly and be unique unless `replace_all` is set.
 * Returns structured outcome: either StructuredEditSuccess or StructuredEditFailure.
 */
export function applyEdits(
  source: string,
  ops: EditOp[],
  filePath?: string,
): ApplyEditsOutcome {
  let content = source;
  let replacements = 0;
  const totalLines = source.split("\n").length;
  const fileSha256 = computeSha256(source);

  for (const op of ops) {
    const occurrences = countOccurrences(content, op.old_string);
    if (occurrences === 0) {
      const candidateWindow = findCandidateWindow(content, op.old_string);
      const hint = candidateWindow
        ? "Surrounding context of closest matching text is attached. Re-read the file before retrying."
        : "No similar text found — re-read the file before retrying.";
      return {
        ok: false,
        errorType: "OLD_STRING_NOT_FOUND",
        filePath,
        totalLines,
        fileSha256,
        candidateWindow,
        message: `old_string not found in ${filePath ?? "target"}. ${hint}\nAttempted needle:\n${truncate(op.old_string)}`,
      };
    }
    if (occurrences > 1 && !op.replace_all) {
      const candidateWindow = findCandidateWindow(content, op.old_string);
      return {
        ok: false,
        errorType: "NOT_UNIQUE",
        filePath,
        totalLines,
        fileSha256,
        candidateWindow,
        message:
          `old_string is not unique (${occurrences} matches); pass replace_all or add more surrounding context.\n` +
          truncate(op.old_string),
      };
    }
    content = op.replace_all
      ? content.split(op.old_string).join(op.new_string)
      : content.replace(op.old_string, op.new_string);
    replacements += op.replace_all ? occurrences : 1;
  }

  return { ok: true, content, replacements };
}

/** Read text for editing (throws if the file cannot be read). */
export async function readForEdit(uri: vscode.Uri): Promise<string> {
  try {
    return decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    throw new ToolError(`Cannot read file for editing: ${uri.fsPath}`);
  }
}

/** Write text back to a file. */
export async function writeText(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, encode(text));
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") {
    return 0;
  }
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function truncate(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
