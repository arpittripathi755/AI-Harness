import * as vscode from "vscode";
import type { Tool, ToolContext, ToolResult } from "../types";
import {
  DEFAULT_EXCLUDE_GLOB,
  SKIP_DIRS,
  decode,
  optionalNumber,
  requireString,
} from "../fsutil";
import { ToolError } from "../types";

const MAX_FILES_SCANNED = 2000;
const MAX_MATCHES = 200;

function isExcluded(relPath: string): boolean {
  const parts = relPath.replace(/\\/g, "/").split("/");
  return parts.some((part) => SKIP_DIRS.has(part));
}

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

export const searchWorkspaceTool: Tool = {
  name: "search_workspace",
  description:
    "Search file contents across the workspace for a string or regular expression. " +
    "Returns matching file paths with line numbers and the matching line. Use this " +
    "to locate where something is defined or used before reading full files.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text or regular expression to search for.",
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
    },
    required: ["query"],
  },

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const query = requireString(args, "query");
    const isRegex = args.is_regex === true;
    const caseSensitive = args.case_sensitive === true;
    const include =
      typeof args.glob === "string" && args.glob ? args.glob : "**/*";
    const maxMatches = Math.min(
      optionalNumber(args, "max_results", MAX_MATCHES),
      MAX_MATCHES,
    );

    let regex: RegExp;
    try {
      const pattern = isRegex ? query : escapeRegExp(query);
      regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
    } catch (err) {
      throw new ToolError(
        `Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const files = await vscode.workspace.findFiles(
      include,
      DEFAULT_EXCLUDE_GLOB,
      MAX_FILES_SCANNED,
    );

    let scanList: { rel: string; uri: vscode.Uri }[] = [];
    if (ctx.changeManager) {
      const physicalRels = files.map((u) => ctx.toRelative(u));
      const effectiveRels = ctx.changeManager.getEffectivePaths(physicalRels);
      scanList = effectiveRels
        .filter((rel) => !isExcluded(rel) && matchesGlob(rel, include))
        .map((rel) => ({
          rel,
          uri: ctx.workspaceRoot ? vscode.Uri.joinPath(ctx.workspaceRoot, rel) : vscode.Uri.file(rel),
        }));
    } else {
      scanList = files.map((uri) => ({
        rel: ctx.toRelative(uri),
        uri,
      }));
    }

    const results: string[] = [];
    let matchCount = 0;
    let filesWithMatches = 0;

    for (const item of scanList) {
      if (matchCount >= maxMatches) {
        break;
      }
      const rel = item.rel;
      const uri = item.uri;
      let text: string;
      try {
        if (ctx.changeManager) {
          text = await ctx.changeManager.readEffective(rel);
        } else {
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (bytes.byteLength > 1024 * 1024 || bytes.includes(0)) {
            continue; // skip huge or binary files
          }
          text = decode(bytes);
        }
      } catch {
        continue;
      }
      let fileHadMatch = false;

      const lines = text.split("\n");
      for (let i = 0; i < lines.length && matchCount < maxMatches; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          matchCount++;
          fileHadMatch = true;
        }
      }
      if (fileHadMatch) {
        filesWithMatches++;
      }
    }

    if (matchCount === 0) {
      return { content: `No matches for "${query}".`, summary: "No matches" };
    }
    const capped = matchCount >= maxMatches ? `\n… capped at ${maxMatches} matches.` : "";
    return {
      content: results.join("\n") + capped,
      summary: `${matchCount} match${matchCount === 1 ? "" : "es"} in ${filesWithMatches} file${filesWithMatches === 1 ? "" : "s"}`,
    };
  },
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
