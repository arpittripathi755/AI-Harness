import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import type { Tool, ToolContext, ToolResult } from "../types";
import {
  getIgnoredDirs,
  getSearchMaxFileBytes,
  getSearchMaxFiles,
  getSearchMaxResults,
  getSearchTimeoutMs,
  isBinaryFile,
  isSkippedFile,
  optionalNumber,
  requireString,
} from "../fsutil";
import { ToolError } from "../types";
import { checkBroadWorkspaceWarning } from "../workspaceSafety";

const MAX_MATCHES_PER_FILE = 10;
const CONCURRENCY_LIMIT = 8;
const MAX_DEPTH = 8;

function matchesGlob(filePath: string, glob: string): boolean {
  if (!glob || glob === "**/*" || glob === "**") {
    return true;
  }
  const normPath = filePath.replace(/\\/g, "/");
  let p = glob.replace(/\\/g, "/");
  let regexStr = "^";
  if (p.startsWith("**/")) {
    regexStr += "(?:.*/)?";
    p = p.slice(3);
  }
  regexStr += p
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/(?<!\.)\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  regexStr += "$";
  return new RegExp(regexStr).test(normPath);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const searchWorkspaceTool: Tool = {
  name: "search_workspace",
  description:
    "Search file contents across the workspace for a string or regular expression. " +
    "Returns matching file paths with line numbers and the matching line. " +
    "Prefer providing a narrow 'path' subdirectory and specific queries to avoid scanning large workspaces.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text or regular expression to search for.",
      },
      path: {
        type: "string",
        description:
          "Optional subdirectory to narrow the search, relative to the workspace root. Highly recommended for large projects.",
      },
      is_regex: {
        type: "boolean",
        description: "Treat the query as a regular expression. Default false.",
      },
      case_sensitive: {
        type: "boolean",
        description: "Case-sensitive match. Default false.",
      },
      glob: {
        type: "string",
        description:
          "Optional include glob, e.g. '**/*.ts'. Defaults to all files.",
      },
      max_results: {
        type: "integer",
        description: "Maximum number of matches to return (up to 200). Default 200.",
      },
    },
    required: ["query"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const query = requireString(args, "query");
    const isRegex = args.is_regex === true;
    const caseSensitive = args.case_sensitive === true;
    const include =
      typeof args.glob === "string" && args.glob ? args.glob : "**/*";

    const defaultMaxResults = getSearchMaxResults();
    const maxMatches = Math.min(
      optionalNumber(args, "max_results", defaultMaxResults),
      defaultMaxResults,
    );

    // One-time safety warning for broad workspaces (e.g. ~/Desktop, homedir)
    checkBroadWorkspaceWarning(ctx.workspaceRoot?.fsPath);

    let regex: RegExp;
    try {
      const pattern = isRegex ? query : escapeRegExp(query);
      regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
    } catch (err) {
      throw new ToolError(
        `Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const rootFs = ctx.workspaceRoot ? ctx.workspaceRoot.fsPath : process.cwd();
    let searchStartFs = rootFs;

    const subPath = typeof args.path === "string" ? args.path.trim() : "";
    if (subPath) {
      const resolved = await ctx.resolvePath(subPath);
      searchStartFs = resolved.fsPath;
    }

    const ignoredDirs = getIgnoredDirs();
    const maxFileBytes = getSearchMaxFileBytes();
    const maxFiles = getSearchMaxFiles();
    const timeoutMs = getSearchTimeoutMs();
    const deadline = Date.now() + timeoutMs;

    // TODO: Respect .gitignore at the workspace root when a lightweight parser is available.

    let scannedFiles = 0;
    let hitMaxFiles = false;
    let timedOut = false;

    const candidateFiles: { fullPath: string; rel: string }[] = [];

    // Traverse starting at searchStartFs
    const queue: { dir: string; depth: number }[] = [{ dir: searchStartFs, depth: 1 }];

    while (queue.length > 0) {
      if (ctx.signal?.aborted || Date.now() >= deadline) {
        timedOut = true;
        break;
      }
      const current = queue.shift()!;
      if (current.depth > MAX_DEPTH) {
        continue;
      }

      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (ctx.signal?.aborted || Date.now() >= deadline) {
          timedOut = true;
          break;
        }

        if (entry.isDirectory()) {
          if (!ignoredDirs.has(entry.name)) {
            queue.push({
              dir: path.join(current.dir, entry.name),
              depth: current.depth + 1,
            });
          }
        } else if (entry.isFile()) {
          scannedFiles++;
          if (scannedFiles >= maxFiles) {
            hitMaxFiles = true;
            break;
          }

          if (isSkippedFile(entry.name)) {
            continue;
          }

          const fullPath = path.join(current.dir, entry.name);
          const rel = path.relative(rootFs, fullPath).split(path.sep).join("/");

          if (!matchesGlob(rel, include)) {
            continue;
          }

          // Skip if staged deleted in ChangeManager
          if (ctx.changeManager?.getDeletedPaths().includes(rel)) {
            continue;
          }

          try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.size > maxFileBytes || stat.size === 0) {
              continue;
            }
          } catch {
            continue;
          }

          candidateFiles.push({ fullPath, rel });
        }
      }

      if (hitMaxFiles || timedOut) {
        break;
      }
    }

    // Merge staged creations and edits from ChangeManager
    const stagedFilesToSearch: { rel: string; content: string }[] = [];
    if (ctx.changeManager) {
      const stagedRels = ctx.changeManager.getEffectivePaths();
      for (const rel of stagedRels) {
        if (!matchesGlob(rel, include)) {
          continue;
        }
        const parts = rel.split("/");
        if (parts.some((p) => ignoredDirs.has(p))) {
          continue;
        }
        const full = path.join(rootFs, rel);
        if (!full.startsWith(searchStartFs)) {
          continue;
        }

        // If it's already in candidates, check if modified in memory
        try {
          const content = await ctx.changeManager.readEffective(rel);
          stagedFilesToSearch.push({ rel, content });
        } catch {}
      }
    }

    const results: string[] = [];
    let matchCount = 0;
    let filesWithMatches = 0;
    let truncatedExcess = 0;

    // Helper to check abort / timeout
    const isStopRequested = () =>
      (ctx.signal?.aborted ?? false) || Date.now() >= deadline || matchCount >= maxMatches;

    // First search any virtual staged files from ChangeManager
    for (const staged of stagedFilesToSearch) {
      if (isStopRequested()) {
        break;
      }
      let fileMatches = 0;
      let fileHadMatch = false;

      // Iterate lines without full unbounded array allocation
      let lineNum = 1;
      let startIdx = 0;
      while (startIdx < staged.content.length) {
        let endIdx = staged.content.indexOf("\n", startIdx);
        if (endIdx === -1) {
          endIdx = staged.content.length;
        }
        const line = staged.content.slice(startIdx, endIdx);
        startIdx = endIdx + 1;

        regex.lastIndex = 0;
        if (regex.test(line)) {
          if (fileMatches < MAX_MATCHES_PER_FILE && matchCount < maxMatches) {
            results.push(`${staged.rel}:${lineNum}: ${line.trim().slice(0, 300)}`);
            matchCount++;
            fileMatches++;
            fileHadMatch = true;
          } else {
            truncatedExcess++;
          }
        }
        lineNum++;
      }
      if (fileHadMatch) {
        filesWithMatches++;
      }
    }

    // Exclude staged files from candidateFiles so we don't double-search them
    const stagedRelSet = new Set(stagedFilesToSearch.map((s) => s.rel));
    const physicalCandidates = candidateFiles.filter((f) => !stagedRelSet.has(f.rel));

    // Concurrency pool (limit 8) for physical files
    let nextIndex = 0;
    const workerCount = Math.min(CONCURRENCY_LIMIT, physicalCandidates.length);

    async function searchWorker(): Promise<void> {
      while (nextIndex < physicalCandidates.length && !isStopRequested()) {
        const item = physicalCandidates[nextIndex++];
        if (!item) {
          break;
        }

        // Sniff binary check (first 4KB for NUL byte)
        if (await isBinaryFile(item.fullPath)) {
          continue;
        }

        let fileMatches = 0;
        let fileHadMatch = false;
        let lineNum = 0;

        const stream = fs.createReadStream(item.fullPath, { encoding: "utf-8" });
        const rl = readline.createInterface({
          input: stream,
          crlfDelay: Infinity,
        });

        try {
          for await (const line of rl) {
            if (isStopRequested()) {
              break;
            }
            lineNum++;
            regex.lastIndex = 0;
            if (regex.test(line)) {
              if (fileMatches < MAX_MATCHES_PER_FILE && matchCount < maxMatches) {
                results.push(`${item.rel}:${lineNum}: ${line.trim().slice(0, 300)}`);
                matchCount++;
                fileMatches++;
                fileHadMatch = true;
              } else {
                truncatedExcess++;
                // If this file hit per-file cap and global is not reached, stop reading file early
                if (fileMatches >= MAX_MATCHES_PER_FILE) {
                  break;
                }
              }
            }
          }
        } catch {
          // Ignore read errors on inaccessible files
        } finally {
          rl.close();
          stream.destroy();
        }

        if (fileHadMatch) {
          filesWithMatches++;
        }
      }
    }

    if (physicalCandidates.length > 0) {
      await Promise.all(Array.from({ length: workerCount }, () => searchWorker()));
    }

    if (matchCount === 0 && !hitMaxFiles && !timedOut) {
      return { content: `No matches for "${query}".`, summary: "No matches" };
    }

    const notes: string[] = [];
    if (hitMaxFiles) {
      notes.push(
        `[search stopped: workspace too large, scanned ${scannedFiles} files; use a narrower path]`,
      );
    }
    if (timedOut || Date.now() >= deadline) {
      const timeoutSec = Math.round(timeoutMs / 1000);
      notes.push(
        `[search timed out after ${timeoutSec}s; partial results returned. Narrow your path or query]`,
      );
    }
    if (truncatedExcess > 0 || matchCount >= maxMatches) {
      notes.push(
        `[results truncated: ${Math.max(1, truncatedExcess)} more matches not shown; narrow your query or path]`,
      );
    }

    const notesStr = notes.length > 0 ? `\n${notes.join("\n")}` : "";
    return {
      content: (results.length > 0 ? results.join("\n") : `No matches for "${query}".`) + notesStr,
      summary: `${matchCount} match${matchCount === 1 ? "" : "es"} in ${filesWithMatches} file${filesWithMatches === 1 ? "" : "s"}`,
    };
  },
};
