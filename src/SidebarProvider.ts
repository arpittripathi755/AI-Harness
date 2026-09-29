import * as vscode from "vscode";
import { ChatSession } from "./agent/ChatSession";
import { ConversationManager } from "./agent/ConversationManager";
import {
  getApiKey,
  getBaseUrl,
  getModeId,
  getModelId,
  getTerminalAutoRun,
  hasApiKey,
  MissingApiKeyError,
  resolveConfig,
  setApiKey,
  setBaseUrl,
  setModeId,
  setModelId,
  setTerminalAutoRun,
} from "./config";
import { getMode } from "./shared/modes";
import type {
  ExtensionToWebview,
  UiSettings,
  UiTimelineItem,
  WebviewToExtension,
} from "./shared/protocol";
import { createToolRegistry } from "./tools";
import { ChangeManager } from "./tools/changes";
import type { ToolContext } from "./tools/types";
import {
  getWorkspaceRoot,
  resolvePathInWorkspace,
  toRelative,
} from "./tools/workspace";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "claudeAgent.chat";

  private view: vscode.WebviewView | undefined;
  private session: ChatSession | undefined;
  private sessionConversationId: string | undefined;
  private ctx: ToolContext | undefined;
  private changeManager: ChangeManager | undefined;
  private readonly chats: ConversationManager;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.chats = new ConversationManager(context.workspaceState);
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.session = undefined;
        this.sessionConversationId = undefined;
        this.ctx = undefined;
        this.changeManager?.clear();
        this.changeManager = undefined;
      }),
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: WebviewToExtension) =>
      this.handleMessage(msg),
    );
  }

  /** Start a fresh conversation (command / header button). */
  public newChat(): void {
    this.session?.cancel();
    this.session = undefined;
    this.sessionConversationId = undefined;
    this.changeManager?.clear();
    this.changeManager = undefined;
    this.ctx = undefined;
    this.chats.create();
    this.post({ type: "restore", items: [] });
    this.postChats();
    this.post({ type: "busy", value: false });
    this.post({ type: "status", status: "Idle" });
  }

  public openApiSettings(): void {
    this.post({ type: "openApiSettings" });
  }

  private async handleMessage(msg: WebviewToExtension): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.post({ type: "init", settings: await this.buildSettings() });
        this.post({ type: "restore", items: this.chats.active.timeline });
        this.postChats();
        break;
      case "sendMessage":
        await this.handleSend(msg.text, msg.images);
        break;
      case "cancel":
        this.session?.cancel();
        break;
      case "newChat":
        this.newChat();
        break;
      case "switchChat":
        this.switchChat(msg.id);
        break;
      case "deleteChat":
        this.deleteChat(msg.id);
        break;
      case "setModel":
        await setModelId(this.context, msg.modelId);
        this.session?.setModel(getModelId(this.context));
        this.post({ type: "settings", settings: await this.buildSettings() });
        break;
      case "setMode":
        await setModeId(this.context, msg.modeId);
        this.session?.setMode(getMode(getModeId(this.context)).allowMutations);
        if (this.ctx) {
          this.ctx.autoEdit = getMode(getModeId(this.context)).allowMutations;
        }
        this.post({ type: "settings", settings: await this.buildSettings() });
        break;
      case "setTerminalAutoRun":
        await setTerminalAutoRun(this.context, msg.value);
        if (this.ctx) {
          this.ctx.terminalAutoRun = msg.value;
        }
        this.post({ type: "settings", settings: await this.buildSettings() });
        break;
      case "saveApiSettings":
        await this.saveApiSettings(msg.baseUrl, msg.apiKey);
        break;
    }
  }

  private switchChat(id: string): void {
    this.session?.cancel();
    this.session = undefined;
    this.sessionConversationId = undefined;
    this.changeManager?.clear();
    this.changeManager = undefined;
    this.ctx = undefined;
    this.chats.setActive(id);
    this.post({ type: "restore", items: this.chats.active.timeline });
    this.postChats();
    this.post({ type: "busy", value: false });
    this.post({ type: "status", status: "Idle" });
  }

  private deleteChat(id: string): void {
    const wasActive = this.chats.activeConversationId === id;
    this.chats.delete(id);
    if (wasActive) {
      this.session?.cancel();
      this.session = undefined;
      this.sessionConversationId = undefined;
      this.changeManager?.clear();
      this.changeManager = undefined;
      this.ctx = undefined;
      this.post({ type: "restore", items: this.chats.active.timeline });
    }
    this.postChats();
  }

  private postChats(): void {
    this.post({
      type: "chats",
      list: this.chats.summaries(),
      activeId: this.chats.activeConversationId,
    });
  }

  private async saveApiSettings(baseUrl: string, apiKey?: string): Promise<void> {
    await setBaseUrl(this.context, baseUrl);
    if (apiKey !== undefined && apiKey.trim().length > 0) {
      await setApiKey(this.context, apiKey);
    }
    if (this.session) {
      const key = await getApiKey(this.context);
      if (key) {
        this.session.setEndpoint(getBaseUrl(this.context), key);
      }
    }
    this.post({ type: "settings", settings: await this.buildSettings() });
  }

  private async buildSettings(): Promise<UiSettings> {
    return {
      modelId: getModelId(this.context),
      modeId: getModeId(this.context),
      baseUrl: getBaseUrl(this.context),
      hasApiKey: await hasApiKey(this.context),
      terminalAutoRun: getTerminalAutoRun(this.context),
    };
  }

  private async handleSend(text: string, images?: string[]): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed && (!images || images.length === 0)) {
      return;
    }

    let session: ChatSession;
    try {
      session = await this.getSession();
    } catch (err) {
      if (err instanceof MissingApiKeyError) {
        this.post({ type: "openApiSettings" });
        this.post({
          type: "error",
          message: "Add your OpenRouter API key to start (click the ⚙ button).",
        });
      } else {
        this.post({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // Record the user turn in the active conversation's timeline.
    this.chats.maybeTitleFrom(trimmed || "Image message");
    this.appendTimeline({
      kind: "message",
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      images: images && images.length ? images : undefined,
    });
    this.postChats();

    this.post({ type: "busy", value: true });
    try {
      await session.send(trimmed, {
        onAssistantStart: (id) => {
          this.appendTimeline({ kind: "message", id, role: "assistant", content: "" });
          this.post({ type: "assistantStart", id });
        },
        onAssistantDelta: (id, delta) => {
          this.appendAssistantDelta(id, delta);
          this.post({ type: "assistantDelta", id, delta });
        },
        onAssistantDone: (id) => this.post({ type: "assistantDone", id }),
        onToolStart: (callId, name, title) => {
          this.appendTimeline({
            kind: "tool",
            callId,
            name,
            title,
            status: "running",
          });
          this.post({ type: "toolStart", callId, name, title });
        },
        onToolEnd: (callId, ok, summary) => {
          this.updateToolItem(callId, ok, summary);
          this.post({ type: "toolEnd", callId, ok, summary });
        },
        onStatus: (status) => this.post({ type: "status", status }),
        onError: (message) => this.post({ type: "error", message }),
      }, images);

      // Persist the LLM history and active task memory after the turn completes.
      this.chats.active.history = session.exportHistory();
      this.chats.active.taskMemory = session.exportTaskMemory();
      this.chats.save();

      // Apply staged changes atomically if any were produced during the turn
      const allowMutations = getMode(getModeId(this.context)).allowMutations;
      if (allowMutations && this.changeManager?.hasStaged()) {
        try {
          await this.changeManager.applyChangeSet();
        } catch (err: any) {
          this.post({
            type: "error",
            message: `Failed to apply staged changes: ${err.message || String(err)}`,
          });
        }
      }
    } catch (err: any) {
      this.post({
        type: "error",
        message: err.message || String(err),
      });
    } finally {
      this.post({ type: "busy", value: false });
      this.post({ type: "status", status: "Idle" });
    }
  }

  // ---- timeline mirroring (source of truth for persistence + switching) ----

  private appendTimeline(item: UiTimelineItem): void {
    this.chats.active.timeline.push(item);
    this.chats.save();
  }

  private appendAssistantDelta(id: string, delta: string): void {
    const items = this.chats.active.timeline;
    const item = items.find((it) => it.kind === "message" && it.id === id);
    if (item && item.kind === "message") {
      item.content += delta;
    }
  }

  private updateToolItem(callId: string, ok: boolean, summary: string): void {
    const item = this.chats.active.timeline.find(
      (it) => it.kind === "tool" && it.callId === callId,
    );
    if (item && item.kind === "tool") {
      item.status = ok ? "ok" : "error";
      item.summary = summary;
    }
    this.chats.save();
  }

  /**
   * Build (or reuse) the ChatSession for the active conversation, reseeding it
   * from the persisted history so switching chats preserves context.
   */
  private async getSession(): Promise<ChatSession> {
    if (this.session && this.sessionConversationId === this.chats.activeConversationId) {
      return this.session;
    }
    this.session?.cancel();
    this.session = undefined;

    const config = await resolveConfig(this.context);
    const registry = createToolRegistry();
    const ctx = this.ensureToolContext();
    const folder = vscode.workspace.workspaceFolders?.[0];
    const allowMutations = getMode(getModeId(this.context)).allowMutations;
    this.session = ChatSession.create(
      config,
      registry,
      ctx,
      folder?.name,
      allowMutations,
      this.chats.active.history,
      this.chats.active.taskMemory,
    );
    this.sessionConversationId = this.chats.activeConversationId;
    return this.session;
  }

  private ensureToolContext(): ToolContext {
    const root = getWorkspaceRoot();
    const confirm = async (message: string, detail?: string) => {
      const pick = await vscode.window.showWarningMessage(
        message,
        { modal: true, detail },
        "Allow",
      );
      return pick === "Allow";
    };
    if (!this.changeManager && root) {
      this.changeManager = new ChangeManager(root);
    }
    this.ctx = {
      workspaceRoot: root,
      terminalAutoRun: getTerminalAutoRun(this.context),
      autoEdit: getMode(getModeId(this.context)).allowMutations,
      changeManager: this.changeManager,
      resolvePath: (input) => resolvePathInWorkspace(input, root, confirm),
      toRelative: (uri) => toRelative(root, uri),
      confirm,
    };
    return this.ctx;
  }

  /** Visible for testing */
  public getChangeManager(): ChangeManager | undefined {
    return this.changeManager;
  }

  /** Visible for testing */
  public getToolContext(): ToolContext | undefined {
    return this.ctx;
  }

  private post(msg: ExtensionToWebview): void {
    this.view?.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Axiom</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
