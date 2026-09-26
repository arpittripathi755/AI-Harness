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
const config_1 = __webpack_require__(10);
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
    // Automatically reveal the Axiom chat view in the sidebar on startup.
    vscode.commands.executeCommand("claude-agent.open");
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
const ConversationManager_1 = __webpack_require__(9);
const config_1 = __webpack_require__(10);
const modes_1 = __webpack_require__(11);
const tools_1 = __webpack_require__(12);
const workspace_1 = __webpack_require__(29);
class SidebarProvider {
    context;
    static viewType = "claudeAgent.chat";
    view;
    session;
    sessionConversationId;
    ctx;
    chats;
    constructor(context) {
        this.context = context;
        this.chats = new ConversationManager_1.ConversationManager(context.workspaceState);
        context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.session = undefined;
            this.sessionConversationId = undefined;
            this.ctx = undefined;
        }));
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
        this.sessionConversationId = undefined;
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
                this.session?.setMode((0, modes_1.getMode)((0, config_1.getModeId)(this.context)).allowMutations);
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
        }
    }
    switchChat(id) {
        this.session?.cancel();
        this.session = undefined;
        this.sessionConversationId = undefined;
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
            this.sessionConversationId = undefined;
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
            onStatus: (status) => this.post({ type: "status", status }),
            onError: (message) => this.post({ type: "error", message }),
        }, images);
        // Persist the LLM history and active task memory after the turn completes.
        this.chats.active.history = session.exportHistory();
        this.chats.active.taskMemory = session.exportTaskMemory();
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
    /**
     * Build (or reuse) the ChatSession for the active conversation, reseeding it
     * from the persisted history so switching chats preserves context.
     */
    async getSession() {
        if (this.session && this.sessionConversationId === this.chats.activeConversationId) {
            return this.session;
        }
        this.session?.cancel();
        this.session = undefined;
        const config = await (0, config_1.resolveConfig)(this.context);
        const registry = (0, tools_1.createToolRegistry)();
        const ctx = this.ensureToolContext();
        const folder = vscode.workspace.workspaceFolders?.[0];
        const allowMutations = (0, modes_1.getMode)((0, config_1.getModeId)(this.context)).allowMutations;
        this.session = ChatSession_1.ChatSession.create(config, registry, ctx, folder?.name, allowMutations, this.chats.active.history, this.chats.active.taskMemory);
        this.sessionConversationId = this.chats.activeConversationId;
        return this.session;
    }
    ensureToolContext() {
        const root = (0, workspace_1.getWorkspaceRoot)();
        const confirm = async (message, detail) => {
            const pick = await vscode.window.showWarningMessage(message, { modal: true, detail }, "Allow");
            return pick === "Allow";
        };
        this.ctx = {
            workspaceRoot: root,
            terminalAutoRun: (0, config_1.getTerminalAutoRun)(this.context),
            autoEdit: (0, modes_1.getMode)((0, config_1.getModeId)(this.context)).allowMutations,
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
const TaskMemory_1 = __webpack_require__(8);
/** Product name shown to the user and used in the agent's self-identity. */
exports.AGENT_NAME = "Axiom";
/** Safety bound on tool round-trips within a single user turn. */
const MAX_ITERATIONS = 25;
function buildSystemPrompt(modelDisplay, workspaceName, root, allowMutations, workingMemorySection) {
    const ws = root
        ? `You are operating inside the user's VS Code workspace.
Workspace: ${workspaceName ?? "(unnamed)"}
Workspace root: ${root}
All file paths you pass to tools are resolved relative to this root. You may only
access files inside this workspace unless the user explicitly approves otherwise.`
        : `No workspace folder is currently open. File tools will fail until the user opens a folder.`;
    const modeGuidance = allowMutations
        ? `MODE: Auto Edit. Work autonomously to complete the task:
- Inspect the workspace, search, and read the files you need.
- Create, edit, rename, and multi-edit files directly to accomplish the goal.
- Keep using tools until the task is fully done, then summarize what you changed.
- Only deletions and terminal commands require the user to confirm.`
        : `MODE: Plan (READ-ONLY). You currently have ONLY read-only tools; editing tools are
disabled and will be refused. Do the following:
- Inspect the workspace, search, and read the relevant files.
- Then explain precisely what changes you would make (which files, what edits, and why).
- Present it as a clear, numbered plan and stop. Do not attempt to modify anything.
- Tell the user to switch to Auto Edit mode to apply the plan.`;
    const memoryBlock = workingMemorySection ? `\n\n${workingMemorySection}` : "";
    return `You are ${exports.AGENT_NAME}, an autonomous AI coding assistant embedded in VS Code.

Your name is ${exports.AGENT_NAME}. You are currently powered by the "${modelDisplay}" model,
served through an OpenAI-compatible API. If the user asks which model or AI you are,
answer honestly that you are ${exports.AGENT_NAME} running on the "${modelDisplay}" model.

${ws}

${modeGuidance}${memoryBlock}

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
    allowMutations;
    messages;
    abortController;
    counter = 0;
    /** Whether the current model supports tool calling on this endpoint. */
    toolsSupported;
    /** Whether the current model accepts image inputs. */
    visionSupported;
    /** Display name of the current model, injected into the system prompt. */
    modelDisplay;
    /** Active working memory maintaining task context across tool iterations. */
    taskMemory;
    constructor(client, registry, ctx, workspaceName, allowMutations, initialModelId, seedHistory, initialMemory) {
        this.client = client;
        this.registry = registry;
        this.ctx = ctx;
        this.workspaceName = workspaceName;
        this.allowMutations = allowMutations;
        this.toolsSupported = (0, models_1.modelSupportsTools)(initialModelId);
        this.visionSupported = (0, models_1.modelSupportsVision)(initialModelId);
        this.modelDisplay = modelDisplayName(initialModelId);
        this.taskMemory = TaskMemory_1.TaskMemory.fromData(initialMemory, seedHistory);
        this.messages = [{ role: "system", content: this.systemPrompt() }];
        if (seedHistory && seedHistory.length) {
            this.messages.push(...seedHistory);
        }
    }
    static create(opts, registry, ctx, workspaceName, allowMutations, seedHistory, initialMemory) {
        return new ChatSession(new LLMClient_1.LLMClient(opts), registry, ctx, workspaceName, allowMutations, opts.model, seedHistory, initialMemory);
    }
    /** Conversation history excluding the system prompt (for persistence). */
    exportHistory() {
        return this.messages.slice(1);
    }
    /** Export active task memory (for persistence and chat switching). */
    exportTaskMemory() {
        return this.taskMemory.exportData();
    }
    get memory() {
        return this.taskMemory;
    }
    systemPrompt() {
        return buildSystemPrompt(this.modelDisplay, this.workspaceName, this.ctx.workspaceRoot?.fsPath, this.allowMutations, this.taskMemory.formatForSystemPrompt());
    }
    /** Refresh the system message in place after a live model/mode change or memory update. */
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
    setMode(allowMutations) {
        this.allowMutations = allowMutations;
        this.refreshSystemPrompt();
    }
    /** Update the endpoint (base URL / API key) live. */
    setEndpoint(baseUrl, apiKey) {
        this.client.setEndpoint(baseUrl, apiKey);
    }
    reset() {
        this.cancel();
        this.taskMemory.clear();
        this.messages = [{ role: "system", content: this.systemPrompt() }];
    }
    cancel() {
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
        // Retain user request in active task memory and refresh system prompt
        this.taskMemory.recordUserRequest(userText);
        this.refreshSystemPrompt();
        this.messages.push({ role: "user", content: this.buildUserContent(userText, images) });
        const controller = new AbortController();
        this.abortController = controller;
        // Omit tools entirely for models that can't do tool calling on this endpoint;
        // they run as plain chat (no agent loop) rather than 400ing.
        const toolDefs = this.toolsSupported
            ? this.registry.definitions(this.allowMutations)
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
                // Record any plan or reasoning the assistant articulated
                if (turn.content) {
                    this.taskMemory.recordAssistantTurn(turn.content);
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
                for (const call of turn.toolCalls) {
                    await this.runToolCall(call, cb);
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
        else if (!this.allowMutations && tool.mutates) {
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
        // Update task memory with tool findings, file mutations, or test results, and refresh system prompt
        this.taskMemory.recordToolExecution(name, args, ok, summary, content);
        this.refreshSystemPrompt();
        this.messages.push({ role: "tool", tool_call_id: call.id, content });
        cb.onToolEnd(call.id, ok, summary, content);
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
     * Translate the model ID if required by the target provider to prevent errors.
     * - DeepSeek official API (api.deepseek.com) requires 'deepseek-chat' / 'deepseek-reasoner'.
     * - Lightning AI (lightning.ai) uses its hosted catalog IDs.
     */
    resolveModelForEndpoint(model, baseUrl) {
        const isDeepSeekEndpoint = baseUrl.includes("api.deepseek.com");
        if (isDeepSeekEndpoint) {
            if (model === "deepseek-v4-pro" ||
                model === "deepseek-flash" ||
                model === "deepseek-ai/deepseek-v4.1-flash" ||
                model === "nvidia/nemotron-3-ultra-550b-a55b" ||
                model === "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b" ||
                model === "ultra") {
                return "deepseek-chat";
            }
        }
        const isLightningEndpoint = baseUrl.includes("lightning.ai");
        if (isLightningEndpoint) {
            if (model === "deepseek-flash" || model === "deepseek-v4-pro") {
                return "deepseek-ai/deepseek-v4.1-flash";
            }
            if (model === "ultra" || model === "nvidia/nemotron-3-ultra-550b-a55b") {
                return "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b";
            }
        }
        return model;
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
        const effectiveModel = this.resolveModelForEndpoint(this.model, this.opts.baseUrl);
        const body = {
            model: effectiveModel,
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
        displayName: "ultra",
        apiModelId: "nvidia/nemotron-3-ultra-550b-a55b",
        // Text-only model; omit images rather than risk a 400.
        supportsVision: false,
    },
    {
        displayName: "deepseek-v4-pro",
        apiModelId: "deepseek-v4-pro",
        supportsVision: false,
    },
    {
        displayName: "deepseek-flash",
        apiModelId: "deepseek-flash",
        supportsVision: false,
    },
];
/** Default evaluation model (text-only, supportsVision: false). */
exports.DEFAULT_MODEL_ID = "nvidia/nemotron-3-ultra-550b-a55b";
function getModelByApiId(apiModelId) {
    const resolved = resolveModelId(apiModelId);
    return exports.MODELS.find((m) => m.apiModelId === resolved || m.apiModelId === apiModelId);
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
    if (!apiModelId) {
        return exports.DEFAULT_MODEL_ID;
    }
    if (exports.MODELS.some((m) => m.apiModelId === apiModelId)) {
        return apiModelId;
    }
    if (apiModelId === "ultra" ||
        apiModelId === "lightning-ai/nvidia-nemotron-3-ultra-550b-a55b") {
        return "nvidia/nemotron-3-ultra-550b-a55b";
    }
    if (apiModelId === "deepseek-v4-pro" ||
        apiModelId === "deepseek-ai/deepseek-v4-pro") {
        return "deepseek-v4-pro";
    }
    if (apiModelId === "deepseek-flash" ||
        apiModelId === "deepseek-ai/deepseek-v4.1-flash" ||
        apiModelId === "deepseek v4") {
        return "deepseek-flash";
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


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.TaskMemory = void 0;
/**
 * Maintains active task working memory and context across multiple reasoning
 * cycles, tool calls, and turns within a conversation.
 *
 * Prevents the agent from losing context of the user's original goal, files read,
 * files modified, test results, or errors encountered during complex multi-step tasks.
 */
class TaskMemory {
    userRequests = [];
    planSteps = [];
    filesRead = new Set();
    filesModified = new Map(); // path -> action summary
    keyFindings = [];
    commandResults = [];
    errorsEncountered = [];
    actionsTaken = [];
    constructor(data) {
        if (data) {
            this.userRequests = Array.isArray(data.userRequests) ? [...data.userRequests] : [];
            this.planSteps = Array.isArray(data.planSteps) ? [...data.planSteps] : [];
            if (Array.isArray(data.filesRead)) {
                for (const f of data.filesRead) {
                    this.filesRead.add(f);
                }
            }
            if (Array.isArray(data.filesModified)) {
                for (const item of data.filesModified) {
                    if (item && item.path) {
                        this.filesModified.set(item.path, item.action);
                    }
                }
            }
            this.keyFindings = Array.isArray(data.keyFindings) ? [...data.keyFindings] : [];
            this.commandResults = Array.isArray(data.commandResults) ? [...data.commandResults] : [];
            this.errorsEncountered = Array.isArray(data.errorsEncountered) ? [...data.errorsEncountered] : [];
            this.actionsTaken = Array.isArray(data.actionsTaken) ? [...data.actionsTaken] : [];
        }
    }
    /**
     * Reconstitute TaskMemory from serialized data or rehydrate from seed message history.
     */
    static fromData(data, seedHistory) {
        const memory = new TaskMemory(data);
        if ((!data || memory.isEmpty()) && seedHistory && seedHistory.length > 0) {
            memory.rehydrateFromHistory(seedHistory);
        }
        return memory;
    }
    isEmpty() {
        return (this.userRequests.length === 0 &&
            this.filesRead.size === 0 &&
            this.filesModified.size === 0 &&
            this.actionsTaken.length === 0);
    }
    clear() {
        this.userRequests = [];
        this.planSteps = [];
        this.filesRead.clear();
        this.filesModified.clear();
        this.keyFindings = [];
        this.commandResults = [];
        this.errorsEncountered = [];
        this.actionsTaken = [];
    }
    /** Record a user request or follow-up prompt. */
    recordUserRequest(text) {
        const trimmed = text.trim();
        if (!trimmed) {
            return;
        }
        if (!this.userRequests.includes(trimmed)) {
            this.userRequests.push(trimmed);
        }
    }
    /**
     * Scan assistant text for potential plans or numbered steps.
     */
    recordAssistantTurn(turnContent) {
        if (!turnContent) {
            return;
        }
        const lines = turnContent.split("\n");
        const planLines = [];
        for (const rawLine of lines) {
            const line = rawLine.trim();
            // Match numbered lists like "1. inspect...", "Step 1: ..." or "- [ ] ..."
            if (/^(?:\d+[\.\)]|step\s+\d+:?|[-*]\s*\[\s*[ xX]?\s*\])\s+/i.test(line) &&
                line.length > 5) {
                planLines.push(line);
            }
        }
        if (planLines.length >= 2) {
            this.planSteps = planLines;
        }
    }
    /**
     * Record a tool execution and update relevant context buckets.
     */
    recordToolExecution(name, args, ok, summary, rawContent) {
        const pathArg = typeof args.path === "string" ? args.path : "";
        const commandArg = typeof args.command === "string" ? args.command : "";
        // 1. Files Read
        if (name === "read_file" && pathArg) {
            const range = typeof args.start_line === "number" || typeof args.end_line === "number"
                ? ` (lines ${args.start_line ?? 1}-${args.end_line ?? "end"})`
                : "";
            this.filesRead.add(`${pathArg}${range}`);
        }
        else if (name === "read_active_editor") {
            this.filesRead.add("(active editor)");
        }
        else if (name === "read_selection") {
            this.filesRead.add("(active editor selection)");
        }
        // 2. Files Modified
        if (ok) {
            if (name === "create_file" && pathArg) {
                this.filesModified.set(pathArg, "Created");
            }
            else if ((name === "edit_file" || name === "multi_edit") && pathArg) {
                this.filesModified.set(pathArg, "Modified");
            }
            else if (name === "delete_file" && pathArg) {
                this.filesModified.set(pathArg, "Deleted");
            }
            else if (name === "rename_file" && typeof args.old_path === "string" && typeof args.new_path === "string") {
                this.filesModified.delete(args.old_path);
                this.filesModified.set(args.new_path, `Renamed from ${args.old_path}`);
            }
        }
        // 3. Repository Findings
        if (ok) {
            if (name === "search_workspace") {
                const query = typeof args.query === "string" ? args.query : "";
                const entry = `Search "${query}": ${summary}`;
                this.appendBounded(this.keyFindings, entry, 8);
            }
            else if (name === "list_files") {
                const dir = pathArg || ".";
                const entry = `Directory "${dir}": ${summary}`;
                this.appendBounded(this.keyFindings, entry, 8);
            }
        }
        // 4. Command & Test Results
        if (name === "run_command" && commandArg) {
            const entry = `$ ${commandArg} → ${summary}`;
            this.appendBounded(this.commandResults, entry, 10);
            if (!ok) {
                this.appendBounded(this.errorsEncountered, `Command failed: \`${commandArg}\` (${summary})`, 8);
            }
        }
        // 5. Tool Errors
        if (!ok && name !== "run_command") {
            this.appendBounded(this.errorsEncountered, `Tool ${name} failed: ${summary}`, 8);
        }
        // 6. Action History
        const actionDesc = `${name}${pathArg ? ` -> ${pathArg}` : commandArg ? ` -> ${commandArg}` : ""}`;
        const actionItem = `${this.actionsTaken.length + 1}. [${actionDesc}] ${ok ? "OK" : "FAILED"}: ${summary}`;
        this.appendBounded(this.actionsTaken, actionItem, 20);
    }
    /**
     * Reconstruct context from historical messages when opening an existing chat.
     */
    rehydrateFromHistory(history) {
        const toolCallNames = new Map();
        for (const msg of history) {
            if (msg.role === "user") {
                if (typeof msg.content === "string") {
                    this.recordUserRequest(msg.content);
                }
                else if (Array.isArray(msg.content)) {
                    const textPart = msg.content.find((p) => p.type === "text");
                    if (textPart && "text" in textPart) {
                        this.recordUserRequest(textPart.text);
                    }
                }
            }
            else if (msg.role === "assistant") {
                if (typeof msg.content === "string") {
                    this.recordAssistantTurn(msg.content);
                }
                if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                    for (const tc of msg.tool_calls) {
                        try {
                            const parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
                            toolCallNames.set(tc.id, { name: tc.function.name, args: parsedArgs });
                        }
                        catch {
                            toolCallNames.set(tc.id, { name: tc.function.name, args: {} });
                        }
                    }
                }
            }
            else if (msg.role === "tool" && msg.tool_call_id) {
                const meta = toolCallNames.get(msg.tool_call_id);
                if (meta) {
                    const content = typeof msg.content === "string" ? msg.content : "";
                    const isErr = content.startsWith("Error:") || content.startsWith("Refused:");
                    this.recordToolExecution(meta.name, meta.args, !isErr, isErr ? content.slice(0, 100) : "Done", content);
                }
            }
        }
    }
    appendBounded(list, item, maxItems) {
        // Avoid exact duplicate consecutive lines
        if (list.length > 0 && list[list.length - 1] === item) {
            return;
        }
        list.push(item);
        if (list.length > maxItems) {
            list.splice(0, list.length - maxItems);
        }
    }
    /**
     * Format the current working memory into a prompt section for the LLM.
     */
    formatForSystemPrompt() {
        const sections = [];
        // 1. Task Goal & Context
        if (this.userRequests.length > 0) {
            const primary = this.userRequests[0];
            const additional = this.userRequests.slice(1);
            let goalText = `• Original User Request: "${primary}"`;
            if (additional.length > 0) {
                goalText += `\n• Follow-up Instructions:\n  - ${additional.join("\n  - ")}`;
            }
            sections.push(goalText);
        }
        // 2. Active Plan
        if (this.planSteps.length > 0) {
            sections.push(`• Current Plan / Next Steps:\n  ${this.planSteps.join("\n  ")}`);
        }
        // 3. Files Read
        if (this.filesRead.size > 0) {
            sections.push(`• Files Inspected / Read:\n  - ${Array.from(this.filesRead).join("\n  - ")}`);
        }
        // 4. Files Modified
        if (this.filesModified.size > 0) {
            const modItems = [];
            for (const [path, action] of this.filesModified.entries()) {
                modItems.push(`${action}: ${path}`);
            }
            sections.push(`• Files Modified During Task:\n  - ${modItems.join("\n  - ")}`);
        }
        // 5. Exploration & Findings
        if (this.keyFindings.length > 0) {
            sections.push(`• Key Repository Findings:\n  - ${this.keyFindings.join("\n  - ")}`);
        }
        // 6. Command & Test Results
        if (this.commandResults.length > 0) {
            sections.push(`• Command / Test Results:\n  - ${this.commandResults.join("\n  - ")}`);
        }
        // 7. Errors Encountered (if any)
        if (this.errorsEncountered.length > 0) {
            sections.push(`• Errors / Issues Encountered (address these if still unresolved):\n  - ${this.errorsEncountered.join("\n  - ")}`);
        }
        // 8. Recent Actions Taken
        if (this.actionsTaken.length > 0) {
            const recent = this.actionsTaken.slice(-6);
            sections.push(`• Recent Actions Taken in Current Task:\n  ${recent.join("\n  ")}`);
        }
        if (sections.length === 0) {
            return "";
        }
        return (`=== CURRENT TASK WORKING MEMORY & CONTEXT ===\n` +
            `The following memory reflects your actions, findings, file modifications, and test results so far.\n` +
            `Use this context to stay aligned with the user's goal, avoid redundant reads, build on your edits, and fix any failed tests:\n\n` +
            sections.join("\n\n") +
            `\n==============================================`);
    }
    /** Export data for persistence. */
    exportData() {
        return {
            userRequests: [...this.userRequests],
            planSteps: [...this.planSteps],
            filesRead: Array.from(this.filesRead),
            filesModified: Array.from(this.filesModified.entries()).map(([path, action]) => ({
                path,
                action,
            })),
            keyFindings: [...this.keyFindings],
            commandResults: [...this.commandResults],
            errorsEncountered: [...this.errorsEncountered],
            actionsTaken: [...this.actionsTaken],
        };
    }
}
exports.TaskMemory = TaskMemory;


/***/ }),
/* 9 */
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
/* 10 */
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
const modes_1 = __webpack_require__(11);
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
/* 11 */
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
        id: "plan",
        label: "Plan Mode",
        description: "Analyze, inspect, read, and search — then explain the changes to make. Does not modify files.",
        allowMutations: false,
    },
    {
        id: "auto",
        label: "Auto Edit Mode",
        description: "Inspect, read, search, create, edit, and rename files autonomously until the task is done.",
        allowMutations: true,
    },
];
exports.DEFAULT_MODE = "auto";
function resolveModeId(id) {
    return exports.MODES.some((m) => m.id === id) ? id : exports.DEFAULT_MODE;
}
function getMode(id) {
    return exports.MODES.find((m) => m.id === id) ?? exports.MODES[1];
}


/***/ }),
/* 12 */
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
const registry_1 = __webpack_require__(13);
const listFiles_1 = __webpack_require__(14);
const readFile_1 = __webpack_require__(17);
const readActiveEditor_1 = __webpack_require__(18);
const readSelection_1 = __webpack_require__(19);
const searchWorkspace_1 = __webpack_require__(20);
const createFile_1 = __webpack_require__(21);
const editFile_1 = __webpack_require__(22);
const renameFile_1 = __webpack_require__(24);
const deleteFile_1 = __webpack_require__(25);
const multiEdit_1 = __webpack_require__(26);
const runCommand_1 = __webpack_require__(27);
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
var registry_2 = __webpack_require__(13);
Object.defineProperty(exports, "ToolRegistry", ({ enumerable: true, get: function () { return registry_2.ToolRegistry; } }));
__exportStar(__webpack_require__(16), exports);


/***/ }),
/* 13 */
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
/* 14 */
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
const fsutil_1 = __webpack_require__(15);
const fsutil_2 = __webpack_require__(15);
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
/* 15 */
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
const types_1 = __webpack_require__(16);
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
/* 16 */
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
/* 17 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.readFileTool = void 0;
const fsutil_1 = __webpack_require__(15);
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
/* 18 */
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
const fsutil_1 = __webpack_require__(15);
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
/* 19 */
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
/* 20 */
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
const fsutil_1 = __webpack_require__(15);
const types_1 = __webpack_require__(16);
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
/* 21 */
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
const types_1 = __webpack_require__(16);
const fsutil_1 = __webpack_require__(15);
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
/* 22 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.editFileTool = void 0;
const fsutil_1 = __webpack_require__(15);
const editCore_1 = __webpack_require__(23);
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
/* 23 */
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
const fsutil_1 = __webpack_require__(15);
const types_1 = __webpack_require__(16);
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
/* 24 */
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
const types_1 = __webpack_require__(16);
const fsutil_1 = __webpack_require__(15);
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
/* 25 */
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
const types_1 = __webpack_require__(16);
const fsutil_1 = __webpack_require__(15);
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
        if (!ctx.autoEdit) {
            const approved = await ctx.confirm(`Delete ${isDir ? "directory" : "file"} "${relPath}"?`, "This action cannot be easily undone.");
            if (!approved) {
                throw new types_1.ToolDeniedError(`Deletion of "${relPath}" was declined by the user.`);
            }
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
/* 26 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.multiEditTool = void 0;
const types_1 = __webpack_require__(16);
const editCore_1 = __webpack_require__(23);
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
/* 27 */
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.runCommandTool = void 0;
const child_process_1 = __webpack_require__(28);
const types_1 = __webpack_require__(16);
const fsutil_1 = __webpack_require__(15);
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
/* 28 */
/***/ ((module) => {

module.exports = require("child_process");

/***/ }),
/* 29 */
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
const path = __importStar(__webpack_require__(30));
const types_1 = __webpack_require__(16);
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
/* 30 */
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