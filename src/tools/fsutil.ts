import * as vscode from "vscode";
import { ToolError } from "./types";

/** Glob of paths tools skip by default (noise / large dirs). */
export const DEFAULT_EXCLUDE_GLOB =
  "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.next/**,**/build/**}";

/** Directory names skipped during recursive listing. */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".next",
  "build",
  ".vscode-test",
]);

/** Cap on bytes read for a single file, to protect the context window. */
export const MAX_FILE_BYTES = 256 * 1024;

const decoder = new TextDecoder("utf-8", { fatal: false });
const encoder = new TextEncoder();

export function decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function encode(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Read a workspace file as UTF-8 text, rejecting missing/oversized/binary files. */
export async function readText(uri: vscode.Uri): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch {
    throw new ToolError(`File not found or unreadable: ${uri.fsPath}`);
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ToolError(
      `File is too large to read (${bytes.byteLength} bytes; limit ${MAX_FILE_BYTES}).`,
    );
  }
  // Heuristic binary check: NUL byte in the first 8KB.
  const scan = Math.min(bytes.byteLength, 8192);
  for (let i = 0; i < scan; i++) {
    if (bytes[i] === 0) {
      throw new ToolError("File appears to be binary; refusing to read as text.");
    }
  }
  return decode(bytes);
}

/** Prefix each line with a right-aligned 1-based line number (cat -n style). */
export function numberLines(text: string, startLine = 1): string {
  const lines = text.split("\n");
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(width)}  ${line}`)
    .join("\n");
}

/** Read a required string argument. */
export function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolError(`Missing required string argument "${key}".`);
  }
  return value;
}

/** Read an optional number argument with a fallback. */
export function optionalNumber(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
