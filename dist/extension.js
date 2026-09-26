/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ([
/* 0 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(__webpack_require__(1));
const SidebarProvider_1 = __webpack_require__(2);
const config_1 = __webpack_require__(33);
function activate(context) {
    console.log("Axiom Activated");
    const provider = new SidebarProvider_1.SidebarProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarProvider_1.SidebarProvider.viewType, provider), vscode.commands.registerCommand("claude-agent.setApiKey", async () => {
        const stored = await (0, config_1.promptAndStoreApiKey)(context);
        if (stored) {
            vscode.window.showInformationMessage("Axiom API key saved.");
        }
    }), vscode.commands.registerCommand("claude-agent.newChat", () => {
        provider.newChat();
    }), vscode.commands.registerCommand("claude-agent.open", () => {
        // Reveal the chat view (VS Code auto-generates the `<viewId>.focus` command).
        vscode.commands.executeCommand("claudeAgent.chat.focus");
    }), vscode.commands.registerCommand("claude-agent.apiSettings", () => {
        vscode.commands.executeCommand("claudeAgent.chat.focus");
        provider.openApiSettings();
    }));
}
function deactivate() { }


/***/ }),
/* 1 */
/***/ ((module) => {

module.exports = require("vscode");

/***/ }),
/* 2 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.SidebarProvider = void 0;
const vscode = __importStar(__webpack_require__(1));
const ChatSession_1 = __webpack_require__(3);
const ConversationManager_1 = __webpack_require__(32);
const config_1 = __webpack_require__(33);
const modes_1 = __webpack_require__(8);
const tools_1 = __webpack_require__(34);
const workspace_1 = __webpack_require__(48);
class SidebarProvider {
    context;
    static viewType = "claudeAgent.chat";
    view;
    session;
    ctx;
    chats;
    constructor(context) {
        this.context = context;
        this.chats = new ConversationManager_1.ConversationManager(context.workspaceState);
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, "dist"),
                vscode.Uri.joinPath(this.context.extensionUri, "media"),
            ],
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);
        webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    }
    /** Start a fresh conversation (command / header button). */
    newChat() {
        this.session?.cancel();
        this.session = undefined;
        this.chats.create();
        this.post({ type: "restore", items: [] });
        this.postChats();
        this.post({ type: "busy", value: false });
        this.post({ type: "status", status: "Idle" });
    }
    openApiSettings() {
        this.post({ type: "openApiSettings" });
    }
    async handleMessage(msg) {
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
                await (0, config_1.setModelId)(this.context, msg.modelId);
                this.session?.setModel((0, config_1.getModelId)(this.context));
                this.post({ type: "settings", settings: await this.buildSettings() });
                break;
            case "setMode":
                await (0, config_1.setModeId)(this.context, msg.modeId);
                const newMode = (0, modes_1.getMode)((0, config_1.getModeId)(this.context));
                if (this.ctx) {
                    this.ctx.requireApproval = newMode.requireApproval;
                }
                this.session?.setMode(newMode);
                this.post({ type: "settings", settings: await this.buildSettings() });
                break;
            case "setTerminalAutoRun":
                await (0, config_1.setTerminalAutoRun)(this.context, msg.value);
                if (this.ctx) {
                    this.ctx.terminalAutoRun = msg.value;
                }
                this.post({ type: "settings", settings: await this.buildSettings() });
                break;
            case "saveApiSettings":
                await this.saveApiSettings(msg.baseUrl, msg.apiKey);
                break;
            case "acceptChanges":
                this.session?.resolveApproval(msg.changeSetId, true);
                this.updateChangeSetItem(msg.changeSetId, "accepted");
                this.post({
                    type: "changeSetUpdate",
                    changeSetId: msg.changeSetId,
                    status: "accepted",
                });
                break;
            case "rejectChanges":
                this.session?.resolveApproval(msg.changeSetId, false);
                this.updateChangeSetItem(msg.changeSetId, "rejected");
                this.post({
                    type: "changeSetUpdate",
                    changeSetId: msg.changeSetId,
                    status: "rejected",
                });
                break;
        }
    }
    switchChat(id) {
        this.session?.cancel();
        this.session = undefined;
        this.chats.setActive(id);
        this.post({ type: "restore", items: this.chats.active.timeline });
        this.postChats();
        this.post({ type: "busy", value: false });
        this.post({ type: "status", status: "Idle" });
    }
    deleteChat(id) {
        const wasActive = this.chats.activeConversationId === id;
        this.chats.delete(id);
        if (wasActive) {
            this.session?.cancel();
            this.session = undefined;
            this.post({ type: "restore", items: this.chats.active.timeline });
        }
        this.postChats();
    }
    postChats() {
        this.post({
            type: "chats",
            list: this.chats.summaries(),
            activeId: this.chats.activeConversationId,
        });
    }
    async saveApiSettings(baseUrl, apiKey) {
        await (0, config_1.setBaseUrl)(this.context, baseUrl);
        if (apiKey !== undefined && apiKey.trim().length > 0) {
            await (0, config_1.setApiKey)(this.context, apiKey);
        }
        if (this.session) {
            const key = await (0, config_1.getApiKey)(this.context);
            if (key) {
                this.session.setEndpoint((0, config_1.getBaseUrl)(this.context), key);
            }
        }
        this.post({ type: "settings", settings: await this.buildSettings() });
    }
    async buildSettings() {
        return {
            modelId: (0, config_1.getModelId)(this.context),
            modeId: (0, config_1.getModeId)(this.context),
            baseUrl: (0, config_1.getBaseUrl)(this.context),
            hasApiKey: await (0, config_1.hasApiKey)(this.context),
            terminalAutoRun: (0, config_1.getTerminalAutoRun)(this.context),
        };
    }
    async handleSend(text, images) {
        const trimmed = text.trim();
        if (!trimmed && (!images || images.length === 0)) {
            return;
        }
        let session;
        try {
            session = await this.getSession();
        }
        catch (err) {
            if (err instanceof config_1.MissingApiKeyError) {
                this.post({ type: "openApiSettings" });
                this.post({
                    type: "error",
                    message: "Add your Lightning API key to start (click the ⚙ button).",
                });
            }
            else {
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
            onPendingChangeSet: (changeSet) => {
                this.appendTimeline(changeSet);
                this.post({ type: "changeSetStart", changeSet });
            },
            onPendingChangeSetUpdate: (changeSetId, status) => {
                this.updateChangeSetItem(changeSetId, status);
                this.post({ type: "changeSetUpdate", changeSetId, status });
            },
            onStatus: (status) => this.post({ type: "status", status }),
            onError: (message) => this.post({ type: "error", message }),
        }, images);
        // Persist the LLM history after the turn completes.
        this.chats.active.history = session.exportHistory();
        this.chats.save();
        this.post({ type: "busy", value: false });
        this.post({ type: "status", status: "Idle" });
    }
    // ---- timeline mirroring (source of truth for persistence + switching) ----
    appendTimeline(item) {
        this.chats.active.timeline.push(item);
        this.chats.save();
    }
    appendAssistantDelta(id, delta) {
        const items = this.chats.active.timeline;
        const item = items.find((it) => it.kind === "message" && it.id === id);
        if (item && item.kind === "message") {
            item.content += delta;
        }
    }
    updateToolItem(callId, ok, summary) {
        const item = this.chats.active.timeline.find((it) => it.kind === "tool" && it.callId === callId);
        if (item && item.kind === "tool") {
            item.status = ok ? "ok" : "error";
            item.summary = summary;
        }
        this.chats.save();
    }
    updateChangeSetItem(changeSetId, status) {
        const item = this.chats.active.timeline.find((it) => it.kind === "changeset" && it.id === changeSetId);
        if (item && item.kind === "changeset") {
            item.status = status;
            this.chats.save();
        }
    }
    /**
     * Build (or reuse) the ChatSession for the active conversation, reseeding it
     * from the persisted history so switching chats preserves context.
     */
    async getSession() {
        if (this.session) {
            return this.session;
        }
        const config = await (0, config_1.resolveConfig)(this.context);
        const registry = (0, tools_1.createToolRegistry)();
        const ctx = this.ensureToolContext();
        const folder = vscode.workspace.workspaceFolders?.[0];
        const modeInfo = (0, modes_1.getMode)((0, config_1.getModeId)(this.context));
        this.session = ChatSession_1.ChatSession.create(config, registry, ctx, folder?.name, modeInfo, this.chats.active.history);
        return this.session;
    }
    ensureToolContext() {
        const modeInfo = (0, modes_1.getMode)((0, config_1.getModeId)(this.context));
        if (this.ctx) {
            this.ctx.terminalAutoRun = (0, config_1.getTerminalAutoRun)(this.context);
            this.ctx.requireApproval = modeInfo.requireApproval;
            return this.ctx;
        }
        const root = (0, workspace_1.getWorkspaceRoot)();
        const confirm = async (message, detail) => {
            const pick = await vscode.window.showWarningMessage(message, { modal: true, detail }, "Allow");
            return pick === "Allow";
        };
        this.ctx = {
            workspaceRoot: root,
            terminalAutoRun: (0, config_1.getTerminalAutoRun)(this.context),
            requireApproval: modeInfo.requireApproval,
            resolvePath: (input) => (0, workspace_1.resolvePathInWorkspace)(input, root, confirm),
            toRelative: (uri) => (0, workspace_1.toRelative)(root, uri),
            confirm,
        };
        return this.ctx;
    }
    post(msg) {
        this.view?.webview.postMessage(msg);
    }
    getHtml(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"));
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
exports.SidebarProvider = SidebarProvider;
function getNonce() {
    let text = "";
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}


/***/ }),
/* 3 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ChatSession = exports.AGENT_NAME = void 0;
const LLMClient_1 = __webpack_require__(4);
const models_1 = __webpack_require__(5);
const modes_1 = __webpack_require__(8);
const changes_1 = __webpack_require__(9);
/** Product name shown to the user and used in the agent's self-identity. */
exports.AGENT_NAME = "Axiom";
/** Safety bound on tool round-trips within a single user turn. */
const MAX_ITERATIONS = 25;
function buildSystemPrompt(modelDisplay, workspaceName, root, modeInfo) {
    const ws = root
        ? `You are operating inside the user's VS Code workspace.
Workspace: ${workspaceName ?? "(unnamed)"}
Workspace root: ${root}
All file paths you pass to tools are resolved relative to this root. You may only
access files inside this workspace unless the user explicitly approves otherwise.`
        : `No workspace folder is currently open. File tools will fail until the user opens a folder.`;
    let modeGuidance = "";
    if (!modeInfo.allowMutations) {
        modeGuidance = `MODE: Plan (READ-ONLY). You currently have ONLY read-only tools; editing tools are
disabled and will be refused. Do the following:
- Inspect the workspace, search, and read the relevant files.
- Then explain precisely what changes you would make (which files, what edits, and why).
- Present it as a clear, numbered plan and stop. Do not attempt to modify anything.
- Tell the user to switch to Auto Edit or Manual Mode to apply the plan.`;
    }
    else if (modeInfo.requireApproval) {
        modeGuidance = `MODE: Manual Mode (Review & Approval Required). Work to complete the task:
- Inspect the workspace, search, and read the files you need.
- Propose file modifications, creations, renames, and deletions using tools.
- When you use file editing tools, a change set with a unified diff is presented to the user for review.
- The user can Accept or Reject the changes before they are written to disk.
- If accepted, the changes are applied and you can continue. If rejected, you will receive notification that the changes were discarded so you can adapt your plan.
- Continue using tools to accomplish the goal.`;
    }
    else {
        modeGuidance = `MODE: Auto Edit. Work autonomously to complete the task:
- Inspect the workspace, search, and read the files you need.
- Create, edit, rename, and multi-edit files directly to accomplish the goal.
- Keep using tools until the task is fully done, then summarize what you changed.
- Only deletions and terminal commands require the user to confirm.`;
    }
    return `You are ${exports.AGENT_NAME}, an autonomous AI coding assistant embedded in VS Code.

Your name is ${exports.AGENT_NAME}. You are currently powered by the "${modelDisplay}" model,
served through an OpenAI-compatible API. If the user asks which model or AI you are,
answer honestly that you are ${exports.AGENT_NAME} running on the "${modelDisplay}" model.

${ws}

${modeGuidance}

Work by reasoning step by step: think, choose a tool, execute it, observe the result,
then continue until the task is complete. Inspect real files rather than guessing.

Be efficient with tool calls to minimize API usage:
- When you need several independent files, request them in ONE step with multiple tool
  calls rather than one at a time.
- Read a file once; reuse what you already saw instead of re-reading it.
- Read only the parts you need (use line ranges / search) instead of dumping whole large files.
- Stop as soon as the task is done; don't make extra calls to double-check needlessly.

Be concise and precise. Use fenced code blocks with correct language tags for any code.`;
}
/** Human display name for an API model id, falling back to the raw id. */
function modelDisplayName(apiModelId) {
    return (0, models_1.getModelByApiId)(apiModelId)?.displayName ?? apiModelId;
}
/** Map a tool name to a live status shown while it runs. */
function statusForTool(name) {
    switch (name) {
        case "search_workspace":
            return "Searching workspace…";
        case "list_files":
        case "read_file":
        case "read_active_editor":
        case "read_selection":
            return "Reading files…";
        case "create_file":
        case "edit_file":
        case "rename_file":
        case "multi_edit":
            return "Editing files…";
        case "delete_file":
            return "Waiting for approval…";
        case "run_command":
            return "Running terminal command…";
        default:
            return "Working…";
    }
}
/**
 * Owns conversation state and runs the agentic loop: stream a turn, execute any
 * tool calls via the registry (dynamic dispatch by name), feed results back, and
 * repeat until the model responds without tool calls. Model, mode, and endpoint
 * can all be changed live between turns.
 */
class ChatSession {
    client;
    registry;
    ctx;
    workspaceName;
    messages;
    abortController;
    counter = 0;
    /** Whether the current model supports tool calling on this endpoint. */
    toolsSupported;
    /** Whether the current model accepts image inputs. */
    visionSupported;
    /** Display name of the current model, injected into the system prompt. */
    modelDisplay;
    /** Active mode information (plan, manual, or auto). */
    modeInfo;
    /** Pending user approval promises for change sets. */
    pendingApprovals = new Map();
    constructor(client, registry, ctx, workspaceName, mode, initialModelId, seedHistory) {
        this.client = client;
        this.registry = registry;
        this.ctx = ctx;
        this.workspaceName = workspaceName;
        if (typeof mode === "boolean") {
            this.modeInfo = (0, modes_1.getMode)(mode ? "auto" : "plan");
        }
        else if (typeof mode === "string") {
            this.modeInfo = (0, modes_1.getMode)((0, modes_1.resolveModeId)(mode));
        }
        else {
            this.modeInfo = mode;
        }
        this.ctx.requireApproval = this.modeInfo.requireApproval;
        this.toolsSupported = (0, models_1.modelSupportsTools)(initialModelId);
        this.visionSupported = (0, models_1.modelSupportsVision)(initialModelId);
        this.modelDisplay = modelDisplayName(initialModelId);
        this.messages = [{ role: "system", content: this.systemPrompt() }];
        if (seedHistory && seedHistory.length) {
            this.messages.push(...seedHistory);
        }
    }
    static create(opts, registry, ctx, workspaceName, mode, seedHistory) {
        return new ChatSession(new LLMClient_1.LLMClient(opts), registry, ctx, workspaceName, mode, opts.model, seedHistory);
    }
    /** Conversation history excluding the system prompt (for persistence). */
    exportHistory() {
        return this.messages.slice(1);
    }
    systemPrompt() {
        return buildSystemPrompt(this.modelDisplay, this.workspaceName, this.ctx.workspaceRoot?.fsPath, this.modeInfo);
    }
    /** Refresh the system message in place after a live model/mode change. */
    refreshSystemPrompt() {
        this.messages[0] = { role: "system", content: this.systemPrompt() };
    }
    /** Build user-message content, attaching images only for vision models. */
    buildUserContent(text, images) {
        if (!images || images.length === 0 || !this.visionSupported) {
            return text;
        }
        const parts = [];
        if (text) {
            parts.push({ type: "text", text });
        }
        for (const url of images) {
            parts.push({ type: "image_url", image_url: { url } });
        }
        return parts;
    }
    get busy() {
        return this.abortController !== undefined;
    }
    /** Change the model live (no restart, applies to the next request). */
    setModel(apiModelId) {
        this.client.setModel(apiModelId);
        this.toolsSupported = (0, models_1.modelSupportsTools)(apiModelId);
        this.visionSupported = (0, models_1.modelSupportsVision)(apiModelId);
        this.modelDisplay = modelDisplayName(apiModelId);
        this.refreshSystemPrompt();
    }
    /** Change the agent mode live; updates the system prompt and tool availability. */
    setMode(mode) {
        if (typeof mode === "boolean") {
            this.modeInfo = (0, modes_1.getMode)(mode ? "auto" : "plan");
        }
        else if (typeof mode === "string") {
            this.modeInfo = (0, modes_1.getMode)((0, modes_1.resolveModeId)(mode));
        }
        else {
            this.modeInfo = mode;
        }
        this.ctx.requireApproval = this.modeInfo.requireApproval;
        this.refreshSystemPrompt();
    }
    /** Resolve a pending change set approval from the webview. */
    resolveApproval(changeSetId, approved) {
        const resolver = this.pendingApprovals.get(changeSetId);
        if (resolver) {
            this.pendingApprovals.delete(changeSetId);
            resolver(approved);
            return true;
        }
        return false;
    }
    /** Update the endpoint (base URL / API key) live. */
    setEndpoint(baseUrl, apiKey) {
        this.client.setEndpoint(baseUrl, apiKey);
    }
    reset() {
        this.cancel();
        this.messages = [{ role: "system", content: this.systemPrompt() }];
    }
    cancel() {
        for (const [, resolver] of this.pendingApprovals.entries()) {
            resolver(false);
        }
        this.pendingApprovals.clear();
        this.abortController?.abort();
        this.abortController = undefined;
    }
    /**
     * Run one user turn to completion (may involve several tool round-trips).
     * `images` are data-URL strings; they are attached only for vision-capable
     * models and silently omitted otherwise (no error).
     */
    async send(userText, cb, images) {
        if (this.busy) {
            cb.onError("A response is already in progress.");
            return;
        }
        this.messages.push({ role: "user", content: this.buildUserContent(userText, images) });
        const controller = new AbortController();
        this.abortController = controller;
        // Omit tools entirely for models that can't do tool calling on this endpoint;
        // they run as plain chat (no agent loop) rather than 400ing.
        const toolDefs = this.toolsSupported
            ? this.registry.definitions(this.modeInfo.allowMutations)
            : undefined;
        try {
            for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
                const id = `a${++this.counter}`;
                let started = false;
                cb.onStatus("Thinking…");
                const ensureStarted = () => {
                    if (!started) {
                        started = true;
                        cb.onStatus("Generating response…");
                        cb.onAssistantStart(id);
                    }
                };
                const gen = this.client.stream(this.messages, {
                    signal: controller.signal,
                    tools: toolDefs,
                    onRetry: () => cb.onStatus("Rate limited — retrying…"),
                });
                let next = await gen.next();
                while (!next.done) {
                    ensureStarted();
                    cb.onAssistantDelta(id, next.value.delta);
                    next = await gen.next();
                }
                const turn = next.value;
                if (started) {
                    cb.onAssistantDone(id);
                }
                this.messages.push({
                    role: "assistant",
                    content: turn.content || null,
                    tool_calls: turn.toolCalls.length ? turn.toolCalls : undefined,
                });
                if (turn.toolCalls.length === 0) {
                    cb.onStatus("Finished");
                    return;
                }
                if (this.modeInfo.requireApproval) {
                    await this.executeTurnWithApproval(turn.toolCalls, cb);
                }
                else {
                    for (const call of turn.toolCalls) {
                        await this.runToolCall(call, cb);
                    }
                }
                // Loop again so the model can continue with the tool results.
            }
            cb.onError(`Stopped after ${MAX_ITERATIONS} tool iterations without a final answer.`);
        }
        catch (err) {
            if (controller.signal.aborted) {
                return; // user cancelled; state already recorded up to this point
            }
            cb.onError(friendlyError(err instanceof Error ? err.message : String(err)));
        }
        finally {
            if (this.abortController === controller) {
                this.abortController = undefined;
            }
        }
    }
    /**
     * Execute tool calls in manual mode: validate and stage file modifications in memory,
     * display a unified review change set in the webview, and wait for the user to
     * Accept or Reject before applying any changes to the workspace.
     */
    async executeTurnWithApproval(calls, cb) {
        const nonMutatingCalls = [];
        const mutatingCalls = [];
        for (const call of calls) {
            if ((0, changes_1.isFileMutatingTool)(call.function.name)) {
                mutatingCalls.push(call);
            }
            else {
                nonMutatingCalls.push(call);
            }
        }
        // Run read-only or system inspection calls first
        for (const call of nonMutatingCalls) {
            await this.runToolCall(call, cb);
        }
        if (mutatingCalls.length === 0) {
            return;
        }
        // Prepare each mutating call in-memory without touching disk
        const preparedList = [];
        let preparationFailed = false;
        for (const call of mutatingCalls) {
            let args = {};
            try {
                args = call.function.arguments
                    ? JSON.parse(call.function.arguments)
                    : {};
            }
            catch {
                const parseErr = `Invalid JSON arguments: ${call.function.arguments}`;
                cb.onToolStart(call.id, call.function.name, describeCall(call.function.name, args));
                cb.onToolEnd(call.id, false, parseErr);
                this.messages.push({ role: "tool", tool_call_id: call.id, content: `Error: ${parseErr}` });
                preparationFailed = true;
                continue;
            }
            try {
                const prep = await (0, changes_1.prepareFileToolCall)(call.id, call.function.name, args, this.ctx);
                if (prep) {
                    preparedList.push(prep);
                }
                else {
                    await this.runToolCall(call, cb);
                }
            }
            catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                cb.onToolStart(call.id, call.function.name, describeCall(call.function.name, args));
                cb.onToolEnd(call.id, false, errMsg);
                this.messages.push({ role: "tool", tool_call_id: call.id, content: `Error: ${errMsg}` });
                preparationFailed = true;
            }
        }
        if (preparationFailed || preparedList.length === 0) {
            for (const prep of preparedList) {
                const res = prep.rejectionResult();
                this.messages.push({ role: "tool", tool_call_id: prep.callId, content: res.content });
                cb.onToolEnd(prep.callId, false, res.summary ?? "Discarded");
            }
            return;
        }
        // Combine all file modifications into a single change set for review
        const allChanges = [];
        for (const prep of preparedList) {
            allChanges.push(...prep.changes);
        }
        const totalAdditions = allChanges.reduce((acc, c) => acc + c.additions, 0);
        const totalDeletions = allChanges.reduce((acc, c) => acc + c.deletions, 0);
        const changeSetId = `cs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const changeSet = {
            kind: "changeset",
            id: changeSetId,
            files: allChanges,
            totalAdditions,
            totalDeletions,
            status: "pending",
        };
        for (const prep of preparedList) {
            cb.onToolStart(prep.callId, prep.name, describeCall(prep.name, {}));
        }
        cb.onPendingChangeSet?.(changeSet);
        cb.onStatus("Waiting for approval…");
        let approved = false;
        try {
            approved = await new Promise((resolve) => {
                this.pendingApprovals.set(changeSetId, resolve);
            });
        }
        catch {
            approved = false;
        }
        finally {
            this.pendingApprovals.delete(changeSetId);
        }
        if (approved) {
            cb.onPendingChangeSetUpdate?.(changeSetId, "accepted");
            cb.onStatus("Editing files…");
            for (const prep of preparedList) {
                try {
                    const res = await prep.apply();
                    this.messages.push({
                        role: "tool",
                        tool_call_id: prep.callId,
                        content: res.content,
                    });
                    cb.onToolEnd(prep.callId, !res.isError, res.summary ?? "Done");
                }
                catch (err) {
                    const errMsg = `Error applying changes: ${err instanceof Error ? err.message : String(err)}`;
                    this.messages.push({
                        role: "tool",
                        tool_call_id: prep.callId,
                        content: errMsg,
                    });
                    cb.onToolEnd(prep.callId, false, errMsg);
                }
            }
        }
        else {
            cb.onPendingChangeSetUpdate?.(changeSetId, "rejected");
            cb.onStatus("Working…");
            for (const prep of preparedList) {
                const res = prep.rejectionResult();
                this.messages.push({
                    role: "tool",
                    tool_call_id: prep.callId,
                    content: res.content,
                });
                cb.onToolEnd(prep.callId, false, res.summary ?? "Rejected");
            }
        }
    }
    async runToolCall(call, cb) {
        const name = call.function.name;
        const tool = this.registry.get(name);
        let args = {};
        let parseError;
        try {
            args = call.function.arguments
                ? JSON.parse(call.function.arguments)
                : {};
        }
        catch {
            parseError = `Invalid JSON arguments: ${call.function.arguments}`;
        }
        const title = describeCall(name, args);
        cb.onStatus(statusForTool(name));
        cb.onToolStart(call.id, name, title);
        let content;
        let ok = false;
        let summary;
        if (!tool) {
            content = `Error: unknown tool "${name}".`;
            summary = `Unknown tool: ${name}`;
        }
        else if (parseError) {
            content = `Error: ${parseError}`;
            summary = parseError;
        }
        else if (!this.modeInfo.allowMutations && tool.mutates) {
            // Defense in depth: mutating tools aren't advertised in Plan mode, but if a
            // model calls one anyway, refuse it cleanly rather than editing files.
            content =
                `Refused: "${name}" modifies files and is disabled in Plan mode. ` +
                    `Describe the change instead, and tell the user to switch to Auto Edit mode to apply it.`;
            summary = "Blocked in Plan mode";
        }
        else {
            try {
                const result = await tool.execute(args, this.ctx);
                content = result.content;
                ok = !result.isError;
                summary = result.summary ?? (ok ? "Done" : "Failed");
            }
            catch (err) {
                content = `Error: ${err instanceof Error ? err.message : String(err)}`;
                summary = err instanceof Error ? err.message : "Failed";
            }
        }
        this.messages.push({ role: "tool", tool_call_id: call.id, content });
        cb.onToolEnd(call.id, ok, summary);
    }
}
exports.ChatSession = ChatSession;
/** Short human title for a tool card, e.g. `read_file → src/foo.ts`. */
function describeCall(name, args) {
    const hint = (typeof args.path === "string" && args.path) ||
        (typeof args.query === "string" && args.query) ||
        (typeof args.command === "string" && args.command) ||
        "";
    return hint ? `${name} → ${hint}` : name;
}
/** Turn raw endpoint errors into actionable guidance where we recognize them. */
function friendlyError(message) {
    if (/\b429\b|rate limit|too many requests/i.test(message)) {
        return ("Rate limit reached on the Lightning endpoint. The agent automatically " +
            "retried with backoff, but the limit is still in effect. Wait a minute and " +
            "try again, or upgrade your Lightning tier for a higher request rate.");
    }
    if (/reasoning_effort|\/v1\/responses|tools?.*not supported/i.test(message)) {
        return ("This model doesn't support tool calling on the Lightning chat/completions " +
            "endpoint, so it can't act as a file-editing agent. Pick a Claude model " +
            "(e.g. Claude Opus 4.8) for full agent capabilities.\n\n" +
            `Endpoint said: ${message}`);
    }
    return message;
}


/***/ }),
/* 4 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.LLMClient = void 0;
const models_1 = __webpack_require__(5);
const responses_1 = __webpack_require__(6);
const http_1 = __webpack_require__(7);
/**
 * Minimal OpenAI-compatible chat client built on native `fetch` — deliberately
 * NOT the Anthropic/openai SDK. Targets any endpoint exposing
 * `POST {baseUrl}chat/completions` with SSE streaming (e.g. Lightning AI).
 */
class LLMClient {
    opts;
    model;
    constructor(opts) {
        this.opts = opts;
        this.model = opts.model;
    }
    /** Change the model used for subsequent requests (live, no restart). */
    setModel(model) {
        this.model = model;
    }
    /** Update the base URL / API key for subsequent requests. */
    setEndpoint(baseUrl, apiKey) {
        this.opts.baseUrl = baseUrl;
        this.opts.apiKey = apiKey;
    }
    /**
     * Stream one assistant turn. Yields `{type:'text'}` deltas as text arrives and
     * accumulates any streamed tool-call fragments. When the stream ends, the
     * generator RETURNS the assembled {@link AssistantTurn} (content + tool calls).
     */
    async *stream(messages, { signal, tools, onRetry } = {}) {
        // Models that require the OpenAI Responses API (e.g. GPT-5.5) use a separate
        // adapter. The chat/completions path below is unchanged for every other model.
        if ((0, models_1.modelApi)(this.model) === "responses") {
            return yield* (0, responses_1.streamResponses)({
                baseUrl: this.opts.baseUrl,
                apiKey: this.opts.apiKey,
                model: this.model,
                messages,
                tools,
                signal,
                onRetry,
            });
        }
        const body = {
            model: this.model,
            messages,
            stream: true,
        };
        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = "auto";
        }
        const response = await (0, http_1.fetchWithRetry)(`${this.opts.baseUrl}chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.opts.apiKey}`,
            },
            body: JSON.stringify(body),
        }, { signal, onRetry });
        if (!response.ok || !response.body) {
            const detail = await safeReadText(response);
            throw new Error(`Request failed (${response.status} ${response.statusText})` +
                (detail ? `: ${detail}` : ""));
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let content = "";
        const toolAcc = new ToolCallAccumulator();
        let finishReason = null;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                let boundary;
                while ((boundary = buffer.indexOf("\n\n")) !== -1) {
                    const rawEvent = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    for (const chunk of parseSseEvent(rawEvent)) {
                        if (chunk === DONE) {
                            return { content, toolCalls: toolAcc.finalize(), finishReason };
                        }
                        const choice = chunk.choices?.[0];
                        if (!choice) {
                            continue;
                        }
                        if (choice.finish_reason) {
                            finishReason = choice.finish_reason;
                        }
                        const piece = choice.delta?.content;
                        if (piece) {
                            content += piece;
                            yield { type: "text", delta: piece };
                        }
                        if (choice.delta?.tool_calls) {
                            toolAcc.add(choice.delta.tool_calls);
                        }
                    }
                }
            }
        }
        finally {
            reader.releaseLock();
        }
        return { content, toolCalls: toolAcc.finalize(), finishReason };
    }
}
exports.LLMClient = LLMClient;
/**
 * Accumulates streamed tool-call fragments keyed by their `index`. OpenAI streams
 * tool calls as partials: the first fragment carries id/name, later fragments
 * append `arguments`. Non-streamed endpoints send a single complete fragment —
 * both cases collapse to the same result.
 */
class ToolCallAccumulator {
    byIndex = new Map();
    add(fragments) {
        for (const frag of fragments) {
            const entry = this.byIndex.get(frag.index) ?? {
                id: "",
                name: "",
                args: "",
            };
            if (frag.id) {
                entry.id = frag.id;
            }
            if (frag.function?.name) {
                entry.name = frag.function.name;
            }
            if (frag.function?.arguments) {
                entry.args += frag.function.arguments;
            }
            this.byIndex.set(frag.index, entry);
        }
    }
    finalize() {
        return [...this.byIndex.entries()]
            .sort(([a], [b]) => a - b)
            .map(([index, e]) => ({
            id: e.id || `call_${index}`,
            type: "function",
            function: { name: e.name, arguments: e.args || "{}" },
        }))
            .filter((c) => c.function.name);
    }
}
/** Sentinel returned when the endpoint signals `data: [DONE]`. */
const DONE = Symbol("done");
/** Parse one SSE event block into zero or more chunks (or the DONE sentinel). */
function parseSseEvent(rawEvent) {
    const out = [];
    for (const line of rawEvent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
            continue;
        }
        const data = trimmed.slice("data:".length).trim();
        if (data === "[DONE]") {
            out.push(DONE);
            continue;
        }
        try {
            out.push(JSON.parse(data));
        }
        catch {
            // Ignore keep-alive comments / non-JSON lines.
        }
    }
    return out;
}
async function safeReadText(response) {
    try {
        return (await response.text()).slice(0, 500);
    }
    catch {
        return "";
    }
}


/***/ }),
/* 5 */
/***/ ((__unused_webpack_module, exports) => {


/**
 * Central Model Registry — the single source of truth mapping user-facing display
 * names to Lightning API model IDs. Imported by BOTH bundles: the webview shows
 * `displayName`, the extension sends `apiModelId`. Add/remove a model here only.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DEFAULT_MODEL_ID = exports.MODELS = void 0;
exports.getModelByApiId = getModelByApiId;
exports.modelSupportsTools = modelSupportsTools;
exports.modelSupportsVision = modelSupportsVision;
exports.modelApi = modelApi;
exports.resolveModelId = resolveModelId;
exports.MODELS = [
    {
        displayName: "Nemotron 550B",
        apiModelId: "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b",
        // Text-only model; omit images rather than risk a 400.
        supportsVision: false,
    },
    { displayName: "Claude Fable 5", apiModelId: "anthropic/claude-fable-5" },
    { displayName: "Claude Opus 4.8", apiModelId: "anthropic/claude-opus-4-8" },
    { displayName: "Gemini 3.5 Flash", apiModelId: "google/gemini-3.5-flash" },
    { displayName: "5.3 codex", apiModelId: "gpt-5.3-codex" },
    {
        displayName: "GPT-5.5",
        apiModelId: "openai/gpt-5.5-2026-04-23",
        // GPT-5.5 rejects function tools on chat/completions, so it uses the
        // /v1/responses API (which supports tools) instead.
        api: "responses",
    },
    { displayName: "Claude Opus 4.7", apiModelId: "anthropic/claude-opus-4-7" },
    {
        displayName: "Claude Sonnet 4.6",
        apiModelId: "anthropic/claude-sonnet-4-6",
    },
    {
        displayName: "Claude Sonnet 4.5",
        apiModelId: "anthropic/claude-sonnet-4-5-20250929",
    },
    {
        displayName: "ultra",
        apiModelId: "nvidia/nemotron-3-ultra-550b-a55b",
    },
    {
        displayName: "deepseek v4",
        apiModelId: "deepseek-ai/deepseek-v4.1-flash",
    },
    {
        displayName: "kimi",
        apiModelId: "moonshotai/kimi-k3",
    },
];
/** Default evaluation model (text-only, supportsVision: false). */
exports.DEFAULT_MODEL_ID = "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b";
function getModelByApiId(apiModelId) {
    return exports.MODELS.find((m) => m.apiModelId === apiModelId);
}
/** Whether a model supports function/tool calling on this endpoint (default true). */
function modelSupportsTools(apiModelId) {
    return getModelByApiId(apiModelId)?.supportsTools !== false;
}
/** Whether a model accepts image inputs (default true). */
function modelSupportsVision(apiModelId) {
    return getModelByApiId(apiModelId)?.supportsVision !== false;
}
/** Which endpoint API a model uses ("chat" by default). */
function modelApi(apiModelId) {
    return getModelByApiId(apiModelId)?.api ?? "chat";
}
/** Resolve a stored/selected api id to a valid one, falling back to the default. */
function resolveModelId(apiModelId) {
    if (apiModelId && exports.MODELS.some((m) => m.apiModelId === apiModelId)) {
        return apiModelId;
    }
    return exports.DEFAULT_MODEL_ID;
}


/***/ }),
/* 6 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.streamResponses = streamResponses;
const http_1 = __webpack_require__(7);
/** Build the JSON body for POST {baseUrl}responses. */
function buildBody(model, messages, tools) {
    const input = [];
    for (const msg of messages) {
        if (msg.role === "system") {
            input.push({
                role: "system",
                content: [{ type: "input_text", text: asText(msg.content) }],
            });
        }
        else if (msg.role === "user") {
            input.push({ role: "user", content: toInputContent(msg.content) });
        }
        else if (msg.role === "assistant") {
            if (msg.content) {
                input.push({
                    role: "assistant",
                    content: [{ type: "output_text", text: asText(msg.content) }],
                });
            }
            // Replay prior tool calls as function_call items so the model has context.
            for (const call of msg.tool_calls ?? []) {
                input.push({
                    type: "function_call",
                    call_id: call.id,
                    name: call.function.name,
                    arguments: call.function.arguments,
                });
            }
        }
        else if (msg.role === "tool") {
            input.push({
                type: "function_call_output",
                call_id: msg.tool_call_id,
                output: asText(msg.content),
            });
        }
    }
    const body = { model, input, stream: true };
    if (tools && tools.length > 0) {
        // Responses API takes a flattened function-tool shape.
        body.tools = tools.map((t) => ({
            type: "function",
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
        }));
        body.tool_choice = "auto";
    }
    return body;
}
function asText(content) {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("");
    }
    return "";
}
/** Convert a user message's content into Responses `input_*` parts. */
function toInputContent(content) {
    if (typeof content === "string") {
        return [{ type: "input_text", text: content }];
    }
    if (!Array.isArray(content)) {
        return [{ type: "input_text", text: "" }];
    }
    return content.map((part) => part.type === "text"
        ? { type: "input_text", text: part.text }
        : { type: "input_image", image_url: part.image_url.url });
}
/**
 * Stream a turn from the Responses API. Yields text deltas and returns the
 * assembled turn (content + tool calls), matching LLMClient.stream's contract.
 */
async function* streamResponses(params) {
    const response = await (0, http_1.fetchWithRetry)(`${params.baseUrl}responses`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(buildBody(params.model, params.messages, params.tools)),
    }, { signal: params.signal, onRetry: params.onRetry });
    if (!response.ok || !response.body) {
        const detail = await safeReadText(response);
        throw new Error(`Request failed (${response.status} ${response.statusText})` +
            (detail ? `: ${detail}` : ""));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const toolsByCallId = new Map();
    let finishReason = null;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf("\n\n")) !== -1) {
                const rawEvent = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const data = extractData(rawEvent);
                if (!data || data === "[DONE]") {
                    continue;
                }
                let evt;
                try {
                    evt = JSON.parse(data);
                }
                catch {
                    continue;
                }
                // Text deltas.
                if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
                    content += evt.delta;
                    yield { type: "text", delta: evt.delta };
                }
                // A function call item was added — register it by id.
                if (evt.type === "response.output_item.added" &&
                    evt.item?.type === "function_call") {
                    const id = evt.item.call_id ?? evt.item.id ?? "";
                    toolsByCallId.set(id, {
                        name: evt.item.name ?? "",
                        args: evt.item.arguments ?? "",
                    });
                }
                // Streamed argument fragments for a function call.
                if (evt.type === "response.function_call_arguments.delta" &&
                    typeof evt.delta === "string") {
                    const id = evt.item_id ?? "";
                    const entry = toolsByCallId.get(id) ?? { name: "", args: "" };
                    entry.args += evt.delta;
                    toolsByCallId.set(id, entry);
                }
                // Completed function call (carries final name/arguments).
                if (evt.type === "response.output_item.done" &&
                    evt.item?.type === "function_call") {
                    const id = evt.item.call_id ?? evt.item.id ?? "";
                    toolsByCallId.set(id, {
                        name: evt.item.name ?? toolsByCallId.get(id)?.name ?? "",
                        args: evt.item.arguments ?? toolsByCallId.get(id)?.args ?? "",
                    });
                }
                if (evt.type === "response.completed") {
                    finishReason = "stop";
                }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
    const toolCalls = [...toolsByCallId.entries()]
        .filter(([, v]) => v.name)
        .map(([id, v]) => ({
        id: id || `call_${v.name}`,
        type: "function",
        function: { name: v.name, arguments: v.args || "{}" },
    }));
    return { content, toolCalls, finishReason };
}
function extractData(rawEvent) {
    let data;
    for (const line of rawEvent.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) {
            data = trimmed.slice("data:".length).trim();
        }
    }
    return data;
}
async function safeReadText(response) {
    try {
        return (await response.text()).slice(0, 500);
    }
    catch {
        return "";
    }
}


/***/ }),
/* 7 */
/***/ ((__unused_webpack_module, exports) => {


/**
 * A `fetch` wrapper that transparently retries transient failures — most
 * importantly HTTP 429 (rate limit) — with exponential backoff that honors the
 * server's `Retry-After` header. This lets the agent's many small requests ride
 * out short-lived rate limits instead of failing the whole turn.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fetchWithRetry = fetchWithRetry;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_BACKOFF_MS = 30_000;
async function fetchWithRetry(url, init, { retries = 5, signal, onRetry } = {}) {
    let attempt = 0;
    for (;;) {
        if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }
        let response;
        try {
            response = await fetch(url, { ...init, signal });
        }
        catch (err) {
            // Network-level error: retry unless aborted or out of attempts.
            if (signal?.aborted || attempt >= retries) {
                throw err;
            }
            const wait = backoffMs(attempt);
            onRetry?.(wait, attempt + 1);
            await sleep(wait, signal);
            attempt++;
            continue;
        }
        if (!RETRYABLE_STATUS.has(response.status) || attempt >= retries) {
            return response;
        }
        // Retryable status: wait (respecting Retry-After) and try again.
        const wait = retryAfterMs(response) ?? backoffMs(attempt);
        try {
            await response.body?.cancel();
        }
        catch {
            /* ignore */
        }
        onRetry?.(wait, attempt + 1);
        await sleep(wait, signal);
        attempt++;
    }
}
function backoffMs(attempt) {
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
    return base + Math.floor(Math.random() * 400); // jitter to avoid thundering herd
}
/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
function retryAfterMs(response) {
    const header = response.headers.get("retry-after");
    if (!header) {
        return undefined;
    }
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
        return Math.min(60_000, Math.max(0, seconds * 1000));
    }
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
        return Math.max(0, date - Date.now());
    }
    return undefined;
}
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const onAbort = () => {
            cleanup();
            reject(new DOMException("Aborted", "AbortError"));
        };
        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        };
        if (signal) {
            if (signal.aborted) {
                cleanup();
                reject(new DOMException("Aborted", "AbortError"));
                return;
            }
            signal.addEventListener("abort", onAbort);
        }
    });
}


/***/ }),
/* 8 */
/***/ ((__unused_webpack_module, exports) => {


/**
 * Agent Mode Registry — the single source of truth for agent modes. Shared by
 * both bundles: the webview shows `label`, the agent uses `id` + `allowMutations`.
 * Add a future mode here only.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DEFAULT_MODE = exports.MODES = void 0;
exports.resolveModeId = resolveModeId;
exports.getMode = getMode;
exports.MODES = [
    {
        id: "manual",
        label: "Manual Mode",
        description: "Inspect, read, search, and propose file changes for your review before applying them.",
        allowMutations: true,
        requireApproval: true,
    },
    {
        id: "auto",
        label: "Auto Edit Mode",
        description: "Inspect, read, search, create, edit, and rename files autonomously until the task is done.",
        allowMutations: true,
        requireApproval: false,
    },
    {
        id: "plan",
        label: "Plan Mode",
        description: "Analyze, inspect, read, and search — then explain the changes to make. Does not modify files.",
        allowMutations: false,
        requireApproval: false,
    },
];
exports.DEFAULT_MODE = "manual";
function resolveModeId(id) {
    if (id === "manual" || id === "normal") {
        return "manual";
    }
    return exports.MODES.some((m) => m.id === id) ? id : exports.DEFAULT_MODE;
}
function getMode(id) {
    return exports.MODES.find((m) => m.id === id) ?? exports.MODES[0];
}


/***/ }),
/* 9 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.isFileMutatingTool = isFileMutatingTool;
exports.createUnifiedDiff = createUnifiedDiff;
exports.prepareFileToolCall = prepareFileToolCall;
const vscode = __importStar(__webpack_require__(1));
const diff_1 = __webpack_require__(10);
const types_1 = __webpack_require__(29);
const editCore_1 = __webpack_require__(30);
const fsutil_1 = __webpack_require__(31);
/** Check whether a tool name is a file-modifying tool that participates in change review. */
function isFileMutatingTool(name) {
    return (name === "edit_file" ||
        name === "create_file" ||
        name === "delete_file" ||
        name === "rename_file" ||
        name === "multi_edit");
}
/** Generate a clean unified diff string and count additions and deletions. */
function createUnifiedDiff(oldPath, newPath, oldContent, newContent) {
    let patch = (0, diff_1.createTwoFilesPatch)(oldPath || "/dev/null", newPath || "/dev/null", oldContent || "", newContent || "", "", "", { context: 3 });
    // Strip leading git/diff Index lines if present
    patch = patch.replace(/^Index: [^\n]*\r?\n={10,}\r?\n/m, "").trim();
    let additions = 0;
    let deletions = 0;
    for (const line of patch.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
            additions++;
        }
        else if (line.startsWith("-") && !line.startsWith("---")) {
            deletions++;
        }
    }
    return { diff: patch, additions, deletions };
}
/**
 * In-memory preparation of a mutating tool call. Validates arguments and computes
 * the diff without modifying the actual files on disk.
 */
async function prepareFileToolCall(callId, name, args, ctx) {
    switch (name) {
        case "edit_file": {
            const rel = (0, fsutil_1.requireString)(args, "path");
            const uri = await ctx.resolvePath(rel);
            const op = (0, editCore_1.parseEditOp)(args);
            const source = await (0, editCore_1.readForEdit)(uri);
            const { content: newContent, replacements } = (0, editCore_1.applyEdits)(source, [op]);
            const relPath = ctx.toRelative(uri);
            const { diff, additions, deletions } = createUnifiedDiff(relPath, relPath, source, newContent);
            const fileChange = {
                path: relPath,
                type: "modified",
                diff,
                additions,
                deletions,
            };
            return {
                callId,
                name,
                changes: [fileChange],
                apply: async () => {
                    await (0, editCore_1.writeText)(uri, newContent);
                    return {
                        content: `Edited ${relPath} (${replacements} replacement${replacements === 1 ? "" : "s"}).`,
                        summary: `Edited ${relPath}`,
                    };
                },
                rejectionResult: () => ({
                    content: `User rejected proposed changes to ${relPath}. Workspace was not modified.`,
                    isError: true,
                    summary: `Rejected: ${relPath}`,
                }),
            };
        }
        case "create_file": {
            const rel = (0, fsutil_1.requireString)(args, "path");
            const content = typeof args.content === "string" ? args.content : "";
            const overwrite = args.overwrite === true;
            const uri = await ctx.resolvePath(rel);
            let exists = true;
            let oldContent = "";
            try {
                await vscode.workspace.fs.stat(uri);
                try {
                    oldContent = await (0, editCore_1.readForEdit)(uri);
                }
                catch {
                    // unreadable existing file
                }
            }
            catch {
                exists = false;
            }
            if (exists && !overwrite) {
                throw new types_1.ToolError(`File already exists: ${ctx.toRelative(uri)}. Pass overwrite:true or use edit_file.`);
            }
            const relPath = ctx.toRelative(uri);
            const type = exists ? "modified" : "created";
            const { diff, additions, deletions } = createUnifiedDiff(exists ? relPath : "/dev/null", relPath, oldContent, content);
            const fileChange = {
                path: relPath,
                type,
                diff,
                additions,
                deletions,
            };
            return {
                callId,
                name,
                changes: [fileChange],
                apply: async () => {
                    await vscode.workspace.fs.writeFile(uri, (0, fsutil_1.encode)(content));
                    return {
                        content: `${exists ? "Overwrote" : "Created"} ${relPath} (${content.split("\n").length} lines).`,
                        summary: `${exists ? "Overwrote" : "Created"} ${relPath}`,
                    };
                },
                rejectionResult: () => ({
                    content: `User rejected proposed creation of ${relPath}. Workspace was not modified.`,
                    isError: true,
                    summary: `Rejected: ${relPath}`,
                }),
            };
        }
        case "delete_file": {
            const rel = (0, fsutil_1.requireString)(args, "path");
            const recursive = args.recursive === true;
            const uri = await ctx.resolvePath(rel);
            let stat;
            try {
                stat = await vscode.workspace.fs.stat(uri);
            }
            catch {
                throw new types_1.ToolError(`Path does not exist: ${ctx.toRelative(uri)}`);
            }
            const isDir = (stat.type & vscode.FileType.Directory) !== 0;
            let oldContent = "";
            if (!isDir) {
                try {
                    oldContent = await (0, editCore_1.readForEdit)(uri);
                }
                catch {
                    // unreadable
                }
            }
            const relPath = ctx.toRelative(uri);
            let diff = `--- a/${relPath}\n+++ /dev/null\n@@ -1 +0,0 @@\n`;
            let deletions = 0;
            if (!isDir && oldContent) {
                const d = createUnifiedDiff(relPath, "/dev/null", oldContent, "");
                diff = d.diff;
                deletions = d.deletions;
            }
            else {
                diff = `Delete directory ${relPath}`;
            }
            const fileChange = {
                path: relPath,
                type: "deleted",
                diff,
                additions: 0,
                deletions,
            };
            return {
                callId,
                name,
                changes: [fileChange],
                apply: async () => {
                    await vscode.workspace.fs.delete(uri, {
                        recursive: isDir ? recursive || true : false,
                        useTrash: true,
                    });
                    return {
                        content: `Deleted ${relPath}.`,
                        summary: `Deleted ${relPath}`,
                    };
                },
                rejectionResult: () => ({
                    content: `User rejected proposed deletion of ${relPath}. Workspace was not modified.`,
                    isError: true,
                    summary: `Rejected deletion: ${relPath}`,
                }),
            };
        }
        case "rename_file": {
            const fromRel = (0, fsutil_1.requireString)(args, "from");
            const toRel = (0, fsutil_1.requireString)(args, "to");
            const overwrite = args.overwrite === true;
            const from = await ctx.resolvePath(fromRel);
            const to = await ctx.resolvePath(toRel);
            try {
                await vscode.workspace.fs.stat(from);
            }
            catch {
                throw new types_1.ToolError(`Source does not exist: ${ctx.toRelative(from)}`);
            }
            const oldPath = ctx.toRelative(from);
            const newPath = ctx.toRelative(to);
            const fileChange = {
                path: newPath,
                oldPath,
                type: "renamed",
                diff: `Rename ${oldPath} → ${newPath}`,
                additions: 0,
                deletions: 0,
            };
            return {
                callId,
                name,
                changes: [fileChange],
                apply: async () => {
                    await vscode.workspace.fs.rename(from, to, { overwrite });
                    return {
                        content: `Renamed ${oldPath} → ${newPath}.`,
                        summary: `Renamed → ${newPath}`,
                    };
                },
                rejectionResult: () => ({
                    content: `User rejected proposed rename of ${oldPath} to ${newPath}. Workspace was not modified.`,
                    isError: true,
                    summary: `Rejected rename: ${oldPath}`,
                }),
            };
        }
        case "multi_edit": {
            const files = args.files;
            if (!Array.isArray(files) || files.length === 0) {
                throw new types_1.ToolError("multi_edit requires a non-empty 'files' array.");
            }
            const fileEdits = [];
            for (const entry of files) {
                if (!entry || typeof entry !== "object") {
                    throw new types_1.ToolError("Skipped an invalid file entry (not an object).");
                }
                const rec = entry;
                const path = rec.path;
                const rawEdits = rec.edits;
                if (typeof path !== "string" || !path) {
                    throw new types_1.ToolError("File entry with a missing 'path'.");
                }
                if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
                    throw new types_1.ToolError(`${path}: no edits provided.`);
                }
                const uri = await ctx.resolvePath(path);
                const ops = rawEdits.map(editCore_1.parseEditOp);
                const source = await (0, editCore_1.readForEdit)(uri);
                const { content: newContent, replacements } = (0, editCore_1.applyEdits)(source, ops);
                const relPath = ctx.toRelative(uri);
                const { diff, additions, deletions } = createUnifiedDiff(relPath, relPath, source, newContent);
                fileEdits.push({
                    uri,
                    relPath,
                    newContent,
                    replacements,
                    change: {
                        path: relPath,
                        type: "modified",
                        diff,
                        additions,
                        deletions,
                    },
                });
            }
            return {
                callId,
                name,
                changes: fileEdits.map((fe) => fe.change),
                apply: async () => {
                    const applied = [];
                    for (const fe of fileEdits) {
                        await (0, editCore_1.writeText)(fe.uri, fe.newContent);
                        applied.push(`${fe.relPath} (${fe.replacements} change${fe.replacements === 1 ? "" : "s"})`);
                    }
                    return {
                        content: `Applied edits to ${applied.length} file(s):\n- ${applied.join("\n- ")}`,
                        summary: `${applied.length} file(s) edited`,
                    };
                },
                rejectionResult: () => ({
                    content: `User rejected proposed multi-file edits across ${fileEdits.length} file(s). Workspace was not modified.`,
                    isError: true,
                    summary: `Rejected edits: ${fileEdits.length} files`,
                }),
            };
        }
        default:
            return null;
    }
}


/***/ }),
/* 10 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


/* See LICENSE file for terms of use */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.canonicalize = exports.convertChangesToXML = exports.convertChangesToDMP = exports.reversePatch = exports.parsePatch = exports.applyPatches = exports.applyPatch = exports.OMIT_HEADERS = exports.FILE_HEADERS_ONLY = exports.INCLUDE_HEADERS = exports.formatPatch = exports.createPatch = exports.createTwoFilesPatch = exports.structuredPatch = exports.arrayDiff = exports.diffArrays = exports.jsonDiff = exports.diffJson = exports.cssDiff = exports.diffCss = exports.sentenceDiff = exports.diffSentences = exports.diffTrimmedLines = exports.lineDiff = exports.diffLines = exports.wordsWithSpaceDiff = exports.diffWordsWithSpace = exports.wordDiff = exports.diffWords = exports.characterDiff = exports.diffChars = exports.Diff = void 0;
/*
 * Text diff implementation.
 *
 * This library supports the following APIs:
 * Diff.diffChars: Character by character diff
 * Diff.diffWords: Word (as defined by \b regex) diff which ignores whitespace
 * Diff.diffLines: Line based diff
 *
 * Diff.diffCss: Diff targeted at CSS content
 *
 * These methods are based on the implementation proposed in
 * "An O(ND) Difference Algorithm and its Variations" (Myers, 1986).
 * http://citeseerx.ist.psu.edu/viewdoc/summary?doi=10.1.1.4.6927
 */
var base_js_1 = __webpack_require__(11);
exports.Diff = base_js_1.default;
var character_js_1 = __webpack_require__(12);
Object.defineProperty(exports, "diffChars", ({ enumerable: true, get: function () { return character_js_1.diffChars; } }));
Object.defineProperty(exports, "characterDiff", ({ enumerable: true, get: function () { return character_js_1.characterDiff; } }));
var word_js_1 = __webpack_require__(13);
Object.defineProperty(exports, "diffWords", ({ enumerable: true, get: function () { return word_js_1.diffWords; } }));
Object.defineProperty(exports, "diffWordsWithSpace", ({ enumerable: true, get: function () { return word_js_1.diffWordsWithSpace; } }));
Object.defineProperty(exports, "wordDiff", ({ enumerable: true, get: function () { return word_js_1.wordDiff; } }));
Object.defineProperty(exports, "wordsWithSpaceDiff", ({ enumerable: true, get: function () { return word_js_1.wordsWithSpaceDiff; } }));
var line_js_1 = __webpack_require__(15);
Object.defineProperty(exports, "diffLines", ({ enumerable: true, get: function () { return line_js_1.diffLines; } }));
Object.defineProperty(exports, "diffTrimmedLines", ({ enumerable: true, get: function () { return line_js_1.diffTrimmedLines; } }));
Object.defineProperty(exports, "lineDiff", ({ enumerable: true, get: function () { return line_js_1.lineDiff; } }));
var sentence_js_1 = __webpack_require__(17);
Object.defineProperty(exports, "diffSentences", ({ enumerable: true, get: function () { return sentence_js_1.diffSentences; } }));
Object.defineProperty(exports, "sentenceDiff", ({ enumerable: true, get: function () { return sentence_js_1.sentenceDiff; } }));
var css_js_1 = __webpack_require__(18);
Object.defineProperty(exports, "diffCss", ({ enumerable: true, get: function () { return css_js_1.diffCss; } }));
Object.defineProperty(exports, "cssDiff", ({ enumerable: true, get: function () { return css_js_1.cssDiff; } }));
var json_js_1 = __webpack_require__(19);
Object.defineProperty(exports, "diffJson", ({ enumerable: true, get: function () { return json_js_1.diffJson; } }));
Object.defineProperty(exports, "canonicalize", ({ enumerable: true, get: function () { return json_js_1.canonicalize; } }));
Object.defineProperty(exports, "jsonDiff", ({ enumerable: true, get: function () { return json_js_1.jsonDiff; } }));
var array_js_1 = __webpack_require__(20);
Object.defineProperty(exports, "diffArrays", ({ enumerable: true, get: function () { return array_js_1.diffArrays; } }));
Object.defineProperty(exports, "arrayDiff", ({ enumerable: true, get: function () { return array_js_1.arrayDiff; } }));
var apply_js_1 = __webpack_require__(21);
Object.defineProperty(exports, "applyPatch", ({ enumerable: true, get: function () { return apply_js_1.applyPatch; } }));
Object.defineProperty(exports, "applyPatches", ({ enumerable: true, get: function () { return apply_js_1.applyPatches; } }));
var parse_js_1 = __webpack_require__(23);
Object.defineProperty(exports, "parsePatch", ({ enumerable: true, get: function () { return parse_js_1.parsePatch; } }));
var reverse_js_1 = __webpack_require__(25);
Object.defineProperty(exports, "reversePatch", ({ enumerable: true, get: function () { return reverse_js_1.reversePatch; } }));
var create_js_1 = __webpack_require__(26);
Object.defineProperty(exports, "structuredPatch", ({ enumerable: true, get: function () { return create_js_1.structuredPatch; } }));
Object.defineProperty(exports, "createTwoFilesPatch", ({ enumerable: true, get: function () { return create_js_1.createTwoFilesPatch; } }));
Object.defineProperty(exports, "createPatch", ({ enumerable: true, get: function () { return create_js_1.createPatch; } }));
Object.defineProperty(exports, "formatPatch", ({ enumerable: true, get: function () { return create_js_1.formatPatch; } }));
Object.defineProperty(exports, "INCLUDE_HEADERS", ({ enumerable: true, get: function () { return create_js_1.INCLUDE_HEADERS; } }));
Object.defineProperty(exports, "FILE_HEADERS_ONLY", ({ enumerable: true, get: function () { return create_js_1.FILE_HEADERS_ONLY; } }));
Object.defineProperty(exports, "OMIT_HEADERS", ({ enumerable: true, get: function () { return create_js_1.OMIT_HEADERS; } }));
var dmp_js_1 = __webpack_require__(27);
Object.defineProperty(exports, "convertChangesToDMP", ({ enumerable: true, get: function () { return dmp_js_1.convertChangesToDMP; } }));
var xml_js_1 = __webpack_require__(28);
Object.defineProperty(exports, "convertChangesToXML", ({ enumerable: true, get: function () { return xml_js_1.convertChangesToXML; } }));


/***/ }),
/* 11 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
var Diff = /** @class */ (function () {
    function Diff() {
    }
    Diff.prototype.diff = function (oldStr, newStr, 
    // Type below is not accurate/complete - see above for full possibilities - but it compiles
    options) {
        if (options === void 0) { options = {}; }
        var callback;
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        else if ('callback' in options) {
            callback = options.callback;
        }
        // Allow subclasses to massage the input prior to running
        var oldString = this.castInput(oldStr, options);
        var newString = this.castInput(newStr, options);
        var oldTokens = this.removeEmpty(this.tokenize(oldString, options));
        var newTokens = this.removeEmpty(this.tokenize(newString, options));
        return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
    };
    Diff.prototype.diffWithOptionsObj = function (oldTokens, newTokens, options, callback) {
        var _this = this;
        var _a;
        var done = function (value) {
            value = _this.postProcess(value, options);
            if (callback) {
                setTimeout(function () { callback(value); }, 0);
                return undefined;
            }
            else {
                return value;
            }
        };
        var newLen = newTokens.length, oldLen = oldTokens.length;
        var editLength = 1;
        var maxEditLength = newLen + oldLen;
        if (options.maxEditLength != null) {
            maxEditLength = Math.min(maxEditLength, options.maxEditLength);
        }
        var maxExecutionTime = (_a = options.timeout) !== null && _a !== void 0 ? _a : Infinity;
        var abortAfterTimestamp = Date.now() + maxExecutionTime;
        var bestPath = [{ oldPos: -1, lastComponent: undefined }];
        // Seed editLength = 0, i.e. the content starts with the same values
        var newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
        if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
            // Identity per the equality and tokenizer
            return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
        }
        // Once we hit the right edge of the edit graph on some diagonal k, we can
        // definitely reach the end of the edit graph in no more than k edits, so
        // there's no point in considering any moves to diagonal k+1 any more (from
        // which we're guaranteed to need at least k+1 more edits).
        // Similarly, once we've reached the bottom of the edit graph, there's no
        // point considering moves to lower diagonals.
        // We record this fact by setting minDiagonalToConsider and
        // maxDiagonalToConsider to some finite value once we've hit the edge of
        // the edit graph.
        // This optimization is not faithful to the original algorithm presented in
        // Myers's paper, which instead pointlessly extends D-paths off the end of
        // the edit graph - see page 7 of Myers's paper which notes this point
        // explicitly and illustrates it with a diagram. This has major performance
        // implications for some common scenarios. For instance, to compute a diff
        // where the new text simply appends d characters on the end of the
        // original text of length n, the true Myers algorithm will take O(n+d^2)
        // time while this optimization needs only O(n+d) time.
        var minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
        // Main worker method. checks all permutations of a given edit length for acceptance.
        var execEditLength = function () {
            for (var diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
                var basePath = void 0;
                var removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
                if (removePath) {
                    // No one else is going to attempt to use this value, clear it
                    // @ts-expect-error - perf optimisation. This type-violating value will never be read.
                    bestPath[diagonalPath - 1] = undefined;
                }
                var canAdd = false;
                if (addPath) {
                    // what newPos will be after we do an insertion:
                    var addPathNewPos = addPath.oldPos - diagonalPath;
                    canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
                }
                var canRemove = removePath && removePath.oldPos + 1 < oldLen;
                if (!canAdd && !canRemove) {
                    // If this path is a terminal then prune
                    // @ts-expect-error - perf optimisation. This type-violating value will never be read.
                    bestPath[diagonalPath] = undefined;
                    continue;
                }
                // Select the diagonal that we want to branch from. We select the prior
                // path whose position in the old string is the farthest from the origin
                // and does not pass the bounds of the diff graph
                if (!canRemove || (canAdd && removePath.oldPos < addPath.oldPos)) {
                    basePath = _this.addToPath(addPath, true, false, 0, options);
                }
                else {
                    basePath = _this.addToPath(removePath, false, true, 1, options);
                }
                newPos = _this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
                if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
                    // If we have hit the end of both strings, then we are done
                    return done(_this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
                }
                else {
                    bestPath[diagonalPath] = basePath;
                    if (basePath.oldPos + 1 >= oldLen) {
                        maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
                    }
                    if (newPos + 1 >= newLen) {
                        minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
                    }
                }
            }
            editLength++;
        };
        // Performs the length of edit iteration. Is a bit fugly as this has to support the
        // sync and async mode which is never fun. Loops over execEditLength until a value
        // is produced, or until the edit length exceeds options.maxEditLength (if given),
        // in which case it will return undefined.
        if (callback) {
            (function exec() {
                setTimeout(function () {
                    if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
                        return callback(undefined);
                    }
                    if (!execEditLength()) {
                        exec();
                    }
                }, 0);
            }());
        }
        else {
            while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
                var ret = execEditLength();
                if (ret) {
                    return ret;
                }
            }
        }
    };
    Diff.prototype.addToPath = function (path, added, removed, oldPosInc, options) {
        var last = path.lastComponent;
        if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
            return {
                oldPos: path.oldPos + oldPosInc,
                lastComponent: { count: last.count + 1, added: added, removed: removed, previousComponent: last.previousComponent }
            };
        }
        else {
            return {
                oldPos: path.oldPos + oldPosInc,
                lastComponent: { count: 1, added: added, removed: removed, previousComponent: last }
            };
        }
    };
    Diff.prototype.extractCommon = function (basePath, newTokens, oldTokens, diagonalPath, options) {
        var newLen = newTokens.length, oldLen = oldTokens.length;
        var oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
        while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
            newPos++;
            oldPos++;
            commonCount++;
            if (options.oneChangePerToken) {
                basePath.lastComponent = { count: 1, previousComponent: basePath.lastComponent, added: false, removed: false };
            }
        }
        if (commonCount && !options.oneChangePerToken) {
            basePath.lastComponent = { count: commonCount, previousComponent: basePath.lastComponent, added: false, removed: false };
        }
        basePath.oldPos = oldPos;
        return newPos;
    };
    Diff.prototype.equals = function (left, right, options) {
        if (options.comparator) {
            return options.comparator(left, right);
        }
        else {
            return left === right
                || (!!options.ignoreCase && left.toLowerCase() === right.toLowerCase());
        }
    };
    Diff.prototype.removeEmpty = function (array) {
        var ret = [];
        for (var i = 0; i < array.length; i++) {
            if (array[i]) {
                ret.push(array[i]);
            }
        }
        return ret;
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Diff.prototype.castInput = function (value, options) {
        return value;
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Diff.prototype.tokenize = function (value, options) {
        return Array.from(value);
    };
    Diff.prototype.join = function (chars) {
        // Assumes ValueT is string, which is the case for most subclasses.
        // When it's false, e.g. in diffArrays, this method needs to be overridden (e.g. with a no-op)
        // Yes, the casts are verbose and ugly, because this pattern - of having the base class SORT OF
        // assume tokens and values are strings, but not completely - is weird and janky.
        return chars.join('');
    };
    Diff.prototype.postProcess = function (changeObjects, 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options) {
        return changeObjects;
    };
    Object.defineProperty(Diff.prototype, "useLongestToken", {
        get: function () {
            return false;
        },
        enumerable: false,
        configurable: true
    });
    Diff.prototype.buildValues = function (lastComponent, newTokens, oldTokens) {
        // First we convert our linked list of components in reverse order to an
        // array in the right order:
        var components = [];
        var nextComponent;
        while (lastComponent) {
            components.push(lastComponent);
            nextComponent = lastComponent.previousComponent;
            delete lastComponent.previousComponent;
            lastComponent = nextComponent;
        }
        components.reverse();
        var componentLen = components.length;
        var componentPos = 0, newPos = 0, oldPos = 0;
        for (; componentPos < componentLen; componentPos++) {
            var component = components[componentPos];
            if (!component.removed) {
                if (!component.added && this.useLongestToken) {
                    var value = newTokens.slice(newPos, newPos + component.count);
                    value = value.map(function (value, i) {
                        var oldValue = oldTokens[oldPos + i];
                        return oldValue.length > value.length ? oldValue : value;
                    });
                    component.value = this.join(value);
                }
                else {
                    component.value = this.join(newTokens.slice(newPos, newPos + component.count));
                }
                newPos += component.count;
                // Common case
                if (!component.added) {
                    oldPos += component.count;
                }
            }
            else {
                component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
                oldPos += component.count;
            }
        }
        return components;
    };
    return Diff;
}());
exports["default"] = Diff;


/***/ }),
/* 12 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.characterDiff = void 0;
exports.diffChars = diffChars;
var base_js_1 = __webpack_require__(11);
var CharacterDiff = /** @class */ (function (_super) {
    __extends(CharacterDiff, _super);
    function CharacterDiff() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    return CharacterDiff;
}(base_js_1.default));
exports.characterDiff = new CharacterDiff();
function diffChars(oldStr, newStr, options) {
    return exports.characterDiff.diff(oldStr, newStr, options);
}


/***/ }),
/* 13 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.wordsWithSpaceDiff = exports.wordDiff = void 0;
exports.diffWords = diffWords;
exports.diffWordsWithSpace = diffWordsWithSpace;
var base_js_1 = __webpack_require__(11);
var string_js_1 = __webpack_require__(14);
// Based on https://en.wikipedia.org/wiki/Latin_script_in_Unicode
//
// Chars/ranges counted as "word" characters by this regex are as follows:
//
// + U+00AD  Soft hyphen
// + 00C0–00FF (letters with diacritics from the Latin-1 Supplement), except:
//   - U+00D7  × Multiplication sign
//   - U+00F7  ÷ Division sign
// + Latin Extended-A, 0100–017F
// + Latin Extended-B, 0180–024F
// + IPA Extensions, 0250–02AF
// + Spacing Modifier Letters, 02B0–02FF, except:
//   - U+02C7  ˇ &#711;  Caron
//   - U+02D8  ˘ &#728;  Breve
//   - U+02D9  ˙ &#729;  Dot Above
//   - U+02DA  ˚ &#730;  Ring Above
//   - U+02DB  ˛ &#731;  Ogonek
//   - U+02DC  ˜ &#732;  Small Tilde
//   - U+02DD  ˝ &#733;  Double Acute Accent
// + Latin Extended Additional, 1E00–1EFF
var extendedWordChars = 'a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}';
// Each token is one of the following:
// - A punctuation mark plus the surrounding whitespace
// - A word plus the surrounding whitespace
// - Pure whitespace (but only in the special case where the entire text
//   is just whitespace)
//
// We have to include surrounding whitespace in the tokens because the two
// alternative approaches produce horribly broken results:
// * If we just discard the whitespace, we can't fully reproduce the original
//   text from the sequence of tokens and any attempt to render the diff will
//   get the whitespace wrong.
// * If we have separate tokens for whitespace, then in a typical text every
//   second token will be a single space character. But this often results in
//   the optimal diff between two texts being a perverse one that preserves
//   the spaces between words but deletes and reinserts actual common words.
//   See https://github.com/kpdecker/jsdiff/issues/160#issuecomment-1866099640
//   for an example.
//
// Keeping the surrounding whitespace of course has implications for .equals
// and .join, not just .tokenize.
// This regex does NOT fully implement the tokenization rules described above.
// Instead, it gives runs of whitespace their own "token". The tokenize method
// then handles stitching whitespace tokens onto adjacent word or punctuation
// tokens.
var tokenizeIncludingWhitespace = new RegExp("[".concat(extendedWordChars, "]+|\\s+|[^").concat(extendedWordChars, "]"), 'ug');
var WordDiff = /** @class */ (function (_super) {
    __extends(WordDiff, _super);
    function WordDiff() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    WordDiff.prototype.equals = function (left, right, options) {
        if (options.ignoreCase) {
            left = left.toLowerCase();
            right = right.toLowerCase();
        }
        return left.trim() === right.trim();
    };
    WordDiff.prototype.tokenize = function (value, options) {
        if (options === void 0) { options = {}; }
        var parts;
        if (options.intlSegmenter) {
            var segmenter = options.intlSegmenter;
            if (segmenter.resolvedOptions().granularity != 'word') {
                throw new Error('The segmenter passed must have a granularity of "word"');
            }
            // We want `parts` to be an array whose elements alternate between being
            // pure whitespace and being pure non-whitespace. This is ALMOST what the
            // segments returned by a word-based Intl.Segmenter already look like,
            // but not quite - see explanation in the docs of our custom segment()
            // function.
            parts = (0, string_js_1.segment)(value, segmenter);
        }
        else {
            parts = value.match(tokenizeIncludingWhitespace) || [];
        }
        var tokens = [];
        var prevPart = null;
        parts.forEach(function (part) {
            if ((/\s/).test(part)) {
                if (prevPart == null) {
                    tokens.push(part);
                }
                else {
                    tokens.push(tokens.pop() + part);
                }
            }
            else if (prevPart != null && (/\s/).test(prevPart)) {
                if (tokens[tokens.length - 1] == prevPart) {
                    tokens.push(tokens.pop() + part);
                }
                else {
                    tokens.push(prevPart + part);
                }
            }
            else {
                tokens.push(part);
            }
            prevPart = part;
        });
        return tokens;
    };
    WordDiff.prototype.join = function (tokens) {
        // Tokens being joined here will always have appeared consecutively in the
        // same text, so we can simply strip off the leading whitespace from all the
        // tokens except the first (and except any whitespace-only tokens - but such
        // a token will always be the first and only token anyway) and then join them
        // and the whitespace around words and punctuation will end up correct.
        return tokens.map(function (token, i) {
            if (i == 0) {
                return token;
            }
            else {
                return token.replace((/^\s+/), '');
            }
        }).join('');
    };
    WordDiff.prototype.postProcess = function (changes, options) {
        if (!changes || options.oneChangePerToken) {
            return changes;
        }
        var lastKeep = null;
        // Change objects representing any insertion or deletion since the last
        // "keep" change object. There can be at most one of each.
        var insertion = null;
        var deletion = null;
        changes.forEach(function (change) {
            if (change.added) {
                insertion = change;
            }
            else if (change.removed) {
                deletion = change;
            }
            else {
                if (insertion || deletion) { // May be false at start of text
                    dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change, options.intlSegmenter);
                }
                lastKeep = change;
                insertion = null;
                deletion = null;
            }
        });
        if (insertion || deletion) {
            dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null, options.intlSegmenter);
        }
        return changes;
    };
    return WordDiff;
}(base_js_1.default));
exports.wordDiff = new WordDiff();
function diffWords(oldStr, newStr, options) {
    // This option has never been documented and never will be (it's clearer to
    // just call `diffWordsWithSpace` directly if you need that behavior), but
    // has existed in jsdiff for a long time, so we retain support for it here
    // for the sake of backwards compatibility.
    if ((options === null || options === void 0 ? void 0 : options.ignoreWhitespace) != null && !options.ignoreWhitespace) {
        return diffWordsWithSpace(oldStr, newStr, options);
    }
    return exports.wordDiff.diff(oldStr, newStr, options);
}
function dedupeWhitespaceInChangeObjects(startKeep, deletion, insertion, endKeep, segmenter) {
    // Before returning, we tidy up the leading and trailing whitespace of the
    // change objects to eliminate cases where trailing whitespace in one object
    // is repeated as leading whitespace in the next.
    // Below are examples of the outcomes we want here to explain the code.
    // I=insert, K=keep, D=delete
    // 1. diffing 'foo bar baz' vs 'foo baz'
    //    Prior to cleanup, we have K:'foo ' D:' bar ' K:' baz'
    //    After cleanup, we want:   K:'foo ' D:'bar ' K:'baz'
    //
    // 2. Diffing 'foo bar baz' vs 'foo qux baz'
    //    Prior to cleanup, we have K:'foo ' D:' bar ' I:' qux ' K:' baz'
    //    After cleanup, we want K:'foo ' D:'bar' I:'qux' K:' baz'
    //
    // 3. Diffing 'foo\nbar baz' vs 'foo baz'
    //    Prior to cleanup, we have K:'foo ' D:'\nbar ' K:' baz'
    //    After cleanup, we want K'foo' D:'\nbar' K:' baz'
    //
    // 4. Diffing 'foo baz' vs 'foo\nbar baz'
    //    Prior to cleanup, we have K:'foo\n' I:'\nbar ' K:' baz'
    //    After cleanup, we ideally want K'foo' I:'\nbar' K:' baz'
    //    but don't actually manage this currently (the pre-cleanup change
    //    objects don't contain enough information to make it possible).
    //
    // 5. Diffing 'foo   bar baz' vs 'foo  baz'
    //    Prior to cleanup, we have K:'foo  ' D:'   bar ' K:'  baz'
    //    After cleanup, we want K:'foo  ' D:' bar ' K:'baz'
    //
    // Our handling is unavoidably imperfect in the case where there's a single
    // indel between keeps and the whitespace has changed. For instance, consider
    // diffing 'foo\tbar\nbaz' vs 'foo baz'. Unless we create an extra change
    // object to represent the insertion of the space character (which isn't even
    // a token), we have no way to avoid losing information about the texts'
    // original whitespace in the result we return. Still, we do our best to
    // output something that will look sensible if we e.g. print it with
    // insertions in green and deletions in red.
    // Between two "keep" change objects (or before the first or after the last
    // change object), we can have either:
    // * A "delete" followed by an "insert"
    // * Just an "insert"
    // * Just a "delete"
    // We handle the three cases separately.
    if (deletion && insertion) {
        var _a = (0, string_js_1.leadingAndTrailingWs)(deletion.value, segmenter), oldWsPrefix = _a[0], oldWsSuffix = _a[1];
        var _b = (0, string_js_1.leadingAndTrailingWs)(insertion.value, segmenter), newWsPrefix = _b[0], newWsSuffix = _b[1];
        if (startKeep) {
            var commonWsPrefix = (0, string_js_1.longestCommonPrefix)(oldWsPrefix, newWsPrefix);
            startKeep.value = (0, string_js_1.replaceSuffix)(startKeep.value, newWsPrefix, commonWsPrefix);
            deletion.value = (0, string_js_1.removePrefix)(deletion.value, commonWsPrefix);
            insertion.value = (0, string_js_1.removePrefix)(insertion.value, commonWsPrefix);
        }
        if (endKeep) {
            var commonWsSuffix = (0, string_js_1.longestCommonSuffix)(oldWsSuffix, newWsSuffix);
            endKeep.value = (0, string_js_1.replacePrefix)(endKeep.value, newWsSuffix, commonWsSuffix);
            deletion.value = (0, string_js_1.removeSuffix)(deletion.value, commonWsSuffix);
            insertion.value = (0, string_js_1.removeSuffix)(insertion.value, commonWsSuffix);
        }
    }
    else if (insertion) {
        // The whitespaces all reflect what was in the new text rather than
        // the old, so we essentially have no information about whitespace
        // insertion or deletion. We just want to dedupe the whitespace.
        // We do that by having each change object keep its trailing
        // whitespace and deleting duplicate leading whitespace where
        // present.
        if (startKeep) {
            var ws = (0, string_js_1.leadingWs)(insertion.value, segmenter);
            insertion.value = insertion.value.substring(ws.length);
        }
        if (endKeep) {
            var ws = (0, string_js_1.leadingWs)(endKeep.value, segmenter);
            endKeep.value = endKeep.value.substring(ws.length);
        }
        // otherwise we've got a deletion and no insertion
    }
    else if (startKeep && endKeep) {
        var newWsFull = (0, string_js_1.leadingWs)(endKeep.value, segmenter), _c = (0, string_js_1.leadingAndTrailingWs)(deletion.value, segmenter), delWsStart = _c[0], delWsEnd = _c[1];
        // Any whitespace that comes straight after startKeep in both the old and
        // new texts, assign to startKeep and remove from the deletion.
        var newWsStart = (0, string_js_1.longestCommonPrefix)(newWsFull, delWsStart);
        deletion.value = (0, string_js_1.removePrefix)(deletion.value, newWsStart);
        // Any whitespace that comes straight before endKeep in both the old and
        // new texts, and hasn't already been assigned to startKeep, assign to
        // endKeep and remove from the deletion.
        var newWsEnd = (0, string_js_1.longestCommonSuffix)((0, string_js_1.removePrefix)(newWsFull, newWsStart), delWsEnd);
        deletion.value = (0, string_js_1.removeSuffix)(deletion.value, newWsEnd);
        endKeep.value = (0, string_js_1.replacePrefix)(endKeep.value, newWsFull, newWsEnd);
        // If there's any whitespace from the new text that HASN'T already been
        // assigned, assign it to the start:
        startKeep.value = (0, string_js_1.replaceSuffix)(startKeep.value, newWsFull, newWsFull.slice(0, newWsFull.length - newWsEnd.length));
    }
    else if (endKeep) {
        // We are at the start of the text. Preserve all the whitespace on
        // endKeep, and just remove whitespace from the end of deletion to the
        // extent that it overlaps with the start of endKeep.
        var endKeepWsPrefix = (0, string_js_1.leadingWs)(endKeep.value, segmenter);
        var deletionWsSuffix = (0, string_js_1.trailingWs)(deletion.value, segmenter);
        var overlap = (0, string_js_1.maximumOverlap)(deletionWsSuffix, endKeepWsPrefix);
        deletion.value = (0, string_js_1.removeSuffix)(deletion.value, overlap);
    }
    else if (startKeep) {
        // We are at the END of the text. Preserve all the whitespace on
        // startKeep, and just remove whitespace from the start of deletion to
        // the extent that it overlaps with the end of startKeep.
        var startKeepWsSuffix = (0, string_js_1.trailingWs)(startKeep.value, segmenter);
        var deletionWsPrefix = (0, string_js_1.leadingWs)(deletion.value, segmenter);
        var overlap = (0, string_js_1.maximumOverlap)(startKeepWsSuffix, deletionWsPrefix);
        deletion.value = (0, string_js_1.removePrefix)(deletion.value, overlap);
    }
}
var WordsWithSpaceDiff = /** @class */ (function (_super) {
    __extends(WordsWithSpaceDiff, _super);
    function WordsWithSpaceDiff() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    WordsWithSpaceDiff.prototype.tokenize = function (value) {
        // Slightly different to the tokenizeIncludingWhitespace regex used above in
        // that this one treats each individual newline as a distinct token, rather
        // than merging them into other surrounding whitespace. This was requested
        // in https://github.com/kpdecker/jsdiff/issues/180 &
        //    https://github.com/kpdecker/jsdiff/issues/211
        var regex = new RegExp("(\\r?\\n)|[".concat(extendedWordChars, "]+|[^\\S\\n\\r]+|[^").concat(extendedWordChars, "]"), 'ug');
        return value.match(regex) || [];
    };
    return WordsWithSpaceDiff;
}(base_js_1.default));
exports.wordsWithSpaceDiff = new WordsWithSpaceDiff();
function diffWordsWithSpace(oldStr, newStr, options) {
    return exports.wordsWithSpaceDiff.diff(oldStr, newStr, options);
}


/***/ }),
/* 14 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.longestCommonPrefix = longestCommonPrefix;
exports.longestCommonSuffix = longestCommonSuffix;
exports.replacePrefix = replacePrefix;
exports.replaceSuffix = replaceSuffix;
exports.removePrefix = removePrefix;
exports.removeSuffix = removeSuffix;
exports.maximumOverlap = maximumOverlap;
exports.hasOnlyWinLineEndings = hasOnlyWinLineEndings;
exports.hasOnlyUnixLineEndings = hasOnlyUnixLineEndings;
exports.segment = segment;
exports.trailingWs = trailingWs;
exports.leadingWs = leadingWs;
exports.leadingAndTrailingWs = leadingAndTrailingWs;
function longestCommonPrefix(str1, str2) {
    var i;
    for (i = 0; i < str1.length && i < str2.length; i++) {
        if (str1[i] != str2[i]) {
            return str1.slice(0, i);
        }
    }
    return str1.slice(0, i);
}
function longestCommonSuffix(str1, str2) {
    var i;
    // Unlike longestCommonPrefix, we need a special case to handle all scenarios
    // where we return the empty string since str1.slice(-0) will return the
    // entire string.
    if (!str1 || !str2 || str1[str1.length - 1] != str2[str2.length - 1]) {
        return '';
    }
    for (i = 0; i < str1.length && i < str2.length; i++) {
        if (str1[str1.length - (i + 1)] != str2[str2.length - (i + 1)]) {
            return str1.slice(-i);
        }
    }
    return str1.slice(-i);
}
function replacePrefix(string, oldPrefix, newPrefix) {
    if (string.slice(0, oldPrefix.length) != oldPrefix) {
        throw Error("string ".concat(JSON.stringify(string), " doesn't start with prefix ").concat(JSON.stringify(oldPrefix), "; this is a bug"));
    }
    return newPrefix + string.slice(oldPrefix.length);
}
function replaceSuffix(string, oldSuffix, newSuffix) {
    if (!oldSuffix) {
        return string + newSuffix;
    }
    if (string.slice(-oldSuffix.length) != oldSuffix) {
        throw Error("string ".concat(JSON.stringify(string), " doesn't end with suffix ").concat(JSON.stringify(oldSuffix), "; this is a bug"));
    }
    return string.slice(0, -oldSuffix.length) + newSuffix;
}
function removePrefix(string, oldPrefix) {
    return replacePrefix(string, oldPrefix, '');
}
function removeSuffix(string, oldSuffix) {
    return replaceSuffix(string, oldSuffix, '');
}
function maximumOverlap(string1, string2) {
    return string2.slice(0, overlapCount(string1, string2));
}
// Nicked from https://stackoverflow.com/a/60422853/1709587
function overlapCount(a, b) {
    // Deal with cases where the strings differ in length
    var startA = 0;
    if (a.length > b.length) {
        startA = a.length - b.length;
    }
    var endB = b.length;
    if (a.length < b.length) {
        endB = a.length;
    }
    // Create a back-reference for each index
    //   that should be followed in case of a mismatch.
    //   We only need B to make these references:
    var map = Array(endB);
    var k = 0; // Index that lags behind j
    map[0] = 0;
    for (var j = 1; j < endB; j++) {
        if (b[j] == b[k]) {
            map[j] = map[k]; // skip over the same character (optional optimisation)
        }
        else {
            map[j] = k;
        }
        while (k > 0 && b[j] != b[k]) {
            k = map[k];
        }
        if (b[j] == b[k]) {
            k++;
        }
    }
    // Phase 2: use these references while iterating over A
    k = 0;
    for (var i = startA; i < a.length; i++) {
        while (k > 0 && a[i] != b[k]) {
            k = map[k];
        }
        if (a[i] == b[k]) {
            k++;
        }
    }
    return k;
}
/**
 * Returns true if the string consistently uses Windows line endings.
 */
function hasOnlyWinLineEndings(string) {
    return string.includes('\r\n') && !string.startsWith('\n') && !string.match(/[^\r]\n/);
}
/**
 * Returns true if the string consistently uses Unix line endings.
 */
function hasOnlyUnixLineEndings(string) {
    return !string.includes('\r\n') && string.includes('\n');
}
/**
 * Split a string into segments using a word segmenter, merging consecutive
 * segments if they are both whitespace segments. Whitespace segments can
 * appear adjacent to one another for two reasons:
 * - newlines always get their own segment
 * - where a diacritic is attached to a whitespace character in the text, the
 *   segment ends after the diacritic, so e.g. " \u0300 " becomes two segments.
 * This function therefore runs the segmenter's .segment() method and then
 * merges consecutive segments of whitespace into a single part.
 */
function segment(string, segmenter) {
    var parts = [];
    for (var _i = 0, _a = Array.from(segmenter.segment(string)); _i < _a.length; _i++) {
        var segmentObj = _a[_i];
        var segment_1 = segmentObj.segment;
        if (parts.length && (/\s/).test(parts[parts.length - 1]) && (/\s/).test(segment_1)) {
            parts[parts.length - 1] += segment_1;
        }
        else {
            parts.push(segment_1);
        }
    }
    return parts;
}
// The functions below take a `segmenter` argument so that, when called from
// diffWords when it is using a segmenter, they can use a notion of what
// constitutes "whitespace" that is consistent with the segmenter.
//
// USUALLY this will be identical to the result of the non-segmenter-based
// logic, but it differs in at least one case: when whitespace characters are
// modified by diacritics. A word segmenter considers these diacritics to be
// part of the whitespace, whereas our non-segmenter-based logic does not.
//
// Because the segmenter-based approach necessarily requires segmenting the
// entire string, we offer a leadingAndTrailingWs function to allow getting the
// whitespace prefix AND whitespace suffix with a single call to the segmenter,
// for efficiency's sake.
function trailingWs(string, segmenter) {
    if (segmenter) {
        return leadingAndTrailingWs(string, segmenter)[1];
    }
    // Yes, this looks overcomplicated and dumb - why not replace the whole function with
    //     return string.match(/\s*$/)[0]
    // you ask? Because:
    // 1. the trap described at https://markamery.com/blog/quadratic-time-regexes/ would mean doing
    //    this would cause this function to take O(n²) time in the worst case (specifically when
    //    there is a massive run of NON-TRAILING whitespace in `string`), and
    // 2. the fix proposed in the same blog post, of using a negative lookbehind, is incompatible
    //    with old Safari versions that we'd like to not break if possible (see
    //    https://github.com/kpdecker/jsdiff/pull/550)
    // It feels absurd to do this with an explicit loop instead of a regex, but I really can't see a
    // better way that doesn't result in broken behaviour.
    var i;
    for (i = string.length - 1; i >= 0; i--) {
        if (!string[i].match(/\s/)) {
            break;
        }
    }
    return string.substring(i + 1);
}
function leadingWs(string, segmenter) {
    if (segmenter) {
        return leadingAndTrailingWs(string, segmenter)[0];
    }
    // Thankfully the annoying considerations described in trailingWs don't apply here:
    var match = string.match(/^\s*/);
    return match ? match[0] : '';
}
function leadingAndTrailingWs(string, segmenter) {
    if (!segmenter) {
        return [leadingWs(string), trailingWs(string)];
    }
    if (segmenter.resolvedOptions().granularity != 'word') {
        throw new Error('The segmenter passed must have a granularity of "word"');
    }
    var segments = segment(string, segmenter);
    var firstSeg = segments[0];
    var lastSeg = segments[segments.length - 1];
    var head = (/\s/).test(firstSeg) ? firstSeg : '';
    var tail = (/\s/).test(lastSeg) ? lastSeg : '';
    return [head, tail];
}


/***/ }),
/* 15 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.lineDiff = void 0;
exports.diffLines = diffLines;
exports.diffTrimmedLines = diffTrimmedLines;
exports.tokenize = tokenize;
var base_js_1 = __webpack_require__(11);
var params_js_1 = __webpack_require__(16);
var LineDiff = /** @class */ (function (_super) {
    __extends(LineDiff, _super);
    function LineDiff() {
        var _this = _super !== null && _super.apply(this, arguments) || this;
        _this.tokenize = tokenize;
        return _this;
    }
    LineDiff.prototype.equals = function (left, right, options) {
        // If we're ignoring whitespace, we need to normalise lines by stripping
        // whitespace before checking equality. (This has an annoying interaction
        // with newlineIsToken that requires special handling: if newlines get their
        // own token, then we DON'T want to trim the *newline* tokens down to empty
        // strings, since this would cause us to treat whitespace-only line content
        // as equal to a separator between lines, which would be weird and
        // inconsistent with the documented behavior of the options.)
        if (options.ignoreWhitespace) {
            if (!options.newlineIsToken || !left.includes('\n')) {
                left = left.trim();
            }
            if (!options.newlineIsToken || !right.includes('\n')) {
                right = right.trim();
            }
        }
        else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
            if (left.endsWith('\n')) {
                left = left.slice(0, -1);
            }
            if (right.endsWith('\n')) {
                right = right.slice(0, -1);
            }
        }
        return _super.prototype.equals.call(this, left, right, options);
    };
    return LineDiff;
}(base_js_1.default));
exports.lineDiff = new LineDiff();
function diffLines(oldStr, newStr, options) {
    return exports.lineDiff.diff(oldStr, newStr, options);
}
function diffTrimmedLines(oldStr, newStr, options) {
    options = (0, params_js_1.generateOptions)(options, { ignoreWhitespace: true });
    return exports.lineDiff.diff(oldStr, newStr, options);
}
// Exported standalone so it can be used from jsonDiff too.
function tokenize(value, options) {
    if (options.stripTrailingCr) {
        // remove one \r before \n to match GNU diff's --strip-trailing-cr behavior
        value = value.replace(/\r\n/g, '\n');
    }
    var retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
    // Ignore the final empty token that occurs if the string ends with a new line
    if (!linesAndNewlines[linesAndNewlines.length - 1]) {
        linesAndNewlines.pop();
    }
    // Merge the content and line separators into single tokens
    for (var i = 0; i < linesAndNewlines.length; i++) {
        var line = linesAndNewlines[i];
        if (i % 2 && !options.newlineIsToken) {
            retLines[retLines.length - 1] += line;
        }
        else {
            retLines.push(line);
        }
    }
    return retLines;
}


/***/ }),
/* 16 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.generateOptions = generateOptions;
function generateOptions(options, defaults) {
    if (typeof options === 'function') {
        defaults.callback = options;
    }
    else if (options) {
        for (var name in options) {
            /* istanbul ignore else */
            if (Object.prototype.hasOwnProperty.call(options, name)) {
                defaults[name] = options[name];
            }
        }
    }
    return defaults;
}


/***/ }),
/* 17 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.sentenceDiff = void 0;
exports.diffSentences = diffSentences;
var base_js_1 = __webpack_require__(11);
function isSentenceEndPunct(char) {
    return char == '.' || char == '!' || char == '?';
}
var SentenceDiff = /** @class */ (function (_super) {
    __extends(SentenceDiff, _super);
    function SentenceDiff() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    SentenceDiff.prototype.tokenize = function (value) {
        var _a;
        // If in future we drop support for environments that don't support lookbehinds, we can replace
        // this entire function with:
        //     return value.split(/(?<=[.!?])(\s+|$)/);
        // but until then, for similar reasons to the trailingWs function in string.ts, we are forced
        // to do this verbosely "by hand" instead of using a regex.
        var result = [];
        var tokenStartI = 0;
        for (var i = 0; i < value.length; i++) {
            if (i == value.length - 1) {
                result.push(value.slice(tokenStartI));
                break;
            }
            if (isSentenceEndPunct(value[i]) && value[i + 1].match(/\s/)) {
                // We've hit a sentence break - i.e. a punctuation mark followed by whitespace.
                // We now want to push TWO tokens to the result:
                // 1. the sentence
                result.push(value.slice(tokenStartI, i + 1));
                // 2. the whitespace
                i = tokenStartI = i + 1;
                while ((_a = value[i + 1]) === null || _a === void 0 ? void 0 : _a.match(/\s/)) {
                    i++;
                }
                result.push(value.slice(tokenStartI, i + 1));
                // Then the next token (a sentence) starts on the character after the whitespace.
                // (It's okay if this is off the end of the string - then the outer loop will terminate
                // here anyway.)
                tokenStartI = i + 1;
            }
        }
        return result;
    };
    return SentenceDiff;
}(base_js_1.default));
exports.sentenceDiff = new SentenceDiff();
function diffSentences(oldStr, newStr, options) {
    return exports.sentenceDiff.diff(oldStr, newStr, options);
}


/***/ }),
/* 18 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.cssDiff = void 0;
exports.diffCss = diffCss;
var base_js_1 = __webpack_require__(11);
var CssDiff = /** @class */ (function (_super) {
    __extends(CssDiff, _super);
    function CssDiff() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    CssDiff.prototype.tokenize = function (value) {
        return value.split(/([{}:;,]|\s+)/);
    };
    return CssDiff;
}(base_js_1.default));
exports.cssDiff = new CssDiff();
function diffCss(oldStr, newStr, options) {
    return exports.cssDiff.diff(oldStr, newStr, options);
}


/***/ }),
/* 19 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.jsonDiff = void 0;
exports.diffJson = diffJson;
exports.canonicalize = canonicalize;
var base_js_1 = __webpack_require__(11);
var line_js_1 = __webpack_require__(15);
var JsonDiff = /** @class */ (function (_super) {
    __extends(JsonDiff, _super);
    function JsonDiff() {
        var _this = _super !== null && _super.apply(this, arguments) || this;
        _this.tokenize = line_js_1.tokenize;
        return _this;
    }
    Object.defineProperty(JsonDiff.prototype, "useLongestToken", {
        get: function () {
            // Discriminate between two lines of pretty-printed, serialized JSON where one of them has a
            // dangling comma and the other doesn't. Turns out including the dangling comma yields the nicest output:
            return true;
        },
        enumerable: false,
        configurable: true
    });
    JsonDiff.prototype.castInput = function (value, options) {
        var undefinedReplacement = options.undefinedReplacement, _a = options.stringifyReplacer, stringifyReplacer = _a === void 0 ? function (k, v) { return typeof v === 'undefined' ? undefinedReplacement : v; } : _a;
        return typeof value === 'string' ? value : JSON.stringify(canonicalize(value, null, null, stringifyReplacer), null, '  ');
    };
    JsonDiff.prototype.equals = function (left, right, options) {
        return _super.prototype.equals.call(this, left.replace(/,([\r\n])/g, '$1'), right.replace(/,([\r\n])/g, '$1'), options);
    };
    return JsonDiff;
}(base_js_1.default));
exports.jsonDiff = new JsonDiff();
function diffJson(oldStr, newStr, options) {
    return exports.jsonDiff.diff(oldStr, newStr, options);
}
// This function handles the presence of circular references by bailing out when encountering an
// object that is already on the "stack" of items being processed. Accepts an optional replacer
function canonicalize(obj, stack, replacementStack, replacer, key) {
    stack = stack || [];
    replacementStack = replacementStack || [];
    if (replacer) {
        obj = replacer(key === undefined ? '' : key, obj);
    }
    var i;
    for (i = 0; i < stack.length; i += 1) {
        if (stack[i] === obj) {
            return replacementStack[i];
        }
    }
    var canonicalizedObj;
    if ('[object Array]' === Object.prototype.toString.call(obj)) {
        stack.push(obj);
        canonicalizedObj = new Array(obj.length);
        replacementStack.push(canonicalizedObj);
        for (i = 0; i < obj.length; i += 1) {
            canonicalizedObj[i] = canonicalize(obj[i], stack, replacementStack, replacer, String(i));
        }
        stack.pop();
        replacementStack.pop();
        return canonicalizedObj;
    }
    if (obj && obj.toJSON) {
        obj = obj.toJSON();
    }
    if (typeof obj === 'object' && obj !== null) {
        stack.push(obj);
        canonicalizedObj = {};
        replacementStack.push(canonicalizedObj);
        var sortedKeys = [];
        var key_1;
        for (key_1 in obj) {
            /* istanbul ignore else */
            if (Object.prototype.hasOwnProperty.call(obj, key_1)) {
                sortedKeys.push(key_1);
            }
        }
        sortedKeys.sort();
        for (i = 0; i < sortedKeys.length; i += 1) {
            key_1 = sortedKeys[i];
            canonicalizedObj[key_1] = canonicalize(obj[key_1], stack, replacementStack, replacer, key_1);
        }
        stack.pop();
        replacementStack.pop();
    }
    else {
        canonicalizedObj = obj;
    }
    return canonicalizedObj;
}


/***/ }),
/* 20 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.arrayDiff = void 0;
exports.diffArrays = diffArrays;
var base_js_1 = __webpack_require__(11);
var ArrayDiff = /** @class */ (function (_super) {
    __extends(ArrayDiff, _super);
    function ArrayDiff() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    ArrayDiff.prototype.tokenize = function (value) {
        return value.slice();
    };
    ArrayDiff.prototype.join = function (value) {
        return value;
    };
    ArrayDiff.prototype.removeEmpty = function (value) {
        return value;
    };
    return ArrayDiff;
}(base_js_1.default));
exports.arrayDiff = new ArrayDiff();
function diffArrays(oldArr, newArr, options) {
    return exports.arrayDiff.diff(oldArr, newArr, options);
}


/***/ }),
/* 21 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.applyPatch = applyPatch;
exports.applyPatches = applyPatches;
var string_js_1 = __webpack_require__(14);
var line_endings_js_1 = __webpack_require__(22);
var parse_js_1 = __webpack_require__(23);
var distance_iterator_js_1 = __webpack_require__(24);
/**
 * attempts to apply a unified diff patch.
 *
 * Hunks are applied first to last.
 * `applyPatch` first tries to apply the first hunk at the line number specified in the hunk header, and with all context lines matching exactly.
 * If that fails, it tries scanning backwards and forwards, one line at a time, to find a place to apply the hunk where the context lines match exactly.
 * If that still fails, and `fuzzFactor` is greater than zero, it increments the maximum number of mismatches (missing, extra, or changed context lines) that there can be between the hunk context and a region where we are trying to apply the patch such that the hunk will still be considered to match.
 * Regardless of `fuzzFactor`, lines to be deleted in the hunk *must* be present for a hunk to match, and the context lines *immediately* before and after an insertion must match exactly.
 *
 * Once a hunk is successfully fitted, the process begins again with the next hunk.
 * Regardless of `fuzzFactor`, later hunks must be applied later in the file than earlier hunks.
 *
 * If a hunk cannot be successfully fitted *anywhere* with fewer than `fuzzFactor` mismatches, `applyPatch` fails and returns `false`.
 *
 * If a hunk is successfully fitted but not at the line number specified by the hunk header, all subsequent hunks have their target line number adjusted accordingly.
 * (e.g. if the first hunk is applied 10 lines below where the hunk header said it should fit, `applyPatch` will *start* looking for somewhere to apply the second hunk 10 lines below where its hunk header says it goes.)
 *
 * If the patch was applied successfully, returns a string containing the patched text.
 * If the patch could not be applied (because some hunks in the patch couldn't be fitted to the text in `source`), `applyPatch` returns false.
 *
 * @param patch a string diff or the output from the `parsePatch` or `structuredPatch` methods.
 */
function applyPatch(source, patch, options) {
    if (options === void 0) { options = {}; }
    var patches;
    if (typeof patch === 'string') {
        patches = (0, parse_js_1.parsePatch)(patch);
    }
    else if (Array.isArray(patch)) {
        patches = patch;
    }
    else {
        patches = [patch];
    }
    if (patches.length > 1) {
        throw new Error('applyPatch only works with a single input.');
    }
    return applyStructuredPatch(source, patches[0], options);
}
function applyStructuredPatch(source, patch, options) {
    if (options === void 0) { options = {}; }
    if (options.autoConvertLineEndings || options.autoConvertLineEndings == null) {
        if ((0, string_js_1.hasOnlyWinLineEndings)(source) && (0, line_endings_js_1.isUnix)(patch)) {
            patch = (0, line_endings_js_1.unixToWin)(patch);
        }
        else if ((0, string_js_1.hasOnlyUnixLineEndings)(source) && (0, line_endings_js_1.isWin)(patch)) {
            patch = (0, line_endings_js_1.winToUnix)(patch);
        }
    }
    // Apply the diff to the input
    var lines = source.split('\n'), hunks = patch.hunks, compareLine = options.compareLine || (function (lineNumber, line, operation, patchContent) { return line === patchContent; }), fuzzFactor = options.fuzzFactor || 0;
    var minLine = 0;
    if (fuzzFactor < 0 || !Number.isInteger(fuzzFactor)) {
        throw new Error('fuzzFactor must be a non-negative integer');
    }
    // Special case for empty patch.
    if (!hunks.length) {
        return source;
    }
    // Before anything else, handle EOFNL insertion/removal. If the patch tells us to make a change
    // to the EOFNL that is redundant/impossible - i.e. to remove a newline that's not there, or add a
    // newline that already exists - then we either return false and fail to apply the patch (if
    // fuzzFactor is 0) or simply ignore the problem and do nothing (if fuzzFactor is >0).
    // If we do need to remove/add a newline at EOF, this will always be in the final hunk:
    var prevLine = '', removeEOFNL = false, addEOFNL = false;
    for (var i = 0; i < hunks[hunks.length - 1].lines.length; i++) {
        var line = hunks[hunks.length - 1].lines[i];
        if (line[0] == '\\') {
            if (prevLine[0] == '+') {
                removeEOFNL = true;
            }
            else if (prevLine[0] == '-') {
                addEOFNL = true;
            }
        }
        prevLine = line;
    }
    if (removeEOFNL) {
        if (addEOFNL) {
            // This means the final line gets changed but doesn't have a trailing newline in either the
            // original or patched version. In that case, we do nothing if fuzzFactor > 0, and if
            // fuzzFactor is 0, we simply validate that the source file has no trailing newline.
            if (!fuzzFactor && lines[lines.length - 1] == '') {
                return false;
            }
        }
        else if (lines[lines.length - 1] == '') {
            lines.pop();
        }
        else if (!fuzzFactor) {
            return false;
        }
    }
    else if (addEOFNL) {
        if (lines[lines.length - 1] != '') {
            lines.push('');
        }
        else if (!fuzzFactor) {
            return false;
        }
    }
    /**
     * Checks if the hunk can be made to fit at the provided location with at most `maxErrors`
     * insertions, substitutions, or deletions, while ensuring also that:
     * - lines deleted in the hunk match exactly, and
     * - wherever an insertion operation or block of insertion operations appears in the hunk, the
     *   immediately preceding and following lines of context match exactly
     *
     * `toPos` should be set such that lines[toPos] is meant to match hunkLines[0].
     *
     * If the hunk can be applied, returns an object with properties `oldLineLastI` and
     * `replacementLines`. Otherwise, returns null.
     */
    function applyHunk(hunkLines, toPos, maxErrors, hunkLinesI, lastContextLineMatched, patchedLines, patchedLinesLength) {
        if (hunkLinesI === void 0) { hunkLinesI = 0; }
        if (lastContextLineMatched === void 0) { lastContextLineMatched = true; }
        if (patchedLines === void 0) { patchedLines = []; }
        if (patchedLinesLength === void 0) { patchedLinesLength = 0; }
        var nConsecutiveOldContextLines = 0;
        var nextContextLineMustMatch = false;
        for (; hunkLinesI < hunkLines.length; hunkLinesI++) {
            var hunkLine = hunkLines[hunkLinesI], operation = (hunkLine.length > 0 ? hunkLine[0] : ' '), content = (hunkLine.length > 0 ? hunkLine.substr(1) : hunkLine);
            if (operation === '-') {
                if (compareLine(toPos + 1, lines[toPos], operation, content)) {
                    toPos++;
                    nConsecutiveOldContextLines = 0;
                }
                else {
                    if (!maxErrors || lines[toPos] == null) {
                        return null;
                    }
                    patchedLines[patchedLinesLength] = lines[toPos];
                    return applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI, false, patchedLines, patchedLinesLength + 1);
                }
            }
            if (operation === '+') {
                if (!lastContextLineMatched) {
                    return null;
                }
                patchedLines[patchedLinesLength] = content;
                patchedLinesLength++;
                nConsecutiveOldContextLines = 0;
                nextContextLineMustMatch = true;
            }
            if (operation === ' ') {
                nConsecutiveOldContextLines++;
                patchedLines[patchedLinesLength] = lines[toPos];
                if (compareLine(toPos + 1, lines[toPos], operation, content)) {
                    patchedLinesLength++;
                    lastContextLineMatched = true;
                    nextContextLineMustMatch = false;
                    toPos++;
                }
                else {
                    if (nextContextLineMustMatch || !maxErrors) {
                        return null;
                    }
                    // Consider 3 possibilities in sequence:
                    // 1. lines contains a *substitution* not included in the patch context, or
                    // 2. lines contains an *insertion* not included in the patch context, or
                    // 3. lines contains a *deletion* not included in the patch context
                    // The first two options are of course only possible if the line from lines is non-null -
                    // i.e. only option 3 is possible if we've overrun the end of the old file.
                    return (lines[toPos] && (applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI + 1, false, patchedLines, patchedLinesLength + 1) || applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI, false, patchedLines, patchedLinesLength + 1)) || applyHunk(hunkLines, toPos, maxErrors - 1, hunkLinesI + 1, false, patchedLines, patchedLinesLength));
                }
            }
        }
        // Before returning, trim any unmodified context lines off the end of patchedLines and reduce
        // toPos (and thus oldLineLastI) accordingly. This allows later hunks to be applied to a region
        // that starts in this hunk's trailing context.
        patchedLinesLength -= nConsecutiveOldContextLines;
        toPos -= nConsecutiveOldContextLines;
        patchedLines.length = patchedLinesLength;
        return {
            patchedLines: patchedLines,
            oldLineLastI: toPos - 1
        };
    }
    var resultLines = [];
    // Search best fit offsets for each hunk based on the previous ones
    var prevHunkOffset = 0;
    for (var i = 0; i < hunks.length; i++) {
        var hunk = hunks[i];
        var hunkResult = void 0;
        var maxLine = lines.length - hunk.oldLines + fuzzFactor;
        var toPos = void 0;
        for (var maxErrors = 0; maxErrors <= fuzzFactor; maxErrors++) {
            toPos = hunk.oldStart + prevHunkOffset - 1;
            var iterator = (0, distance_iterator_js_1.default)(toPos, minLine, maxLine);
            for (; toPos !== undefined; toPos = iterator()) {
                hunkResult = applyHunk(hunk.lines, toPos, maxErrors);
                if (hunkResult) {
                    break;
                }
            }
            if (hunkResult) {
                break;
            }
        }
        if (!hunkResult) {
            return false;
        }
        // Copy everything from the end of where we applied the last hunk to the start of this hunk
        for (var i_1 = minLine; i_1 < toPos; i_1++) {
            resultLines.push(lines[i_1]);
        }
        // Add the lines produced by applying the hunk:
        for (var i_2 = 0; i_2 < hunkResult.patchedLines.length; i_2++) {
            var line = hunkResult.patchedLines[i_2];
            resultLines.push(line);
        }
        // Set lower text limit to end of the current hunk, so next ones don't try
        // to fit over already patched text
        minLine = hunkResult.oldLineLastI + 1;
        // Note the offset between where the patch said the hunk should've applied and where we
        // applied it, so we can adjust future hunks accordingly:
        prevHunkOffset = toPos + 1 - hunk.oldStart;
    }
    // Copy over the rest of the lines from the old text
    for (var i = minLine; i < lines.length; i++) {
        resultLines.push(lines[i]);
    }
    return resultLines.join('\n');
}
/**
 * applies one or more patches.
 *
 * `patch` may be either an array of structured patch objects, or a string representing a patch in unified diff format (which may patch one or more files).
 *
 * This method will iterate over the contents of the patch and apply to data provided through callbacks. The general flow for each patch index is:
 *
 * - `options.loadFile(index, callback)` is called. The caller should then load the contents of the file and then pass that to the `callback(err, data)` callback. Passing an `err` will terminate further patch execution.
 * - `options.patched(index, content, callback)` is called once the patch has been applied. `content` will be the return value from `applyPatch`. When it's ready, the caller should call `callback(err)` callback. Passing an `err` will terminate further patch execution.
 *
 * Once all patches have been applied or an error occurs, the `options.complete(err)` callback is made.
 */
function applyPatches(uniDiff, options) {
    var spDiff = typeof uniDiff === 'string' ? (0, parse_js_1.parsePatch)(uniDiff) : uniDiff;
    var currentIndex = 0;
    function processIndex() {
        var index = spDiff[currentIndex++];
        if (!index) {
            return options.complete();
        }
        options.loadFile(index, function (err, data) {
            if (err) {
                return options.complete(err);
            }
            var updatedContent = applyPatch(data, index, options);
            options.patched(index, updatedContent, function (err) {
                if (err) {
                    return options.complete(err);
                }
                processIndex();
            });
        });
    }
    processIndex();
}


/***/ }),
/* 22 */
/***/ (function(__unused_webpack_module, exports) {


var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.unixToWin = unixToWin;
exports.winToUnix = winToUnix;
exports.isUnix = isUnix;
exports.isWin = isWin;
function unixToWin(patch) {
    if (Array.isArray(patch)) {
        // It would be cleaner if instead of the line below we could just write
        //     return patch.map(unixToWin)
        // but mysteriously TypeScript (v5.7.3 at the time of writing) does not like this and it will
        // refuse to compile, thinking that unixToWin could then return StructuredPatch[][] and the
        // result would be incompatible with the overload signatures.
        // See bug report at https://github.com/microsoft/TypeScript/issues/61398.
        return patch.map(function (p) { return unixToWin(p); });
    }
    return __assign(__assign({}, patch), { hunks: patch.hunks.map(function (hunk) { return (__assign(__assign({}, hunk), { lines: hunk.lines.map(function (line, i) {
                var _a;
                return (line.startsWith('\\') || line.endsWith('\r') || ((_a = hunk.lines[i + 1]) === null || _a === void 0 ? void 0 : _a.startsWith('\\')))
                    ? line
                    : line + '\r';
            }) })); }) });
}
function winToUnix(patch) {
    if (Array.isArray(patch)) {
        // (See comment above equivalent line in unixToWin)
        return patch.map(function (p) { return winToUnix(p); });
    }
    return __assign(__assign({}, patch), { hunks: patch.hunks.map(function (hunk) { return (__assign(__assign({}, hunk), { lines: hunk.lines.map(function (line) { return line.endsWith('\r') ? line.substring(0, line.length - 1) : line; }) })); }) });
}
/**
 * Returns true if the patch consistently uses Unix line endings (or only involves one line and has
 * no line endings).
 */
function isUnix(patch) {
    if (!Array.isArray(patch)) {
        patch = [patch];
    }
    return !patch.some(function (index) { return index.hunks.some(function (hunk) { return hunk.lines.some(function (line) { return !line.startsWith('\\') && line.endsWith('\r'); }); }); });
}
/**
 * Returns true if the patch uses Windows line endings and only Windows line endings.
 */
function isWin(patch) {
    if (!Array.isArray(patch)) {
        patch = [patch];
    }
    return patch.some(function (index) { return index.hunks.some(function (hunk) { return hunk.lines.some(function (line) { return line.endsWith('\r'); }); }); })
        && patch.every(function (index) { return index.hunks.every(function (hunk) { return hunk.lines.every(function (line, i) { var _a; return line.startsWith('\\') || line.endsWith('\r') || ((_a = hunk.lines[i + 1]) === null || _a === void 0 ? void 0 : _a.startsWith('\\')); }); }); });
}


/***/ }),
/* 23 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.parsePatch = parsePatch;
/**
 * Parses a patch into structured data, in the same structure returned by `structuredPatch`.
 *
 * @return a JSON object representation of the a patch, suitable for use with the `applyPatch` method.
 */
function parsePatch(uniDiff) {
    var diffstr = uniDiff.split(/\n/), list = [];
    var i = 0;
    function parseIndex() {
        var index = {};
        list.push(index);
        // Parse diff metadata
        while (i < diffstr.length) {
            var line = diffstr[i];
            // File header found, end parsing diff metadata
            if ((/^(---|\+\+\+|@@)\s/).test(line)) {
                break;
            }
            // Try to parse the line as a diff header, like
            //     Index: README.md
            // or
            //     diff -r 9117c6561b0b -r 273ce12ad8f1 .hgignore
            // or
            //     Index: something with multiple words
            // and extract the filename (or whatever else is used as an index name)
            // from the end (i.e. 'README.md', '.hgignore', or
            // 'something with multiple words' in the examples above).
            //
            // TODO: It seems awkward that we indiscriminately trim off trailing
            //       whitespace here. Theoretically, couldn't that be meaningful -
            //       e.g. if the patch represents a diff of a file whose name ends
            //       with a space? Seems wrong to nuke it.
            //       But this behaviour has been around since v2.2.1 in 2015, so if
            //       it's going to change, it should be done cautiously and in a new
            //       major release, for backwards-compat reasons.
            //       -- ExplodingCabbage
            var headerMatch = (/^(?:Index:|diff(?: -r \w+)+)\s+/).exec(line);
            if (headerMatch) {
                index.index = line.substring(headerMatch[0].length).trim();
            }
            i++;
        }
        // Parse file headers if they are defined. Unified diff requires them, but
        // there's no technical issues to have an isolated hunk without file header
        parseFileHeader(index);
        parseFileHeader(index);
        // Parse hunks
        index.hunks = [];
        while (i < diffstr.length) {
            var line = diffstr[i];
            if ((/^(Index:\s|diff\s|---\s|\+\+\+\s|===================================================================)/).test(line)) {
                break;
            }
            else if ((/^@@/).test(line)) {
                index.hunks.push(parseHunk());
            }
            else if (line) {
                throw new Error('Unknown line ' + (i + 1) + ' ' + JSON.stringify(line));
            }
            else {
                i++;
            }
        }
    }
    // Parses the --- and +++ headers, if none are found, no lines
    // are consumed.
    function parseFileHeader(index) {
        var fileHeaderMatch = (/^(---|\+\+\+)\s+/).exec(diffstr[i]);
        if (fileHeaderMatch) {
            var prefix = fileHeaderMatch[1], data = diffstr[i].substring(3).trim().split('\t', 2), header = (data[1] || '').trim();
            var fileName = data[0].replace(/\\\\/g, '\\');
            if (fileName.startsWith('"') && fileName.endsWith('"')) {
                fileName = fileName.substr(1, fileName.length - 2);
            }
            if (prefix === '---') {
                index.oldFileName = fileName;
                index.oldHeader = header;
            }
            else {
                index.newFileName = fileName;
                index.newHeader = header;
            }
            i++;
        }
    }
    // Parses a hunk
    // This assumes that we are at the start of a hunk.
    function parseHunk() {
        var _a;
        var chunkHeaderIndex = i, chunkHeaderLine = diffstr[i++], chunkHeader = chunkHeaderLine.split(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        var hunk = {
            oldStart: +chunkHeader[1],
            oldLines: typeof chunkHeader[2] === 'undefined' ? 1 : +chunkHeader[2],
            newStart: +chunkHeader[3],
            newLines: typeof chunkHeader[4] === 'undefined' ? 1 : +chunkHeader[4],
            lines: []
        };
        // Unified Diff Format quirk: If the chunk size is 0,
        // the first number is one lower than one would expect.
        // https://www.artima.com/weblogs/viewpost.jsp?thread=164293
        if (hunk.oldLines === 0) {
            hunk.oldStart += 1;
        }
        if (hunk.newLines === 0) {
            hunk.newStart += 1;
        }
        var addCount = 0, removeCount = 0;
        for (; i < diffstr.length && (removeCount < hunk.oldLines || addCount < hunk.newLines || ((_a = diffstr[i]) === null || _a === void 0 ? void 0 : _a.startsWith('\\'))); i++) {
            var operation = (diffstr[i].length == 0 && i != (diffstr.length - 1)) ? ' ' : diffstr[i][0];
            if (operation === '+' || operation === '-' || operation === ' ' || operation === '\\') {
                hunk.lines.push(diffstr[i]);
                if (operation === '+') {
                    addCount++;
                }
                else if (operation === '-') {
                    removeCount++;
                }
                else if (operation === ' ') {
                    addCount++;
                    removeCount++;
                }
            }
            else {
                throw new Error("Hunk at line ".concat(chunkHeaderIndex + 1, " contained invalid line ").concat(diffstr[i]));
            }
        }
        // Handle the empty block count case
        if (!addCount && hunk.newLines === 1) {
            hunk.newLines = 0;
        }
        if (!removeCount && hunk.oldLines === 1) {
            hunk.oldLines = 0;
        }
        // Perform sanity checking
        if (addCount !== hunk.newLines) {
            throw new Error('Added line count did not match for hunk at line ' + (chunkHeaderIndex + 1));
        }
        if (removeCount !== hunk.oldLines) {
            throw new Error('Removed line count did not match for hunk at line ' + (chunkHeaderIndex + 1));
        }
        return hunk;
    }
    while (i < diffstr.length) {
        parseIndex();
    }
    return list;
}


/***/ }),
/* 24 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports["default"] = default_1;
// Iterator that traverses in the range of [min, max], stepping
// by distance from a given start position. I.e. for [0, 4], with
// start of 2, this will iterate 2, 3, 1, 4, 0.
function default_1(start, minLine, maxLine) {
    var wantForward = true, backwardExhausted = false, forwardExhausted = false, localOffset = 1;
    return function iterator() {
        if (wantForward && !forwardExhausted) {
            if (backwardExhausted) {
                localOffset++;
            }
            else {
                wantForward = false;
            }
            // Check if trying to fit beyond text length, and if not, check it fits
            // after offset location (or desired location on first iteration)
            if (start + localOffset <= maxLine) {
                return start + localOffset;
            }
            forwardExhausted = true;
        }
        if (!backwardExhausted) {
            if (!forwardExhausted) {
                wantForward = true;
            }
            // Check if trying to fit before text beginning, and if not, check it fits
            // before offset location
            if (minLine <= start - localOffset) {
                return start - localOffset++;
            }
            backwardExhausted = true;
            return iterator();
        }
        // We tried to fit hunk before text beginning and beyond text length, then
        // hunk can't fit on the text. Return undefined
        return undefined;
    };
}


/***/ }),
/* 25 */
/***/ (function(__unused_webpack_module, exports) {


var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.reversePatch = reversePatch;
function reversePatch(structuredPatch) {
    if (Array.isArray(structuredPatch)) {
        // (See comment in unixToWin for why we need the pointless-looking anonymous function here)
        return structuredPatch.map(function (patch) { return reversePatch(patch); }).reverse();
    }
    return __assign(__assign({}, structuredPatch), { oldFileName: structuredPatch.newFileName, oldHeader: structuredPatch.newHeader, newFileName: structuredPatch.oldFileName, newHeader: structuredPatch.oldHeader, hunks: structuredPatch.hunks.map(function (hunk) {
            return {
                oldLines: hunk.newLines,
                oldStart: hunk.newStart,
                newLines: hunk.oldLines,
                newStart: hunk.oldStart,
                lines: hunk.lines.map(function (l) {
                    if (l.startsWith('-')) {
                        return "+".concat(l.slice(1));
                    }
                    if (l.startsWith('+')) {
                        return "-".concat(l.slice(1));
                    }
                    return l;
                })
            };
        }) });
}


/***/ }),
/* 26 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.OMIT_HEADERS = exports.FILE_HEADERS_ONLY = exports.INCLUDE_HEADERS = void 0;
exports.structuredPatch = structuredPatch;
exports.formatPatch = formatPatch;
exports.createTwoFilesPatch = createTwoFilesPatch;
exports.createPatch = createPatch;
var line_js_1 = __webpack_require__(15);
exports.INCLUDE_HEADERS = {
    includeIndex: true,
    includeUnderline: true,
    includeFileHeaders: true
};
exports.FILE_HEADERS_ONLY = {
    includeIndex: false,
    includeUnderline: false,
    includeFileHeaders: true
};
exports.OMIT_HEADERS = {
    includeIndex: false,
    includeUnderline: false,
    includeFileHeaders: false
};
function structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
    var optionsObj;
    if (!options) {
        optionsObj = {};
    }
    else if (typeof options === 'function') {
        optionsObj = { callback: options };
    }
    else {
        optionsObj = options;
    }
    if (typeof optionsObj.context === 'undefined') {
        optionsObj.context = 4;
    }
    // We copy this into its own variable to placate TypeScript, which thinks
    // optionsObj.context might be undefined in the callbacks below.
    var context = optionsObj.context;
    // @ts-expect-error (runtime check for something that is correctly a static type error)
    if (optionsObj.newlineIsToken) {
        throw new Error('newlineIsToken may not be used with patch-generation functions, only with diffing functions');
    }
    if (!optionsObj.callback) {
        return diffLinesResultToPatch((0, line_js_1.diffLines)(oldStr, newStr, optionsObj));
    }
    else {
        var callback_1 = optionsObj.callback;
        (0, line_js_1.diffLines)(oldStr, newStr, __assign(__assign({}, optionsObj), { callback: function (diff) {
                var patch = diffLinesResultToPatch(diff);
                // TypeScript is unhappy without the cast because it does not understand that `patch` may
                // be undefined here only if `callback` is StructuredPatchCallbackAbortable:
                callback_1(patch);
            } }));
    }
    function diffLinesResultToPatch(diff) {
        // STEP 1: Build up the patch with no "\ No newline at end of file" lines and with the arrays
        //         of lines containing trailing newline characters. We'll tidy up later...
        if (!diff) {
            return;
        }
        diff.push({ value: '', lines: [] }); // Append an empty value to make cleanup easier
        function contextLines(lines) {
            return lines.map(function (entry) { return ' ' + entry; });
        }
        var hunks = [];
        var oldRangeStart = 0, newRangeStart = 0, curRange = [], oldLine = 1, newLine = 1;
        for (var i = 0; i < diff.length; i++) {
            var current = diff[i], lines = current.lines || splitLines(current.value);
            current.lines = lines;
            if (current.added || current.removed) {
                // If we have previous context, start with that
                if (!oldRangeStart) {
                    var prev = diff[i - 1];
                    oldRangeStart = oldLine;
                    newRangeStart = newLine;
                    if (prev) {
                        curRange = context > 0 ? contextLines(prev.lines.slice(-context)) : [];
                        oldRangeStart -= curRange.length;
                        newRangeStart -= curRange.length;
                    }
                }
                // Output our changes
                for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
                    var line = lines_1[_i];
                    curRange.push((current.added ? '+' : '-') + line);
                }
                // Track the updated file position
                if (current.added) {
                    newLine += lines.length;
                }
                else {
                    oldLine += lines.length;
                }
            }
            else {
                // Identical context lines. Track line changes
                if (oldRangeStart) {
                    // Close out any changes that have been output (or join overlapping)
                    if (lines.length <= context * 2 && i < diff.length - 2) {
                        // Overlapping
                        for (var _a = 0, _b = contextLines(lines); _a < _b.length; _a++) {
                            var line = _b[_a];
                            curRange.push(line);
                        }
                    }
                    else {
                        // end the range and output
                        var contextSize = Math.min(lines.length, context);
                        for (var _c = 0, _d = contextLines(lines.slice(0, contextSize)); _c < _d.length; _c++) {
                            var line = _d[_c];
                            curRange.push(line);
                        }
                        var hunk = {
                            oldStart: oldRangeStart,
                            oldLines: (oldLine - oldRangeStart + contextSize),
                            newStart: newRangeStart,
                            newLines: (newLine - newRangeStart + contextSize),
                            lines: curRange
                        };
                        hunks.push(hunk);
                        oldRangeStart = 0;
                        newRangeStart = 0;
                        curRange = [];
                    }
                }
                oldLine += lines.length;
                newLine += lines.length;
            }
        }
        // Step 2: eliminate the trailing `\n` from each line of each hunk, and, where needed, add
        //         "\ No newline at end of file".
        for (var _e = 0, hunks_1 = hunks; _e < hunks_1.length; _e++) {
            var hunk = hunks_1[_e];
            for (var i = 0; i < hunk.lines.length; i++) {
                if (hunk.lines[i].endsWith('\n')) {
                    hunk.lines[i] = hunk.lines[i].slice(0, -1);
                }
                else {
                    hunk.lines.splice(i + 1, 0, '\\ No newline at end of file');
                    i++; // Skip the line we just added, then continue iterating
                }
            }
        }
        return {
            oldFileName: oldFileName, newFileName: newFileName,
            oldHeader: oldHeader, newHeader: newHeader,
            hunks: hunks
        };
    }
}
/**
 * creates a unified diff patch.
 * @param patch either a single structured patch object (as returned by `structuredPatch`) or an array of them (as returned by `parsePatch`)
 */
function formatPatch(patch, headerOptions) {
    if (!headerOptions) {
        headerOptions = exports.INCLUDE_HEADERS;
    }
    if (Array.isArray(patch)) {
        if (patch.length > 1 && !headerOptions.includeFileHeaders) {
            throw new Error('Cannot omit file headers on a multi-file patch. '
                + '(The result would be unparseable; how would a tool trying to apply '
                + 'the patch know which changes are to which file?)');
        }
        return patch.map(function (p) { return formatPatch(p, headerOptions); }).join('\n');
    }
    var ret = [];
    if (headerOptions.includeIndex && patch.oldFileName == patch.newFileName) {
        ret.push('Index: ' + patch.oldFileName);
    }
    if (headerOptions.includeUnderline) {
        ret.push('===================================================================');
    }
    if (headerOptions.includeFileHeaders) {
        ret.push('--- ' + patch.oldFileName + (typeof patch.oldHeader === 'undefined' ? '' : '\t' + patch.oldHeader));
        ret.push('+++ ' + patch.newFileName + (typeof patch.newHeader === 'undefined' ? '' : '\t' + patch.newHeader));
    }
    for (var i = 0; i < patch.hunks.length; i++) {
        var hunk = patch.hunks[i];
        // Unified Diff Format quirk: If the chunk size is 0,
        // the first number is one lower than one would expect.
        // https://www.artima.com/weblogs/viewpost.jsp?thread=164293
        if (hunk.oldLines === 0) {
            hunk.oldStart -= 1;
        }
        if (hunk.newLines === 0) {
            hunk.newStart -= 1;
        }
        ret.push('@@ -' + hunk.oldStart + ',' + hunk.oldLines
            + ' +' + hunk.newStart + ',' + hunk.newLines
            + ' @@');
        for (var _i = 0, _a = hunk.lines; _i < _a.length; _i++) {
            var line = _a[_i];
            ret.push(line);
        }
    }
    return ret.join('\n') + '\n';
}
function createTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
    if (typeof options === 'function') {
        options = { callback: options };
    }
    if (!(options === null || options === void 0 ? void 0 : options.callback)) {
        var patchObj = structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options);
        if (!patchObj) {
            return;
        }
        return formatPatch(patchObj, options === null || options === void 0 ? void 0 : options.headerOptions);
    }
    else {
        var callback_2 = options.callback;
        structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, __assign(__assign({}, options), { callback: function (patchObj) {
                if (!patchObj) {
                    callback_2(undefined);
                }
                else {
                    callback_2(formatPatch(patchObj, options.headerOptions));
                }
            } }));
    }
}
function createPatch(fileName, oldStr, newStr, oldHeader, newHeader, options) {
    return createTwoFilesPatch(fileName, fileName, oldStr, newStr, oldHeader, newHeader, options);
}
/**
 * Split `text` into an array of lines, including the trailing newline character (where present)
 */
function splitLines(text) {
    var hasTrailingNl = text.endsWith('\n');
    var result = text.split('\n').map(function (line) { return line + '\n'; });
    if (hasTrailingNl) {
        result.pop();
    }
    else {
        result.push(result.pop().slice(0, -1));
    }
    return result;
}


/***/ }),
/* 27 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.convertChangesToDMP = convertChangesToDMP;
/**
 * converts a list of change objects to the format returned by Google's [diff-match-patch](https://github.com/google/diff-match-patch) library
 */
function convertChangesToDMP(changes) {
    var ret = [];
    var change, operation;
    for (var i = 0; i < changes.length; i++) {
        change = changes[i];
        if (change.added) {
            operation = 1;
        }
        else if (change.removed) {
            operation = -1;
        }
        else {
            operation = 0;
        }
        ret.push([operation, change.value]);
    }
    return ret;
}


/***/ }),
/* 28 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.convertChangesToXML = convertChangesToXML;
/**
 * converts a list of change objects to a serialized XML format
 */
function convertChangesToXML(changes) {
    var ret = [];
    for (var i = 0; i < changes.length; i++) {
        var change = changes[i];
        if (change.added) {
            ret.push('<ins>');
        }
        else if (change.removed) {
            ret.push('<del>');
        }
        ret.push(escapeHTML(change.value));
        if (change.added) {
            ret.push('</ins>');
        }
        else if (change.removed) {
            ret.push('</del>');
        }
    }
    return ret.join('');
}
function escapeHTML(s) {
    var n = s;
    n = n.replace(/&/g, '&amp;');
    n = n.replace(/</g, '&lt;');
    n = n.replace(/>/g, '&gt;');
    n = n.replace(/"/g, '&quot;');
    return n;
}


/***/ }),
/* 29 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ToolDeniedError = exports.ToolError = void 0;
/** Error a tool throws to abort with a message the model will see. */
class ToolError extends Error {
}
exports.ToolError = ToolError;
/** Thrown by ToolContext when the user denies a required confirmation. */
class ToolDeniedError extends ToolError {
    constructor(message = "The user denied this action.") {
        super(message);
        this.name = "ToolDeniedError";
    }
}
exports.ToolDeniedError = ToolDeniedError;


/***/ }),
/* 30 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.parseEditOp = parseEditOp;
exports.applyEdits = applyEdits;
exports.readForEdit = readForEdit;
exports.writeText = writeText;
const vscode = __importStar(__webpack_require__(1));
const fsutil_1 = __webpack_require__(31);
const types_1 = __webpack_require__(29);
/** Parse and validate a raw edit op from tool arguments. */
function parseEditOp(raw) {
    if (!raw || typeof raw !== "object") {
        throw new types_1.ToolError("Each edit must be an object with old_string/new_string.");
    }
    const op = raw;
    if (typeof op.old_string !== "string" || typeof op.new_string !== "string") {
        throw new types_1.ToolError("Each edit requires string old_string and new_string.");
    }
    if (op.old_string === op.new_string) {
        throw new types_1.ToolError("old_string and new_string must differ.");
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
function applyEdits(source, ops) {
    let content = source;
    let replacements = 0;
    for (const op of ops) {
        const occurrences = countOccurrences(content, op.old_string);
        if (occurrences === 0) {
            throw new types_1.ToolError(`old_string not found:\n${truncate(op.old_string)}`);
        }
        if (occurrences > 1 && !op.replace_all) {
            throw new types_1.ToolError(`old_string is not unique (${occurrences} matches); pass replace_all or ` +
                `add more surrounding context:\n${truncate(op.old_string)}`);
        }
        content = op.replace_all
            ? content.split(op.old_string).join(op.new_string)
            : content.replace(op.old_string, op.new_string);
        replacements += op.replace_all ? occurrences : 1;
    }
    return { content, replacements };
}
/** Read text for editing (throws if the file cannot be read). */
async function readForEdit(uri) {
    try {
        return (0, fsutil_1.decode)(await vscode.workspace.fs.readFile(uri));
    }
    catch {
        throw new types_1.ToolError(`Cannot read file for editing: ${uri.fsPath}`);
    }
}
/** Write text back to a file. */
async function writeText(uri, text) {
    await vscode.workspace.fs.writeFile(uri, (0, fsutil_1.encode)(text));
}
function countOccurrences(haystack, needle) {
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
function truncate(s, max = 200) {
    return s.length > max ? s.slice(0, max) + "…" : s;
}


/***/ }),
/* 31 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.MAX_FILE_BYTES = exports.SKIP_DIRS = exports.DEFAULT_EXCLUDE_GLOB = void 0;
exports.decode = decode;
exports.encode = encode;
exports.readText = readText;
exports.numberLines = numberLines;
exports.requireString = requireString;
exports.optionalNumber = optionalNumber;
const vscode = __importStar(__webpack_require__(1));
const types_1 = __webpack_require__(29);
/** Glob of paths tools skip by default (noise / large dirs). */
exports.DEFAULT_EXCLUDE_GLOB = "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.next/**,**/build/**}";
/** Directory names skipped during recursive listing. */
exports.SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "out",
    ".next",
    "build",
    ".vscode-test",
]);
/** Cap on bytes read for a single file, to protect the context window. */
exports.MAX_FILE_BYTES = 256 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: false });
const encoder = new TextEncoder();
function decode(bytes) {
    return decoder.decode(bytes);
}
function encode(text) {
    return encoder.encode(text);
}
/** Read a workspace file as UTF-8 text, rejecting missing/oversized/binary files. */
async function readText(uri) {
    let bytes;
    try {
        bytes = await vscode.workspace.fs.readFile(uri);
    }
    catch {
        throw new types_1.ToolError(`File not found or unreadable: ${uri.fsPath}`);
    }
    if (bytes.byteLength > exports.MAX_FILE_BYTES) {
        throw new types_1.ToolError(`File is too large to read (${bytes.byteLength} bytes; limit ${exports.MAX_FILE_BYTES}).`);
    }
    // Heuristic binary check: NUL byte in the first 8KB.
    const scan = Math.min(bytes.byteLength, 8192);
    for (let i = 0; i < scan; i++) {
        if (bytes[i] === 0) {
            throw new types_1.ToolError("File appears to be binary; refusing to read as text.");
        }
    }
    return decode(bytes);
}
/** Prefix each line with a right-aligned 1-based line number (cat -n style). */
function numberLines(text, startLine = 1) {
    const lines = text.split("\n");
    const width = String(startLine + lines.length - 1).length;
    return lines
        .map((line, i) => `${String(startLine + i).padStart(width)}  ${line}`)
        .join("\n");
}
/** Read a required string argument. */
function requireString(args, key) {
    const value = args[key];
    if (typeof value !== "string" || value.length === 0) {
        throw new types_1.ToolError(`Missing required string argument "${key}".`);
    }
    return value;
}
/** Read an optional number argument with a fallback. */
function optionalNumber(args, key, fallback) {
    const value = args[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}


/***/ }),
/* 32 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ConversationManager = void 0;
const STORAGE_KEY = "axiom.conversations.v1";
const ACTIVE_KEY = "axiom.activeConversation.v1";
const MAX_TITLE = 48;
/**
 * Owns the set of conversations and persists them to workspaceState so separate
 * chats survive reloads and restarts. Pure data — the provider owns the live
 * ChatSession and reseeds it from a record's history when switching chats.
 */
class ConversationManager {
    memento;
    records = [];
    activeId;
    seq = 0;
    constructor(memento) {
        this.memento = memento;
        this.load();
    }
    load() {
        try {
            const stored = this.memento.get(STORAGE_KEY);
            if (Array.isArray(stored)) {
                this.records = stored;
            }
            this.activeId = this.memento.get(ACTIVE_KEY);
        }
        catch {
            this.records = [];
        }
        if (this.records.length === 0) {
            this.create();
        }
        else if (!this.records.some((r) => r.id === this.activeId)) {
            this.activeId = this.records[0].id;
        }
    }
    persist() {
        // Never let a persistence failure break the chat.
        void this.memento.update(STORAGE_KEY, this.records);
        void this.memento.update(ACTIVE_KEY, this.activeId);
    }
    nextId() {
        this.seq += 1;
        // Avoid Date.now()/Math.random collisions across quick creates.
        return `c${this.seq}-${this.records.length}-${this.seq * 2654435761}`;
    }
    /** Create a new empty conversation and make it active. */
    create() {
        const record = {
            id: this.nextId(),
            title: "New Chat",
            createdAt: this.records.length, // monotonic ordering without Date.now()
            timeline: [],
            history: [],
        };
        this.records.unshift(record);
        this.activeId = record.id;
        this.persist();
        return record;
    }
    delete(id) {
        this.records = this.records.filter((r) => r.id !== id);
        if (this.records.length === 0) {
            this.create();
            return;
        }
        if (this.activeId === id) {
            this.activeId = this.records[0].id;
        }
        this.persist();
    }
    setActive(id) {
        if (this.records.some((r) => r.id === id)) {
            this.activeId = id;
            this.persist();
        }
    }
    get active() {
        const found = this.records.find((r) => r.id === this.activeId);
        if (found) {
            return found;
        }
        // Should not happen, but guarantee a record.
        return this.records[0] ?? this.create();
    }
    get activeConversationId() {
        return this.activeId;
    }
    summaries() {
        return this.records.map((r) => ({
            id: r.id,
            title: r.title,
            createdAt: r.createdAt,
        }));
    }
    /** Persist the current in-memory records (call after mutating a timeline/history). */
    save() {
        this.persist();
    }
    /** Set the active chat's title from its first user message, if still default. */
    maybeTitleFrom(text) {
        const rec = this.active;
        if (rec.title === "New Chat" || rec.title === "") {
            const clean = text.trim().replace(/\s+/g, " ");
            rec.title = clean.length > MAX_TITLE ? clean.slice(0, MAX_TITLE) + "…" : clean;
            this.persist();
        }
    }
}
exports.ConversationManager = ConversationManager;


/***/ }),
/* 33 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.MissingApiKeyError = exports.DEFAULT_BASE_URL = void 0;
exports.getModelId = getModelId;
exports.setModelId = setModelId;
exports.getModeId = getModeId;
exports.setModeId = setModeId;
exports.getBaseUrl = getBaseUrl;
exports.setBaseUrl = setBaseUrl;
exports.getTerminalAutoRun = getTerminalAutoRun;
exports.setTerminalAutoRun = setTerminalAutoRun;
exports.getApiKey = getApiKey;
exports.hasApiKey = hasApiKey;
exports.setApiKey = setApiKey;
exports.resolveConfig = resolveConfig;
exports.promptAndStoreApiKey = promptAndStoreApiKey;
const vscode = __importStar(__webpack_require__(1));
const models_1 = __webpack_require__(5);
const modes_1 = __webpack_require__(8);
/** SecretStorage key under which the Lightning API key is stored. */
const API_KEY_SECRET = "claudeAgent.apiKey";
/** globalState keys — these persist across VS Code restarts. */
const KEY_MODEL = "claudeAgent.model";
const KEY_MODE = "claudeAgent.mode";
const KEY_BASE_URL = "claudeAgent.baseUrl";
const KEY_TERMINAL_AUTO = "claudeAgent.terminalAutoRun";
exports.DEFAULT_BASE_URL = "https://lightning.ai/api/v1/";
/**
 * Thrown when no API key has been configured yet. The SidebarProvider catches
 * this specifically and offers to open the API settings.
 */
class MissingApiKeyError extends Error {
    constructor() {
        super("No API key configured for Axiom.");
        this.name = "MissingApiKeyError";
    }
}
exports.MissingApiKeyError = MissingApiKeyError;
/** Normalize a base URL to exactly one trailing slash. */
function normalizeBaseUrl(raw) {
    const trimmed = raw.trim() || exports.DEFAULT_BASE_URL;
    return trimmed.replace(/\/+$/, "") + "/";
}
// ---- persisted settings (globalState) ----
function getModelId(context) {
    return (0, models_1.resolveModelId)(context.globalState.get(KEY_MODEL));
}
async function setModelId(context, apiModelId) {
    await context.globalState.update(KEY_MODEL, (0, models_1.resolveModelId)(apiModelId));
}
function getModeId(context) {
    return (0, modes_1.resolveModeId)(context.globalState.get(KEY_MODE));
}
async function setModeId(context, mode) {
    await context.globalState.update(KEY_MODE, (0, modes_1.resolveModeId)(mode));
}
function getBaseUrl(context) {
    return normalizeBaseUrl(context.globalState.get(KEY_BASE_URL) ?? exports.DEFAULT_BASE_URL);
}
async function setBaseUrl(context, baseUrl) {
    await context.globalState.update(KEY_BASE_URL, normalizeBaseUrl(baseUrl));
}
/** Whether terminal commands run automatically (true) or need confirmation (false). */
function getTerminalAutoRun(context) {
    return context.globalState.get(KEY_TERMINAL_AUTO) === true;
}
async function setTerminalAutoRun(context, value) {
    await context.globalState.update(KEY_TERMINAL_AUTO, value);
}
// ---- API key (Environment or SecretStorage) ----
async function getApiKey(context) {
    const envKey = process.env.AI_API_KEY?.trim();
    if (envKey) {
        return envKey;
    }
    return context.secrets.get(API_KEY_SECRET);
}
async function hasApiKey(context) {
    const envKey = process.env.AI_API_KEY?.trim();
    if (envKey) {
        return true;
    }
    return !!(await context.secrets.get(API_KEY_SECRET));
}
/** Store (or clear) the API key in SecretStorage. */
async function setApiKey(context, value) {
    const trimmed = value.trim();
    if (trimmed) {
        await context.secrets.store(API_KEY_SECRET, trimmed);
    }
    else {
        await context.secrets.delete(API_KEY_SECRET);
    }
}
/**
 * Resolve everything needed for a request. Throws {@link MissingApiKeyError}
 * if the key has not been set yet.
 */
async function resolveConfig(context) {
    const apiKey = await getApiKey(context);
    if (!apiKey) {
        throw new MissingApiKeyError();
    }
    return {
        baseUrl: getBaseUrl(context),
        model: getModelId(context),
        apiKey,
    };
}
/**
 * Prompt the user for an API key and persist it in SecretStorage.
 * Returns true if a key was stored. (Used by the command palette entry.)
 */
async function promptAndStoreApiKey(context) {
    const value = await vscode.window.showInputBox({
        title: "Axiom — Lightning API Key",
        prompt: "Paste your Lightning API key. It is stored securely in VS Code SecretStorage.",
        password: true,
        ignoreFocusOut: true,
    });
    if (!value) {
        return false;
    }
    await setApiKey(context, value);
    return true;
}


/***/ }),
/* 34 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ToolRegistry = void 0;
exports.createToolRegistry = createToolRegistry;
const registry_1 = __webpack_require__(35);
const listFiles_1 = __webpack_require__(36);
const readFile_1 = __webpack_require__(37);
const readActiveEditor_1 = __webpack_require__(38);
const readSelection_1 = __webpack_require__(39);
const searchWorkspace_1 = __webpack_require__(40);
const createFile_1 = __webpack_require__(41);
const editFile_1 = __webpack_require__(42);
const renameFile_1 = __webpack_require__(43);
const deleteFile_1 = __webpack_require__(44);
const multiEdit_1 = __webpack_require__(45);
const runCommand_1 = __webpack_require__(46);
/**
 * The ONE place built-in tools are wired up. To add a capability: create a Tool
 * in `impl/`, import it, and `.register()` it here. Nothing else in the agent,
 * LLM client, or registry needs to change.
 */
function createToolRegistry() {
    const registry = new registry_1.ToolRegistry();
    registry
        // Read-only inspection
        .register(listFiles_1.listFilesTool)
        .register(readFile_1.readFileTool)
        .register(readActiveEditor_1.readActiveEditorTool)
        .register(readSelection_1.readSelectionTool)
        .register(searchWorkspace_1.searchWorkspaceTool)
        // Mutating
        .register(createFile_1.createFileTool)
        .register(editFile_1.editFileTool)
        .register(renameFile_1.renameFileTool)
        .register(multiEdit_1.multiEditTool)
        // Destructive / side-effecting (require modal confirmation)
        .register(deleteFile_1.deleteFileTool)
        .register(runCommand_1.runCommandTool);
    return registry;
}
var registry_2 = __webpack_require__(35);
Object.defineProperty(exports, "ToolRegistry", ({ enumerable: true, get: function () { return registry_2.ToolRegistry; } }));
__exportStar(__webpack_require__(29), exports);


/***/ }),
/* 35 */
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ToolRegistry = void 0;
/**
 * Holds the set of available tools and exposes them to the agent loop.
 *
 * The agent dispatches purely by name via {@link get}; it never references a
 * concrete tool. New capabilities are added by registering a Tool here (see
 * `tools/index.ts`) — the core agent, LLM client, and this registry are untouched.
 */
class ToolRegistry {
    tools = new Map();
    register(tool) {
        if (this.tools.has(tool.name)) {
            throw new Error(`Duplicate tool registration: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
        return this;
    }
    get(name) {
        return this.tools.get(name);
    }
    list() {
        return [...this.tools.values()];
    }
    /** Tools available in the given mode. Plan mode excludes mutating tools. */
    listForMode(allowMutations) {
        return this.list().filter((t) => allowMutations || !t.mutates);
    }
    /**
     * OpenAI-compatible `tools` array for the chat/completions request. When
     * `allowMutations` is false (Plan mode), mutating tools are omitted so the
     * model cannot edit files.
     */
    definitions(allowMutations = true) {
        return this.listForMode(allowMutations).map((tool) => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        }));
    }
}
exports.ToolRegistry = ToolRegistry;


/***/ }),
/* 36 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.listFilesTool = void 0;
const vscode = __importStar(__webpack_require__(1));
const fsutil_1 = __webpack_require__(31);
const fsutil_2 = __webpack_require__(31);
const MAX_ENTRIES = 1000;
exports.listFilesTool = {
    name: "list_files",
    description: "List files and directories inside the workspace as a tree. Use this to " +
        "understand the project layout before reading or editing. Skips noise dirs " +
        "like node_modules and .git.",
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Directory to list, relative to the workspace root. Defaults to the root.",
            },
            depth: {
                type: "integer",
                description: "How many directory levels to descend. Default 2.",
            },
        },
    },
    async execute(args, ctx) {
        const rel = typeof args.path === "string" && args.path ? args.path : ".";
        const depth = Math.max(1, Math.min((0, fsutil_2.optionalNumber)(args, "depth", 2), 8));
        const dir = await ctx.resolvePath(rel);
        const lines = [];
        let count = 0;
        let truncated = false;
        const walk = async (uri, level) => {
            if (level > depth || truncated) {
                return;
            }
            let entries;
            try {
                entries = await vscode.workspace.fs.readDirectory(uri);
            }
            catch {
                return;
            }
            entries.sort((a, b) => {
                // directories first, then alphabetical
                const dirDiff = (b[1] & vscode.FileType.Directory) - (a[1] & vscode.FileType.Directory);
                return dirDiff !== 0 ? dirDiff : a[0].localeCompare(b[0]);
            });
            for (const [name, type] of entries) {
                if (fsutil_1.SKIP_DIRS.has(name)) {
                    continue;
                }
                if (count >= MAX_ENTRIES) {
                    truncated = true;
                    return;
                }
                const isDir = (type & vscode.FileType.Directory) !== 0;
                lines.push(`${"  ".repeat(level - 1)}${name}${isDir ? "/" : ""}`);
                count++;
                if (isDir) {
                    await walk(vscode.Uri.joinPath(uri, name), level + 1);
                }
            }
        };
        await walk(dir, 1);
        const header = `${ctx.toRelative(dir)}/`;
        const body = lines.length ? lines.join("\n") : "(empty)";
        const note = truncated ? `\n… truncated at ${MAX_ENTRIES} entries.` : "";
        return {
            content: `${header}\n${body}${note}`,
            summary: `Listed ${count} entr${count === 1 ? "y" : "ies"} under ${ctx.toRelative(dir)}`,
        };
    },
};


/***/ }),
/* 37 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.readFileTool = void 0;
const fsutil_1 = __webpack_require__(31);
exports.readFileTool = {
    name: "read_file",
    description: "Read a text file from the workspace. Returns the content with line numbers " +
        "so you can reference exact lines when editing. Optionally read a line range.",
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "File path relative to the workspace root.",
            },
            start_line: {
                type: "integer",
                description: "1-based first line to return (optional).",
            },
            end_line: {
                type: "integer",
                description: "1-based last line to return, inclusive (optional).",
            },
        },
        required: ["path"],
    },
    async execute(args, ctx) {
        const rel = (0, fsutil_1.requireString)(args, "path");
        const uri = await ctx.resolvePath(rel);
        const text = await (0, fsutil_1.readText)(uri);
        const allLines = text.split("\n");
        const start = Math.max(1, (0, fsutil_1.optionalNumber)(args, "start_line", 1));
        const end = Math.min(allLines.length, (0, fsutil_1.optionalNumber)(args, "end_line", allLines.length));
        const slice = allLines.slice(start - 1, end).join("\n");
        const numbered = (0, fsutil_1.numberLines)(slice, start);
        const relPath = ctx.toRelative(uri);
        const ranged = start > 1 || end < allLines.length;
        return {
            content: `${relPath} (lines ${start}-${end} of ${allLines.length})\n${numbered}`,
            summary: `Read ${relPath}${ranged ? ` (lines ${start}-${end})` : ` (${allLines.length} lines)`}`,
        };
    },
};


/***/ }),
/* 38 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.readActiveEditorTool = void 0;
const vscode = __importStar(__webpack_require__(1));
const fsutil_1 = __webpack_require__(31);
exports.readActiveEditorTool = {
    name: "read_active_editor",
    description: "Read the file currently open and focused in the editor, including its path " +
        "and full contents with line numbers. Use this when the user refers to " +
        "'this file' or 'the file I'm looking at'.",
    parameters: { type: "object", properties: {} },
    async execute(_args, ctx) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return {
                content: "There is no active editor.",
                summary: "No active editor",
            };
        }
        const doc = editor.document;
        const rel = ctx.toRelative(doc.uri);
        const text = doc.getText();
        return {
            content: `${rel} (${doc.lineCount} lines, language: ${doc.languageId})\n${(0, fsutil_1.numberLines)(text)}`,
            summary: `Read active editor: ${rel}`,
        };
    },
};


/***/ }),
/* 39 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.readSelectionTool = void 0;
const vscode = __importStar(__webpack_require__(1));
exports.readSelectionTool = {
    name: "read_selection",
    description: "Read the text the user has currently selected in the active editor, with its " +
        "file path and line range. Use this when the user refers to 'the selected " +
        "code' or 'this snippet'.",
    parameters: { type: "object", properties: {} },
    async execute(_args, ctx) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return { content: "There is no active editor.", summary: "No active editor" };
        }
        const { document, selection } = editor;
        if (selection.isEmpty) {
            return {
                content: "No text is selected in the active editor.",
                summary: "No selection",
            };
        }
        const rel = ctx.toRelative(document.uri);
        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;
        const text = document.getText(selection);
        return {
            content: `${rel} (lines ${startLine}-${endLine})\n${text}`,
            summary: `Read selection: ${rel} (lines ${startLine}-${endLine})`,
        };
    },
};


/***/ }),
/* 40 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.searchWorkspaceTool = void 0;
const vscode = __importStar(__webpack_require__(1));
const fsutil_1 = __webpack_require__(31);
const types_1 = __webpack_require__(29);
const MAX_FILES_SCANNED = 2000;
const MAX_MATCHES = 200;
exports.searchWorkspaceTool = {
    name: "search_workspace",
    description: "Search file contents across the workspace for a string or regular expression. " +
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
                description: "Optional include glob, e.g. '**/*.ts'. Defaults to all files.",
            },
        },
        required: ["query"],
    },
    async execute(args, ctx) {
        const query = (0, fsutil_1.requireString)(args, "query");
        const isRegex = args.is_regex === true;
        const caseSensitive = args.case_sensitive === true;
        const include = typeof args.glob === "string" && args.glob ? args.glob : "**/*";
        const maxMatches = Math.min((0, fsutil_1.optionalNumber)(args, "max_results", MAX_MATCHES), MAX_MATCHES);
        let regex;
        try {
            const pattern = isRegex ? query : escapeRegExp(query);
            regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
        }
        catch (err) {
            throw new types_1.ToolError(`Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`);
        }
        const files = await vscode.workspace.findFiles(include, fsutil_1.DEFAULT_EXCLUDE_GLOB, MAX_FILES_SCANNED);
        const results = [];
        let matchCount = 0;
        let filesWithMatches = 0;
        for (const uri of files) {
            if (matchCount >= maxMatches) {
                break;
            }
            let bytes;
            try {
                bytes = await vscode.workspace.fs.readFile(uri);
            }
            catch {
                continue;
            }
            if (bytes.byteLength > 1024 * 1024 || bytes.includes(0)) {
                continue; // skip huge or binary files
            }
            const text = (0, fsutil_1.decode)(bytes);
            const rel = ctx.toRelative(uri);
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
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


/***/ }),
/* 41 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.createFileTool = void 0;
const vscode = __importStar(__webpack_require__(1));
const types_1 = __webpack_require__(29);
const fsutil_1 = __webpack_require__(31);
exports.createFileTool = {
    name: "create_file",
    mutates: true,
    description: "Create a new file in the workspace with the given contents. Fails if the file " +
        "already exists unless overwrite is true. Parent directories are created " +
        "automatically. Use edit_file to modify existing files.",
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "File path relative to the workspace root.",
            },
            content: {
                type: "string",
                description: "Full text content of the new file.",
            },
            overwrite: {
                type: "boolean",
                description: "Overwrite if the file already exists. Default false.",
            },
        },
        required: ["path", "content"],
    },
    async execute(args, ctx) {
        const rel = (0, fsutil_1.requireString)(args, "path");
        const content = typeof args.content === "string" ? args.content : "";
        const overwrite = args.overwrite === true;
        const uri = await ctx.resolvePath(rel);
        let exists = true;
        try {
            await vscode.workspace.fs.stat(uri);
        }
        catch {
            exists = false;
        }
        if (exists && !overwrite) {
            throw new types_1.ToolError(`File already exists: ${ctx.toRelative(uri)}. Pass overwrite:true or use edit_file.`);
        }
        await vscode.workspace.fs.writeFile(uri, (0, fsutil_1.encode)(content));
        const relPath = ctx.toRelative(uri);
        return {
            content: `${exists ? "Overwrote" : "Created"} ${relPath} (${content.split("\n").length} lines).`,
            summary: `${exists ? "Overwrote" : "Created"} ${relPath}`,
        };
    },
};


/***/ }),
/* 42 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.editFileTool = void 0;
const fsutil_1 = __webpack_require__(31);
const editCore_1 = __webpack_require__(30);
exports.editFileTool = {
    name: "edit_file",
    mutates: true,
    description: "Edit an existing file by replacing an exact snippet of text. old_string must " +
        "match the file exactly (including indentation) and be unique unless " +
        "replace_all is true. For several changes to one file, pass multiple edits.",
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "File path relative to the workspace root.",
            },
            old_string: {
                type: "string",
                description: "Exact text to replace. Include enough context to be unique.",
            },
            new_string: {
                type: "string",
                description: "Replacement text.",
            },
            replace_all: {
                type: "boolean",
                description: "Replace every occurrence instead of requiring uniqueness.",
            },
        },
        required: ["path", "old_string", "new_string"],
    },
    async execute(args, ctx) {
        const rel = (0, fsutil_1.requireString)(args, "path");
        const uri = await ctx.resolvePath(rel);
        const op = (0, editCore_1.parseEditOp)(args);
        const source = await (0, editCore_1.readForEdit)(uri);
        const { content, replacements } = (0, editCore_1.applyEdits)(source, [op]);
        await (0, editCore_1.writeText)(uri, content);
        const relPath = ctx.toRelative(uri);
        return {
            content: `Edited ${relPath} (${replacements} replacement${replacements === 1 ? "" : "s"}).`,
            summary: `Edited ${relPath}`,
        };
    },
};


/***/ }),
/* 43 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.renameFileTool = void 0;
const vscode = __importStar(__webpack_require__(1));
const types_1 = __webpack_require__(29);
const fsutil_1 = __webpack_require__(31);
exports.renameFileTool = {
    name: "rename_file",
    mutates: true,
    description: "Rename or move a file (or directory) within the workspace. Both source and " +
        "destination are resolved relative to the workspace root.",
    parameters: {
        type: "object",
        properties: {
            from: {
                type: "string",
                description: "Existing path relative to the workspace root.",
            },
            to: {
                type: "string",
                description: "New path relative to the workspace root.",
            },
            overwrite: {
                type: "boolean",
                description: "Overwrite the destination if it exists. Default false.",
            },
        },
        required: ["from", "to"],
    },
    async execute(args, ctx) {
        const fromRel = (0, fsutil_1.requireString)(args, "from");
        const toRel = (0, fsutil_1.requireString)(args, "to");
        const overwrite = args.overwrite === true;
        const from = await ctx.resolvePath(fromRel);
        const to = await ctx.resolvePath(toRel);
        try {
            await vscode.workspace.fs.stat(from);
        }
        catch {
            throw new types_1.ToolError(`Source does not exist: ${ctx.toRelative(from)}`);
        }
        await vscode.workspace.fs.rename(from, to, { overwrite });
        return {
            content: `Renamed ${ctx.toRelative(from)} → ${ctx.toRelative(to)}.`,
            summary: `Renamed → ${ctx.toRelative(to)}`,
        };
    },
};


/***/ }),
/* 44 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.deleteFileTool = void 0;
const vscode = __importStar(__webpack_require__(1));
const types_1 = __webpack_require__(29);
const fsutil_1 = __webpack_require__(31);
exports.deleteFileTool = {
    name: "delete_file",
    mutates: true,
    description: "Delete a file or directory in the workspace. This is destructive and ALWAYS " +
        "asks the user to confirm before deleting. Deletes into the OS trash when possible.",
    parameters: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Path relative to the workspace root.",
            },
            recursive: {
                type: "boolean",
                description: "Required true to delete a non-empty directory.",
            },
        },
        required: ["path"],
    },
    async execute(args, ctx) {
        const rel = (0, fsutil_1.requireString)(args, "path");
        const recursive = args.recursive === true;
        const uri = await ctx.resolvePath(rel);
        let stat;
        try {
            stat = await vscode.workspace.fs.stat(uri);
        }
        catch {
            throw new types_1.ToolError(`Path does not exist: ${ctx.toRelative(uri)}`);
        }
        const isDir = (stat.type & vscode.FileType.Directory) !== 0;
        const relPath = ctx.toRelative(uri);
        const approved = await ctx.confirm(`Delete ${isDir ? "directory" : "file"} "${relPath}"?`, "This action cannot be easily undone.");
        if (!approved) {
            throw new types_1.ToolDeniedError(`Deletion of "${relPath}" was declined by the user.`);
        }
        await vscode.workspace.fs.delete(uri, {
            recursive: isDir ? recursive || true : false,
            useTrash: true,
        });
        return {
            content: `Deleted ${relPath}.`,
            summary: `Deleted ${relPath}`,
        };
    },
};


/***/ }),
/* 45 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.multiEditTool = void 0;
const types_1 = __webpack_require__(29);
const editCore_1 = __webpack_require__(30);
/**
 * Apply a batch of edits across one or more files. Edits for each file are
 * validated and applied in-memory first; a file is only written if all of its
 * edits succeed (atomic per file). If any file fails, no partial write happens
 * for that file, and the error is reported so the model can retry.
 */
exports.multiEditTool = {
    name: "multi_edit",
    mutates: true,
    description: "Apply multiple edits across one or more files in a single call. Each entry " +
        "targets a file and a list of exact find/replace edits. Edits within a file " +
        "are applied in order and atomically (all-or-nothing per file). Prefer this " +
        "for coordinated changes spanning several files.",
    parameters: {
        type: "object",
        properties: {
            files: {
                type: "array",
                description: "List of per-file edit groups.",
                items: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "File path relative to the workspace root.",
                        },
                        edits: {
                            type: "array",
                            description: "Ordered find/replace edits for this file.",
                            items: {
                                type: "object",
                                properties: {
                                    old_string: { type: "string", description: "Exact text to replace." },
                                    new_string: { type: "string", description: "Replacement text." },
                                    replace_all: {
                                        type: "boolean",
                                        description: "Replace all occurrences.",
                                    },
                                },
                                required: ["old_string", "new_string"],
                            },
                        },
                    },
                    required: ["path", "edits"],
                },
            },
        },
        required: ["files"],
    },
    async execute(args, ctx) {
        const files = args.files;
        if (!Array.isArray(files) || files.length === 0) {
            throw new types_1.ToolError("multi_edit requires a non-empty 'files' array.");
        }
        const applied = [];
        const errors = [];
        for (const entry of files) {
            if (!entry || typeof entry !== "object") {
                errors.push("Skipped an invalid file entry (not an object).");
                continue;
            }
            const rec = entry;
            const path = rec.path;
            const rawEdits = rec.edits;
            if (typeof path !== "string" || !path) {
                errors.push("Skipped a file entry with a missing 'path'.");
                continue;
            }
            if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
                errors.push(`${path}: no edits provided.`);
                continue;
            }
            try {
                const uri = await ctx.resolvePath(path);
                const ops = rawEdits.map(editCore_1.parseEditOp);
                const source = await (0, editCore_1.readForEdit)(uri);
                const { content, replacements } = (0, editCore_1.applyEdits)(source, ops);
                await (0, editCore_1.writeText)(uri, content);
                applied.push(`${ctx.toRelative(uri)} (${replacements} change${replacements === 1 ? "" : "s"})`);
            }
            catch (err) {
                errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        const isError = applied.length === 0;
        const parts = [];
        if (applied.length) {
            parts.push(`Applied edits to ${applied.length} file(s):\n- ${applied.join("\n- ")}`);
        }
        if (errors.length) {
            parts.push(`Failures:\n- ${errors.join("\n- ")}`);
        }
        return {
            content: parts.join("\n\n"),
            isError,
            summary: `${applied.length} file(s) edited${errors.length ? `, ${errors.length} failed` : ""}`,
        };
    },
};


/***/ }),
/* 46 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.runCommandTool = void 0;
const child_process_1 = __webpack_require__(47);
const types_1 = __webpack_require__(29);
const fsutil_1 = __webpack_require__(31);
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 20_000;
exports.runCommandTool = {
    name: "run_command",
    mutates: true,
    description: "Run a shell command in the workspace root and return its stdout/stderr and " +
        "exit code. Use for builds, tests, linters, git status, etc. This ALWAYS asks " +
        "the user to confirm before running. Commands run non-interactively; do not " +
        "start long-lived watchers or servers that never exit.",
    parameters: {
        type: "object",
        properties: {
            command: {
                type: "string",
                description: "The exact shell command to execute.",
            },
            timeout_ms: {
                type: "integer",
                description: `Max run time in ms (default ${DEFAULT_TIMEOUT_MS}).`,
            },
        },
        required: ["command"],
    },
    async execute(args, ctx) {
        const command = (0, fsutil_1.requireString)(args, "command");
        const timeout = typeof args.timeout_ms === "number" && args.timeout_ms > 0
            ? Math.min(args.timeout_ms, 5 * 60_000)
            : DEFAULT_TIMEOUT_MS;
        if (!ctx.workspaceRoot) {
            throw new types_1.ToolError("No workspace folder is open to run a command in.");
        }
        // In manual mode (default) ask for confirmation; in auto mode run directly.
        if (!ctx.terminalAutoRun) {
            const approved = await ctx.confirm("Run this command?", `${command}\n\nWorking directory:\n${ctx.workspaceRoot.fsPath}`);
            if (!approved) {
                throw new types_1.ToolDeniedError(`Running "${command}" was declined by the user.`);
            }
        }
        const cwd = ctx.workspaceRoot.fsPath;
        const { stdout, stderr, code, timedOut } = await new Promise((resolve) => {
            const child = (0, child_process_1.exec)(command, { cwd, timeout, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, out, errOut) => {
                const execErr = err;
                const timedOut = !!execErr && execErr.signal === "SIGTERM";
                const code = execErr && typeof execErr.code === "number"
                    ? execErr.code
                    : execErr
                        ? 1
                        : 0;
                resolve({ stdout: out, stderr: errOut, code, timedOut });
            });
            // Ensure the process is killed if the timeout elapses.
            child.on("error", () => resolve({ stdout: "", stderr: "failed to start", code: 1, timedOut: false }));
        });
        const clip = (s) => s.length > MAX_OUTPUT_CHARS
            ? s.slice(0, MAX_OUTPUT_CHARS) + "\n… output truncated."
            : s;
        const sections = [`$ ${command}`, `exit code: ${code}${timedOut ? " (timed out)" : ""}`];
        if (stdout.trim()) {
            sections.push(`stdout:\n${clip(stdout)}`);
        }
        if (stderr.trim()) {
            sections.push(`stderr:\n${clip(stderr)}`);
        }
        return {
            content: sections.join("\n\n"),
            isError: code !== 0,
            summary: `\`${command}\` exited ${code}${timedOut ? " (timeout)" : ""}`,
        };
    },
};


/***/ }),
/* 47 */
/***/ ((module) => {

module.exports = require("child_process");

/***/ }),
/* 48 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getWorkspaceRoot = getWorkspaceRoot;
exports.toRelative = toRelative;
exports.resolvePathInWorkspace = resolvePathInWorkspace;
const vscode = __importStar(__webpack_require__(1));
const path = __importStar(__webpack_require__(49));
const types_1 = __webpack_require__(29);
/** The first open workspace folder, or undefined if none is open. */
function getWorkspaceRoot() {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}
/** Path of `uri` relative to `root`, using forward slashes for display. */
function toRelative(root, uri) {
    if (!root) {
        return uri.fsPath;
    }
    const rel = path.relative(root.fsPath, uri.fsPath);
    return rel === "" ? "." : rel.split(path.sep).join("/");
}
/** True if `candidate` is the root itself or nested strictly inside it. */
function isInside(root, candidate) {
    const rel = path.relative(root, candidate);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
/**
 * Resolve a model-supplied path to an absolute Uri, confined to the workspace.
 *
 * - No workspace open → hard error (nothing is in scope).
 * - Resolves relative paths against the workspace root; absolute paths are honored.
 * - If the result escapes the workspace root, require an explicit modal approval;
 *   denial throws {@link ToolDeniedError}. This is the single choke point that
 *   enforces "never access files outside the workspace unless I approve it".
 */
async function resolvePathInWorkspace(input, root, confirm) {
    if (!root) {
        throw new types_1.ToolError("No workspace folder is open, so there is no project to operate on.");
    }
    const trimmed = input.trim();
    if (!trimmed) {
        throw new types_1.ToolError("An empty path is not valid.");
    }
    const absolute = path.isAbsolute(trimmed)
        ? path.normalize(trimmed)
        : path.normalize(path.join(root.fsPath, trimmed));
    if (!isInside(root.fsPath, absolute)) {
        const approved = await confirm("Allow access outside the workspace?", `The agent wants to access:\n${absolute}\n\nThis is outside the current workspace root:\n${root.fsPath}`);
        if (!approved) {
            throw new types_1.ToolDeniedError(`Access denied: "${trimmed}" is outside the workspace and approval was declined.`);
        }
    }
    return vscode.Uri.file(absolute);
}


/***/ }),
/* 49 */
/***/ ((module) => {

module.exports = require("path");

/***/ })
/******/ 	]);
/************************************************************************/
/******/ 	// The module cache
/******/ 	const __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		const cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		const module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	let __webpack_exports__ = __webpack_require__(0);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;
//# sourceMappingURL=extension.js.map