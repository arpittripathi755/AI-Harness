import { LLMClient, type LLMClientOptions } from "../llm/LLMClient";
import type { ChatMessage, ContentPart, ToolCall } from "../llm/types";
import type { ToolContext } from "../tools/types";
import { ToolRegistry } from "../tools/registry";
import type { AgentStatus } from "../shared/protocol";
import { LoopDetector } from "./LoopDetector";
import {
  Orchestrator,
  DEFAULT_BUDGET,
  detectRepoProfile,
  PHASE_LABELS,
  type RepoProfile,
} from "./Orchestrator";
import {
  getModelByApiId,
  modelSupportsTools,
  modelSupportsVision,
} from "../shared/models";

import { TaskMemory, type TaskMemoryData } from "./TaskMemory";

/** Product name shown to the user and used in the agent's self-identity. */
export const AGENT_NAME = "Axiom";

function buildSystemPrompt(
  modelDisplay: string,
  workspaceName: string | undefined,
  root: string | undefined,
  allowMutations: boolean,
  workingMemorySection?: string,
  orchestrator?: Orchestrator,
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
- Only deletions and terminal commands require the user to confirm.
- IMPORTANT: After making file changes, run the test/build command if one exists to verify correctness.`
    : `MODE: Plan (READ-ONLY). You currently have ONLY read-only tools; editing tools are
disabled and will be refused. Do the following:
- Inspect the workspace, search, and read the relevant files.
- Then explain precisely what changes you would make (which files, what edits, and why).
- Present it as a clear, numbered plan and stop. Do not attempt to modify anything.
- Tell the user to switch to Auto Edit mode to apply the plan.`;

  const memoryBlock = workingMemorySection ? `\n\n${workingMemorySection}` : "";

  // Phase and repo profile context injected when an orchestrator is active
  let phaseBlock = "";
  if (orchestrator) {
    const phaseLabel = PHASE_LABELS[orchestrator.phase];
    phaseBlock = `\n\nCurrent task phase: ${phaseLabel}`;
    const profile = orchestrator.formatProfileForPrompt();
    if (profile) {
      phaseBlock += `\nRepository info (cached):\n${profile}`;
    }
    if (orchestrator.testCommand && orchestrator.phase === "EDITING") {
      phaseBlock +=
        `\n\nVerification gate: You MUST run \`${orchestrator.testCommand}\` after editing ` +
        `files to verify correctness. Do not declare the task done without attempting this.`;
    }
  }

  return `You are ${AGENT_NAME}, an autonomous AI coding assistant embedded in VS Code.

Your name is ${AGENT_NAME}. You are currently powered by the "${modelDisplay}" model,
served through an OpenAI-compatible API. If the user asks which model or AI you are,
answer honestly that you are ${AGENT_NAME} running on the "${modelDisplay}" model.

${ws}

${modeGuidance}${memoryBlock}${phaseBlock}

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
      return "Searching workspace\u2026";
    case "list_files":
    case "read_file":
    case "read_active_editor":
    case "read_selection":
      return "Reading files\u2026";
    case "create_file":
    case "edit_file":
    case "rename_file":
    case "multi_edit":
      return "Editing files\u2026";
    case "delete_file":
      return "Waiting for approval\u2026";
    case "run_command":
      return "Running terminal command\u2026";
    default:
      return "Working\u2026";
  }
}

export interface TurnCallbacks {
  onAssistantStart: (id: string) => void;
  onAssistantDelta: (id: string, delta: string) => void;
  onAssistantDone: (id: string) => void;
  onToolStart: (callId: string, name: string, title: string) => void;
  onToolEnd: (
    callId: string,
    ok: boolean,
    summary: string,
    content?: string,
  ) => void;
  /** Live status of what the agent is currently doing. */
  onStatus: (status: AgentStatus) => void;
  /** Optional: called when the task phase advances (e.g. EXPLORING -> EDITING). */
  onPhaseChange?: (phase: import("./Orchestrator").TaskPhase) => void;
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
  /** Active working memory maintaining task context across tool iterations. */
  private readonly taskMemory: TaskMemory;
  /** Detects when the agent loops on identical tool calls without progress. */
  private readonly loopDetector = new LoopDetector();
  /** Current task orchestrator (phase, budget). Replaced each `send()` call. */
  private orchestrator: Orchestrator | null = null;
  /** Session-scoped repo profile cache: persists across tasks in same workspace. */
  private repoProfile: RepoProfile | null = null;

  constructor(
    private readonly client: LLMClient,
    private readonly registry: ToolRegistry,
    private ctx: ToolContext,
    private workspaceName: string | undefined,
    private allowMutations: boolean,
    initialModelId: string,
    seedHistory?: ChatMessage[],
    initialMemory?: TaskMemoryData,
  ) {
    this.toolsSupported = modelSupportsTools(initialModelId);
    this.visionSupported = modelSupportsVision(initialModelId);
    this.modelDisplay = modelDisplayName(initialModelId);
    this.taskMemory = TaskMemory.fromData(initialMemory, seedHistory);
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
    initialMemory?: TaskMemoryData,
  ): ChatSession {
    return new ChatSession(
      new LLMClient(opts),
      registry,
      ctx,
      workspaceName,
      allowMutations,
      opts.model,
      seedHistory,
      initialMemory,
    );
  }

  /** Conversation history excluding the system prompt (for persistence). */
  exportHistory(): ChatMessage[] {
    return this.messages.slice(1);
  }

  /** Export active task memory (for persistence and chat switching). */
  exportTaskMemory(): TaskMemoryData {
    return this.taskMemory.exportData();
  }

  get memory(): TaskMemory {
    return this.taskMemory;
  }

  private systemPrompt(): string {
    return buildSystemPrompt(
      this.modelDisplay,
      this.workspaceName,
      this.ctx.workspaceRoot?.fsPath,
      this.allowMutations,
      this.taskMemory.formatForSystemPrompt(),
      this.orchestrator ?? undefined,
    );
  }

  /** Refresh the system message in place after a live model/mode change or memory update. */
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

  /**
   * Switch the active workspace root (used when the agent clones a new repo).
   * Invalidates the session-cached repo profile so it will be rebuilt on the
   * next task in the new workspace.
   */
  setWorkspace(ctx: ToolContext, workspaceName?: string): void {
    this.ctx = ctx;
    this.workspaceName = workspaceName;
    this.repoProfile = null; // invalidate profile for new workspace
    this.refreshSystemPrompt();
  }

  /** Current task phase (readable by TUI for status display). */
  get currentPhase(): import("./Orchestrator").TaskPhase | null {
    return this.orchestrator?.phase ?? null;
  }

  /** Files edited in the current/last task. */
  get editedFiles(): ReadonlySet<string> {
    return this.orchestrator?.editedFiles ?? new Set();
  }

  reset(): void {
    this.cancel();
    this.taskMemory.clear();
    this.loopDetector.reset();
    this.orchestrator = null;
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
   *
   * Always returns (never throws externally) — errors are reported via
   * `cb.onError`. The caller must NOT interpret a normal task completion as
   * an exit signal; only explicit /exit commands should close the REPL.
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

    // Build (or reuse) the session-scoped repo profile
    if (!this.repoProfile && this.ctx.workspaceRoot) {
      try {
        this.repoProfile = detectRepoProfile(this.ctx.workspaceRoot.fsPath);
      } catch {
        this.repoProfile = null;
      }
    }

    // Fresh orchestrator for this task (phase starts at EXPLORING)
    this.orchestrator = new Orchestrator(DEFAULT_BUDGET, this.repoProfile);
    this.loopDetector.reset();

    // Retain user request in active task memory and refresh system prompt
    this.taskMemory.recordUserRequest(userText);
    this.refreshSystemPrompt();

    this.messages.push({ role: "user", content: this.buildUserContent(userText, images) });

    const controller = new AbortController();
    this.abortController = controller;
    const toolDefs = this.toolsSupported
      ? this.registry.definitions(this.allowMutations)
      : undefined;

    try {
      while (!controller.signal.aborted) {
        const id = `a${++this.counter}`;
        let started = false;
        cb.onStatus("Thinking\u2026");
        const ensureStarted = () => {
          if (!started) {
            started = true;
            cb.onStatus("Generating response\u2026");
            cb.onAssistantStart(id);
          }
        };

        const gen = this.client.stream(this.messages, {
          signal: controller.signal,
          tools: toolDefs,
          onRetry: () => cb.onStatus("Rate limited \u2014 retrying\u2026"),
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

        if (turn.content) {
          this.taskMemory.recordAssistantTurn(turn.content);
        }

        this.messages.push({
          role: "assistant",
          content: turn.content || null,
          tool_calls: turn.toolCalls.length ? turn.toolCalls : undefined,
        });

        // The agent stops ONLY when it responds without requesting more tool calls
        if (turn.toolCalls.length === 0) {
          this.orchestrator.markDone();
          cb.onStatus("Finished");
          return;
        }

        for (const call of turn.toolCalls) {
          // Budget check before each tool call
          const budgetStatus = this.orchestrator.onToolCall();
          if (budgetStatus?.type === "abort") {
            const budgetSummary = this.orchestrator.buildBudgetExhaustedSummary();
            this.messages.push({ role: "user", content: budgetSummary });
            // Ask the model to summarize without tools, then return to prompt
            const abortId = `a${++this.counter}`;
            cb.onAssistantStart(abortId);
            const finalGen = this.client.stream(this.messages, {
              signal: controller.signal,
              tools: undefined,
              onRetry: () => cb.onStatus("Rate limited \u2014 retrying\u2026"),
            });
            let fn = await finalGen.next();
            while (!fn.done) {
              cb.onAssistantDelta(abortId, fn.value.delta);
              fn = await finalGen.next();
            }
            cb.onAssistantDone(abortId);
            cb.onStatus("Finished");
            return;
          }
          if (budgetStatus?.type === "warn") {
            const phaseMsg =
              budgetStatus.phase === "EXPLORING"
                ? ` The agent is still in the EXPLORING phase \u2014 no changes have been made yet.`
                : "";
            this.messages.push({
              role: "user",
              content: `[SYSTEM] Budget notice: ${budgetStatus.detail}.${phaseMsg} Please wrap up efficiently.`,
            });
          }

          await this.runToolCall(call, cb);

          if (cb.onPhaseChange && this.orchestrator) {
            cb.onPhaseChange(this.orchestrator.phase);
          }
        }
        // Loop again: model receives tool results and continues until done
      }
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

        if (ok && tool.mutates) {
          // Successful mutation: advance phase, clear edit-failure counter, reset loop
          const filePath = typeof args.path === "string" ? args.path : undefined;
          if (filePath) {
            this.orchestrator?.onMutation(filePath);
            this.loopDetector.clearEditFailure(filePath);
          }
          this.loopDetector.recordSuccess();
        } else if (!ok && tool.mutates) {
          // Edit failure: detect repeated failures on the same file
          const filePath = typeof args.path === "string" ? args.path : undefined;
          if (filePath) {
            const forceReread = this.loopDetector.recordEditFailure(filePath);
            if (forceReread) {
              content +=
                `\n\n[SYSTEM] You have failed to edit "${filePath}" ` +
                `${this.loopDetector.editFailureCount(filePath)} times in a row. ` +
                `Before attempting another edit on this file, you MUST call read_file to get ` +
                `the exact current file content, then retry the edit with the correct text.`;
            }
          }
        }

        // Track verification: if the agent ran tests/build, advance to VERIFYING
        if (name === "run_command" && ok) {
          const cmd = typeof args.command === "string" ? args.command : "";
          const testCmd = this.repoProfile?.testCommand ?? "";
          if (
            (testCmd && cmd.includes(testCmd)) ||
            /\b(jest|mocha|vitest|pytest|cargo test|go test|npm test|yarn test|make test)\b/i.test(cmd)
          ) {
            this.orchestrator?.onVerification();
          }
        }
      } catch (err) {
        content = `Error: ${err instanceof Error ? err.message : String(err)}`;
        summary = err instanceof Error ? err.message : "Failed";
      }
    }

    // Detect repeated failed searches and nudge strategy change
    if (name === "search_workspace" && !ok) {
      const query = typeof args.query === "string" ? args.query : "";
      if (query && this.loopDetector.recordFailedSearch(query)) {
        content +=
          `\n\n[SYSTEM] You have tried similar searches multiple times without results. ` +
          `Try listing directories with list_files, broaden the query, or search for a ` +
          `different pattern (e.g., a different file extension or keyword).`;
      }
    }

    // Update task memory with tool findings, file mutations, or test results
    this.taskMemory.recordToolExecution(name, args, ok, summary, content);
    this.refreshSystemPrompt();

    // Check for looping after recording the execution
    const loopWarning = this.loopDetector.record(name, args, content);
    if (loopWarning) {
      if (loopWarning.type === "abort") {
        this.messages.push({ role: "tool", tool_call_id: call.id, content });
        cb.onToolEnd(call.id, ok, summary, content);
        throw new Error(loopWarning.message);
      } else {
        content += `\n\n[SYSTEM WARNING] ${loopWarning.message}`;
      }
    }

    this.messages.push({ role: "tool", tool_call_id: call.id, content });
    cb.onToolEnd(call.id, ok, summary, content);
  }
}

/** Short human title for a tool card, e.g. `read_file -> src/foo.ts`. */
function describeCall(name: string, args: Record<string, unknown>): string {
  const hint =
    (typeof args.path === "string" && args.path) ||
    (typeof args.query === "string" && args.query) ||
    (typeof args.command === "string" && args.command) ||
    "";
  return hint ? `${name} \u2192 ${hint}` : name;
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
