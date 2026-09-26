import * as fs from "fs";
import * as path from "path";

/**
 * Lightweight, zero-dependency VS Code API shim for running the Axiom agent
 * standalone in the Terminal User Interface (TUI) without launching VS Code.
 */

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export interface FileStat {
  type: FileType;
  ctime: number;
  mtime: number;
  size: number;
}

export class Uri {
  public readonly scheme: string;
  public readonly fsPath: string;
  public readonly path: string;

  private constructor(scheme: string, fsPath: string) {
    this.scheme = scheme;
    this.fsPath = path.resolve(fsPath);
    this.path = this.fsPath;
  }

  static file(filePath: string): Uri {
    return new Uri("file", filePath);
  }

  static parse(uriString: string): Uri {
    if (uriString.startsWith("file://")) {
      return new Uri("file", uriString.slice(7));
    }
    return new Uri("file", uriString);
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    return new Uri(base.scheme, path.join(base.fsPath, ...pathSegments));
  }

  toString(): string {
    return `file://${this.fsPath}`;
  }
}

export interface WorkspaceFolder {
  readonly uri: Uri;
  readonly name: string;
  readonly index: number;
}

class WorkspaceFileSystem {
  async stat(uri: Uri): Promise<FileStat> {
    const s = await fs.promises.stat(uri.fsPath);
    let type = FileType.Unknown;
    if (s.isFile()) {
      type = FileType.File;
    } else if (s.isDirectory()) {
      type = FileType.Directory;
    } else if (s.isSymbolicLink()) {
      type = FileType.SymbolicLink;
    }
    return {
      type,
      ctime: s.birthtimeMs,
      mtime: s.mtimeMs,
      size: s.size,
    };
  }

  async readFile(uri: Uri): Promise<Uint8Array> {
    return await fs.promises.readFile(uri.fsPath);
  }

  async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    await fs.promises.mkdir(path.dirname(uri.fsPath), { recursive: true });
    await fs.promises.writeFile(uri.fsPath, content);
  }

  async delete(
    uri: Uri,
    options?: { recursive?: boolean; useTrash?: boolean },
  ): Promise<void> {
    await fs.promises.rm(uri.fsPath, {
      recursive: options?.recursive ?? true,
      force: true,
    });
  }

  async rename(
    source: Uri,
    target: Uri,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    if (!options?.overwrite) {
      try {
        await fs.promises.access(target.fsPath);
        throw new Error(`Target already exists: ${target.fsPath}`);
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }
    }
    await fs.promises.mkdir(path.dirname(target.fsPath), { recursive: true });
    await fs.promises.rename(source.fsPath, target.fsPath);
  }

  async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    const entries = await fs.promises.readdir(uri.fsPath, {
      withFileTypes: true,
    });
    return entries.map((entry) => {
      let type = FileType.Unknown;
      if (entry.isFile()) {
        type = FileType.File;
      } else if (entry.isDirectory()) {
        type = FileType.Directory;
      } else if (entry.isSymbolicLink()) {
        type = FileType.SymbolicLink;
      }
      return [entry.name, type];
    });
  }

  async createDirectory(uri: Uri): Promise<void> {
    await fs.promises.mkdir(uri.fsPath, { recursive: true });
  }
}

function globToRegex(glob: string): RegExp {
  let pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".");
  return new RegExp(`^${pattern}$`);
}

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".next",
  "build",
  ".vscode-test",
]);

export class StandaloneWorkspace {
  public readonly fs = new WorkspaceFileSystem();
  public workspaceFolders: WorkspaceFolder[] = [
    {
      uri: Uri.file(process.cwd()),
      name: path.basename(process.cwd()),
      index: 0,
    },
  ];

  onDidChangeWorkspaceFolders(_listener: (e: any) => any) {
    return { dispose: () => {} };
  }

  async findFiles(
    include?: string | { pattern: string },
    _exclude?: string | { pattern: string },
    maxResults = 2000,
  ): Promise<Uri[]> {
    const root = this.workspaceFolders[0]?.uri.fsPath || process.cwd();
    const results: Uri[] = [];

    const includeStr =
      typeof include === "string"
        ? include
        : include?.pattern || "**/*";
    const regex = includeStr === "**/*" ? null : globToRegex(includeStr);

    const walk = async (currentDir: string) => {
      if (results.length >= maxResults) {
        return;
      }
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= maxResults) {
          break;
        }
        if (DEFAULT_IGNORED_DIRS.has(entry.name)) {
          continue;
        }

        const fullPath = path.join(currentDir, entry.name);
        const rel = path.relative(root, fullPath).split(path.sep).join("/");

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (!regex || regex.test(rel) || regex.test(entry.name)) {
            results.push(Uri.file(fullPath));
          }
        }
      }
    };

    await walk(root);
    return results;
  }
}

export const workspace = new StandaloneWorkspace();

export const window = {
  activeTextEditor: undefined as any,
  showInformationMessage: async (msg: string, ..._rest: any[]) => msg,
  showWarningMessage: async (msg: string, ..._rest: any[]) => "Allow",
  showErrorMessage: async (msg: string, ..._rest: any[]) => msg,
  showInputBox: async () => undefined,
  registerWebviewViewProvider: () => ({ dispose: () => {} }),
};

export const commands = {
  registerCommand: (_command: string, _callback: (...args: any[]) => any) => ({
    dispose: () => {},
  }),
  executeCommand: async (_command: string, ..._rest: any[]) => {},
};

export interface Memento {
  keys(): readonly string[];
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: any): Thenable<void>;
}

export class InMemoryMemento implements Memento {
  private map = new Map<string, any>();

  keys(): readonly string[] {
    return Array.from(this.map.keys());
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.map.has(key) ? this.map.get(key) : defaultValue;
  }

  async update(key: string, value: any): Promise<void> {
    if (value === undefined) {
      this.map.delete(key);
    } else {
      this.map.set(key, value);
    }
  }
}
