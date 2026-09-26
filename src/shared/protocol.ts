/**
 * Typed message protocol shared between the extension host and the React webview.
 *
 * This file is imported by BOTH webpack bundles (node extension + web webview),
 * so it must stay dependency-free and contain only types/plain data.
 */

/** A chat message as rendered in the webview UI. */
export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Data-URL images attached to a user message (rendered as thumbnails). */
  images?: string[];
}

/** A tool invocation as rendered in the webview timeline. */
export interface UiToolCall {
  kind: "tool";
  callId: string;
  name: string;
  title: string;
  status: "running" | "ok" | "error";
  summary?: string;
}

/** Ordered timeline item: a message or a tool card. */
export type UiTimelineItem =
  | (UiMessage & { kind: "message" })
  | UiToolCall;

/** Human-readable live status of the agent. */
export type AgentStatus =
  | "Idle"
  | "Working…"
  | "Thinking…"
  | "Searching workspace…"
  | "Reading files…"
  | "Editing files…"
  | "Deleting file…"
  | "Running terminal command…"
  | "Waiting for approval…"
  | "Fetching GitHub issue…"
  | "Cloning repository…"
  | "Generating response…"
  | "Rate limited — retrying…"
  | "Finished";

/** Snapshot of persisted settings sent to the webview on init / after changes. */
export interface UiSettings {
  modelId: string;
  modeId: string;
  baseUrl: string;
  hasApiKey: boolean;
  /** When true, run_command executes without a confirmation prompt. */
  terminalAutoRun: boolean;
}

/** A chat in the sidebar chat list. */
export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
}

/** Messages sent FROM the webview TO the extension host. */
export type WebviewToExtension =
  | { type: "ready" }
  | { type: "sendMessage"; text: string; images?: string[] }
  | { type: "cancel" }
  | { type: "newChat" }
  | { type: "switchChat"; id: string }
  | { type: "deleteChat"; id: string }
  | { type: "setModel"; modelId: string }
  | { type: "setMode"; modeId: string }
  | { type: "setTerminalAutoRun"; value: boolean }
  | { type: "saveApiSettings"; baseUrl: string; apiKey?: string };

/** Messages sent FROM the extension host TO the webview. */
export type ExtensionToWebview =
  | { type: "init"; settings: UiSettings }
  | { type: "assistantStart"; id: string }
  | { type: "assistantDelta"; id: string; delta: string }
  | { type: "assistantDone"; id: string }
  | { type: "toolStart"; callId: string; name: string; title: string }
  | { type: "toolEnd"; callId: string; ok: boolean; summary: string }
  | { type: "status"; status: AgentStatus }
  | { type: "settings"; settings: UiSettings }
  | { type: "openApiSettings" }
  | { type: "chats"; list: ChatSummary[]; activeId: string | undefined }
  | { type: "error"; message: string }
  | { type: "busy"; value: boolean }
  // `restore` now carries the full timeline of the active chat (for switching).
  | { type: "restore"; items: UiTimelineItem[] };
