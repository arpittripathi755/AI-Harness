import { LLMClient, type LLMClientOptions } from "../llm/LLMClient";
import type { ChatMessage, ContentPart, ToolCall } from "../llm/types";
import type { ToolContext } from "../tools/types";
import { ToolRegistry } from "../tools/registry";
import type { AgentStatus } from "../shared/protocol";
import {
  getModelByApiId,
  modelSupportsTools,
  modelSupportsVision,
} from "../shared/models";

/** Product name shown to the user and used in the agent's self-identity. */
export const AGENT_NAME = "Axiom";

/** Safety bound on tool round-trips within a single user turn. */
const MAX_ITERATIONS = 25;

function buildSystemPrompt(
  modelDisplay: string,
  workspaceName: string | undefined,
  root: string | undefined,
  allowMutations: boolean,
): string {
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

  return `You are ${AGENT_NAME}, an autonomous AI coding assistant embedded in VS Code.

Your name is ${AGENT_NAME}. You are currently powered by the "${modelDisplay}" model,
served through an OpenAI-compatible API. If the user asks which model or AI you are,
answer honestly that you are ${AGENT_NAME} running on the "${modelDisplay}" model.

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
function modelDisplayName(apiModelId: string): string {
  return getModelByApiId(apiModelId)?.displayName ?? apiModelId;
}

/** Map a tool name to a live status shown while it runs. */
function statusForTool(name: string): AgentStatus {
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

export interface TurnCallbacks {
  onAssistantStart: (id: string) => void;
  onAssistantDelta: (id: string, delta: string) => void;
  onAssistantDone: (id: string) => void;
  onToolStart: (callId: string, name: string, title: string) => void;
  onToolEnd: (callId: string, ok: boolean, summary: string) => void;
  /** Live status of what the agent is currently doing. */
  onStatus: (status: AgentStatus) => void;
  onError: (message: string) => void;
}

/**
 * Owns conversation state and runs the agentic loop: stream a turn, execute any
 * tool calls via the registry (dynamic dispatch by name), feed results back, and
 * repeat until the model responds without tool calls. Model, mode, and endpoint
 * can all be changed live between turns.
 */
export class ChatSession {
  private messages: ChatMessage[];
  private abortController: AbortController | undefined;
  private counter = 0;
  /** Whether the current model supports tool calling on this endpoint. */
  private toolsSupported: boolean;
  /** Whether the current model accepts image inputs. */
  private visionSupported: boolean;
  /** Display name of the current model, injected into the system prompt. */
  private modelDisplay: string;

  constructor(
    private readonly client: LLMClient,
    private readonly registry: ToolRegistry,
    private readonly ctx: ToolContext,
    private readonly workspaceName: string | undefined,
    private allowMutations: boolean,
    initialModelId: string,
    seedHistory?: ChatMessage[],
  ) {
    this.toolsSupported = modelSupportsTools(initialModelId);
    this.visionSupported = modelSupportsVision(initialModelId);
    this.modelDisplay = modelDisplayName(initialModelId);
    this.messages = [{ role: "system", content: this.systemPrompt() }];
    if (seedHistory && seedHistory.length) {
      this.messages.push(...seedHistory);
    }
  }

  static create(
    opts: LLMClientOptions,
    registry: ToolRegistry,
    ctx: ToolContext,
    workspaceName: string | undefined,
    allowMutations: boolean,
    seedHistory?: ChatMessage[],
  ): ChatSession {
    return new ChatSession(
      new LLMClient(opts),
      registry,
      ctx,
      workspaceName,
      allowMutations,
      opts.model,
      seedHistory,
    );
  }

  /** Conversation history excluding the system prompt (for persistence). */
  exportHistory(): ChatMessage[] {
    return this.messages.slice(1);
  }

  private systemPrompt(): string {
    return buildSystemPrompt(
      this.modelDisplay,
      this.workspaceName,
      this.ctx.workspaceRoot?.fsPath,
      this.allowMutations,
    );
  }

  /** Refresh the system message in place after a live model/mode change. */
  private refreshSystemPrompt(): void {
    this.messages[0] = { role: "system", content: this.systemPrompt() };
  }

  /** Build user-message content, attaching images only for vision models. */
  private buildUserContent(
    text: string,
    images?: string[],
  ): string | ContentPart[] {
    if (!images || images.length === 0 || !this.visionSupported) {
      return text;
    }
    const parts: ContentPart[] = [];
    if (text) {
      parts.push({ type: "text", text });
    }
    for (const url of images) {
      parts.push({ type: "image_url", image_url: { url } });
    }
    return parts;
  }

  get busy(): boolean {
    return this.abortController !== undefined;
  }

  /** Change the model live (no restart, applies to the next request). */
  setModel(apiModelId: string): void {
    this.client.setModel(apiModelId);
    this.toolsSupported = modelSupportsTools(apiModelId);
    this.visionSupported = modelSupportsVision(apiModelId);
    this.modelDisplay = modelDisplayName(apiModelId);
    this.refreshSystemPrompt();
  }

  /** Change the agent mode live; updates the system prompt and tool availability. */
  setMode(allowMutations: boolean): void {
    this.allowMutations = allowMutations;
    this.refreshSystemPrompt();
  }

  /** Update the endpoint (base URL / API key) live. */
  setEndpoint(baseUrl: string, apiKey: string): void {
    this.client.setEndpoint(baseUrl, apiKey);
  }

  reset(): void {
    this.cancel();
    this.messages = [{ role: "system", content: this.systemPrompt() }];
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = undefined;
  }

  /**
   * Run one user turn to completion (may involve several tool round-trips).
   * `images` are data-URL strings; they are attached only for vision-capable
   * models and silently omitted otherwise (no error).
   */
  async send(
    userText: string,
    cb: TurnCallbacks,
    images?: string[],
  ): Promise<void> {
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

      cb.onError(
        `Stopped after ${MAX_ITERATIONS} tool iterations without a final answer.`,
      );
    } catch (err) {
      if (controller.signal.aborted) {
        return; // user cancelled; state already recorded up to this point
      }
      cb.onError(friendlyError(err instanceof Error ? err.message : String(err)));
    } finally {
      if (this.abortController === controller) {
        this.abortController = undefined;
      }
    }
  }

  private async runToolCall(call: ToolCall, cb: TurnCallbacks): Promise<void> {
    const name = call.function.name;
    const tool = this.registry.get(name);

    let args: Record<string, unknown> = {};
    let parseError: string | undefined;
    try {
      args = call.function.arguments
        ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
        : {};
    } catch {
      parseError = `Invalid JSON arguments: ${call.function.arguments}`;
    }

    const title = describeCall(name, args);
    cb.onStatus(statusForTool(name));
    cb.onToolStart(call.id, name, title);

    let content: string;
    let ok = false;
    let summary: string;

    if (!tool) {
      content = `Error: unknown tool "${name}".`;
      summary = `Unknown tool: ${name}`;
    } else if (parseError) {
      content = `Error: ${parseError}`;
      summary = parseError;
    } else if (!this.allowMutations && tool.mutates) {
      // Defense in depth: mutating tools aren't advertised in Plan mode, but if a
      // model calls one anyway, refuse it cleanly rather than editing files.
      content =
        `Refused: "${name}" modifies files and is disabled in Plan mode. ` +
        `Describe the change instead, and tell the user to switch to Auto Edit mode to apply it.`;
      summary = "Blocked in Plan mode";
    } else {
      try {
        const result = await tool.execute(args, this.ctx);
        content = result.content;
        ok = !result.isError;
        summary = result.summary ?? (ok ? "Done" : "Failed");
      } catch (err) {
        content = `Error: ${err instanceof Error ? err.message : String(err)}`;
        summary = err instanceof Error ? err.message : "Failed";
      }
    }

    this.messages.push({ role: "tool", tool_call_id: call.id, content });
    cb.onToolEnd(call.id, ok, summary);
  }
}

/** Short human title for a tool card, e.g. `read_file → src/foo.ts`. */
function describeCall(name: string, args: Record<string, unknown>): string {
  const hint =
    (typeof args.path === "string" && args.path) ||
    (typeof args.query === "string" && args.query) ||
    (typeof args.command === "string" && args.command) ||
    "";
  return hint ? `${name} → ${hint}` : name;
}

/** Turn raw endpoint errors into actionable guidance where we recognize them. */
function friendlyError(message: string): string {
  if (/\b429\b|rate limit|too many requests/i.test(message)) {
    return (
      "Rate limit reached on the Lightning endpoint. The agent automatically " +
      "retried with backoff, but the limit is still in effect. Wait a minute and " +
      "try again, or upgrade your Lightning tier for a higher request rate."
    );
  }
  if (/reasoning_effort|\/v1\/responses|tools?.*not supported/i.test(message)) {
    return (
      "This model doesn't support tool calling on the Lightning chat/completions " +
      "endpoint, so it can't act as a file-editing agent. Pick a Claude model " +
      "(e.g. Claude Opus 4.8) for full agent capabilities.\n\n" +
      `Endpoint said: ${message}`
    );
  }
  return message;
}
