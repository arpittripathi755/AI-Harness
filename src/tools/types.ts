import type * as vscode from "vscode";

/**
 * Minimal JSON Schema subset used to describe tool parameters. This is passed
 * verbatim to the OpenAI-compatible `tools[].function.parameters` field.
 */
export interface JSONSchema {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchemaProperty {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  default?: unknown;
}

/**
 * Runtime services a tool may use during execution. Built fresh per turn by the
 * SidebarProvider so tools never reach into VS Code globals directly — this keeps
 * them testable and keeps all workspace-scoping logic in one place.
 */
export interface ToolContext {
  /** Root of the currently open workspace, or undefined if no folder is open. */
  readonly workspaceRoot: vscode.Uri | undefined;

  /**
   * When true, terminal commands run without a confirmation prompt. Mutable so a
   * live setting change is reflected in the current session immediately.
   */
  terminalAutoRun: boolean;

  /**
   * When true, file modifications (including deletions) are applied immediately
   * without modal confirmation dialogs. Enabled by default in autonomous mode.
   */
  autoEdit?: boolean;

  /**
   * In-memory staging overlay managing virtual changes.
   */
  changeManager?: import("./changes").ChangeManager;

  /**
   * Safely resolve a model-supplied path to an absolute Uri inside the workspace.
   * Paths that escape the workspace root trigger a modal approval; denial throws.
   */
  resolvePath(input: string): Promise<vscode.Uri>;

  /** Path relative to the workspace root, for display in results/cards. */
  toRelative(uri: vscode.Uri): string;

  /** Modal confirmation for destructive or out-of-scope actions. */
  confirm(message: string, detail?: string): Promise<boolean>;
}

/**
 * The outcome of a tool call. `content` is fed back to the model as the tool
 * message; `summary` is a short human label rendered in the UI tool card.
 */
export interface ToolResult {
  content: string;
  isError?: boolean;
  summary?: string;
}

/** The common interface every capability implements. */
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JSONSchema;
  /**
   * True if the tool changes files or system state (create/edit/rename/delete/
   * multi-edit/run-command). Used to exclude mutating tools in Plan mode.
   */
  readonly mutates?: boolean;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** Error a tool throws to abort with a message the model will see. */
export class ToolError extends Error {}

/** Thrown by ToolContext when the user denies a required confirmation. */
export class ToolDeniedError extends ToolError {
  constructor(message = "The user denied this action.") {
    super(message);
    this.name = "ToolDeniedError";
  }
}
