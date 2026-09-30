import * as vscode from "vscode";
import { ToolError } from "./types";

import * as fs from "fs";
import * as path from "path";

/** Default directory names ignored during file walking and searching. */
export const DEFAULT_IGNORE_DIRS: readonly string[] = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode",
  "target",
  "vendor",
  "Library",
  ".Trash",
  ".DS_Store",
];

/**
 * Returns the effective set of ignored directories, including any additions
 * from the SEARCH_IGNORE_DIRS environment variable (comma-separated).
 */
export function getIgnoredDirs(): Set<string> {
  const dirs = new Set<string>(DEFAULT_IGNORE_DIRS);
  dirs.add(".vscode-test");
  const extra = process.env.SEARCH_IGNORE_DIRS;
  if (extra) {
    for (const d of extra.split(",")) {
      const trimmed = d.trim();
      if (trimmed) {
        dirs.add(trimmed);
      }
    }
  }
  return dirs;
}

/** Directory names skipped during recursive listing (dynamic proxy reflecting env). */
export const SKIP_DIRS = new Proxy(new Set<string>(DEFAULT_IGNORE_DIRS), {
  get(target, prop, receiver) {
    const current = getIgnoredDirs();
    if (prop === "has") {
      return (val: string) => current.has(val);
    }
    return Reflect.get(current, prop, receiver);
  },
});

/** Glob of paths tools skip by default (noise / large dirs). */
export const DEFAULT_EXCLUDE_GLOB =
  `{${DEFAULT_IGNORE_DIRS.map((d) => `**/${d}/**`).join(",")}}`;

/** Cap on bytes read for a single file in read_file, to protect the context window. */
export const MAX_FILE_BYTES = 256 * 1024;

/** Search limits */
export function getSearchMaxFileBytes(): number {
  const val = process.env.SEARCH_MAX_FILE_BYTES;
  if (val) {
    const n = parseInt(val, 10);
    if (!Number.isNaN(n) && n > 0) {
      return n;
    }
  }
  return 1_048_576; // 1 MB
}

export function getSearchMaxResults(): number {
  const val = process.env.SEARCH_MAX_RESULTS;
  if (val) {
    const n = parseInt(val, 10);
    if (!Number.isNaN(n) && n > 0) {
      return n;
    }
  }
  return 40;
}

export function getSearchMaxFiles(): number {
  const val = process.env.SEARCH_MAX_FILES;
  if (val) {
    const n = parseInt(val, 10);
    if (!Number.isNaN(n) && n > 0) {
      return n;
    }
  }
  return 20_000;
}

export function getSearchTimeoutMs(): number {
  const val = process.env.SEARCH_TIMEOUT_MS;
  if (val) {
    const n = parseInt(val, 10);
    if (!Number.isNaN(n) && n > 0) {
      return n;
    }
  }
  return 15_000;
}

/** Common binary / media / lockfile extensions that should never be searched. */
export const SKIPPED_BINARY_EXTENSIONS = new Set([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".tiff", ".svg",
  // Audio & Video
  ".mp3", ".wav", ".ogg", ".flac", ".aac", ".mp4", ".mov", ".avi", ".mkv", ".webm",
  // Archives & Executables
  ".zip", ".tar", ".gz", ".7z", ".rar", ".dmg", ".iso", ".bin", ".exe", ".dll", ".so", ".dylib",
  // Fonts
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  // Documents
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  // Minified and sourcemaps
  ".map",
]);

export const SKIPPED_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".DS_Store",
]);

/** Check whether a file should be skipped by extension or filename. */
export function isSkippedFile(filename: string): boolean {
  const base = path.basename(filename);
  const lower = base.toLowerCase();
  if (SKIPPED_FILENAMES.has(lower) || SKIPPED_FILENAMES.has(base)) {
    return true;
  }
  if (lower.endsWith(".min.js") || lower.endsWith(".min.css") || lower.endsWith(".map")) {
    return true;
  }
  const ext = path.extname(lower);
  return SKIPPED_BINARY_EXTENSIONS.has(ext);
}

/** Sniff the first 4 KB of a file for a NUL byte. Returns true if binary. */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  let fileHandle: fs.promises.FileHandle | null = null;
  try {
    fileHandle = await fs.promises.open(filePath, "r");
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await fileHandle.read(buffer, 0, 4096, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  } catch {
    return true; // Skip files that cannot be opened/read
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
  }
}

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
