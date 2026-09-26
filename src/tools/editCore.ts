import * as vscode from "vscode";
import { decode, encode } from "./fsutil";
import { ToolError } from "./types";

/** A single find/replace operation within a file. */
export interface EditOp {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

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

/**
 * Apply a sequence of find/replace edits to a source string. Each `old_string`
 * must be unique unless `replace_all` is set. Returns the new content and the
 * number of replacements. Throws {@link ToolError} on ambiguous/missing matches.
 */
export function applyEdits(
  source: string,
  ops: EditOp[],
): { content: string; replacements: number } {
  let content = source;
  let replacements = 0;

  for (const op of ops) {
    const occurrences = countOccurrences(content, op.old_string);
    if (occurrences === 0) {
      throw new ToolError(
        `old_string not found:\n${truncate(op.old_string)}`,
      );
    }
    if (occurrences > 1 && !op.replace_all) {
      throw new ToolError(
        `old_string is not unique (${occurrences} matches); pass replace_all or ` +
          `add more surrounding context:\n${truncate(op.old_string)}`,
      );
    }
    content = op.replace_all
      ? content.split(op.old_string).join(op.new_string)
      : content.replace(op.old_string, op.new_string);
    replacements += op.replace_all ? occurrences : 1;
  }

  return { content, replacements };
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
