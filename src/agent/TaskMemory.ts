import type { ChatMessage, ToolCall } from "../llm/types";

/** Serialized format for persistence across VS Code restarts. */
export interface TaskMemoryData {
  userRequests: string[];
  planSteps: string[];
  filesRead: string[];
  filesModified: Array<{ path: string; action: string }>;
  keyFindings: string[];
  commandResults: string[];
  errorsEncountered: string[];
  actionsTaken: string[];
}

/**
 * Maintains active task working memory and context across multiple reasoning
 * cycles, tool calls, and turns within a conversation.
 *
 * Prevents the agent from losing context of the user's original goal, files read,
 * files modified, test results, or errors encountered during complex multi-step tasks.
 */
export class TaskMemory {
  private userRequests: string[] = [];
  private planSteps: string[] = [];
  private filesRead = new Set<string>();
  private filesModified = new Map<string, string>(); // path -> action summary
  private keyFindings: string[] = [];
  private commandResults: string[] = [];
  private errorsEncountered: string[] = [];
  private actionsTaken: string[] = [];

  constructor(data?: TaskMemoryData) {
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
  static fromData(data?: TaskMemoryData, seedHistory?: ChatMessage[]): TaskMemory {
    const memory = new TaskMemory(data);
    if ((!data || memory.isEmpty()) && seedHistory && seedHistory.length > 0) {
      memory.rehydrateFromHistory(seedHistory);
    }
    return memory;
  }

  isEmpty(): boolean {
    return (
      this.userRequests.length === 0 &&
      this.filesRead.size === 0 &&
      this.filesModified.size === 0 &&
      this.actionsTaken.length === 0
    );
  }

  clear(): void {
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
  recordUserRequest(text: string): void {
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
  recordAssistantTurn(turnContent: string | null | undefined): void {
    if (!turnContent) {
      return;
    }
    const lines = turnContent.split("\n");
    const planLines: string[] = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      // Match numbered lists like "1. inspect...", "Step 1: ..." or "- [ ] ..."
      if (
        /^(?:\d+[\.\)]|step\s+\d+:?|[-*]\s*\[\s*[ xX]?\s*\])\s+/i.test(line) &&
        line.length > 5
      ) {
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
  recordToolExecution(
    name: string,
    args: Record<string, unknown>,
    ok: boolean,
    summary: string,
    rawContent: string,
  ): void {
    const pathArg = typeof args.path === "string" ? args.path : "";
    const commandArg = typeof args.command === "string" ? args.command : "";

    // 1. Files Read
    if (name === "read_file" && pathArg) {
      const range =
        typeof args.start_line === "number" || typeof args.end_line === "number"
          ? ` (lines ${args.start_line ?? 1}-${args.end_line ?? "end"})`
          : "";
      this.filesRead.add(`${pathArg}${range}`);
    } else if (name === "read_active_editor") {
      this.filesRead.add("(active editor)");
    } else if (name === "read_selection") {
      this.filesRead.add("(active editor selection)");
    }

    // 2. Files Modified
    if (ok) {
      if (name === "create_file" && pathArg) {
        this.filesModified.set(pathArg, "Created");
      } else if ((name === "edit_file" || name === "multi_edit") && pathArg) {
        this.filesModified.set(pathArg, "Modified");
      } else if (name === "delete_file" && pathArg) {
        this.filesModified.set(pathArg, "Deleted");
      } else if (name === "rename_file" && typeof args.old_path === "string" && typeof args.new_path === "string") {
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
      } else if (name === "list_files") {
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
        this.appendBounded(
          this.errorsEncountered,
          `Command failed: \`${commandArg}\` (${summary})`,
          8,
        );
      }
    }

    // 5. Tool Errors
    if (!ok && name !== "run_command") {
      this.appendBounded(
        this.errorsEncountered,
        `Tool ${name} failed: ${summary}`,
        8,
      );
    }

    // 6. Action History
    const actionDesc = `${name}${pathArg ? ` -> ${pathArg}` : commandArg ? ` -> ${commandArg}` : ""}`;
    const actionItem = `${this.actionsTaken.length + 1}. [${actionDesc}] ${ok ? "OK" : "FAILED"}: ${summary}`;
    this.appendBounded(this.actionsTaken, actionItem, 20);
  }

  /**
   * Reconstruct context from historical messages when opening an existing chat.
   */
  private rehydrateFromHistory(history: ChatMessage[]): void {
    const toolCallNames = new Map<string, { name: string; args: Record<string, unknown> }>();

    for (const msg of history) {
      if (msg.role === "user") {
        if (typeof msg.content === "string") {
          this.recordUserRequest(msg.content);
        } else if (Array.isArray(msg.content)) {
          const textPart = msg.content.find((p) => p.type === "text");
          if (textPart && "text" in textPart) {
            this.recordUserRequest(textPart.text);
          }
        }
      } else if (msg.role === "assistant") {
        if (typeof msg.content === "string") {
          this.recordAssistantTurn(msg.content);
        }
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            try {
              const parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
              toolCallNames.set(tc.id, { name: tc.function.name, args: parsedArgs });
            } catch {
              toolCallNames.set(tc.id, { name: tc.function.name, args: {} });
            }
          }
        }
      } else if (msg.role === "tool" && msg.tool_call_id) {
        const meta = toolCallNames.get(msg.tool_call_id);
        if (meta) {
          const content = typeof msg.content === "string" ? msg.content : "";
          const isErr = content.startsWith("Error:") || content.startsWith("Refused:");
          this.recordToolExecution(
            meta.name,
            meta.args,
            !isErr,
            isErr ? content.slice(0, 100) : "Done",
            content,
          );
        }
      }
    }
  }

  private appendBounded(list: string[], item: string, maxItems: number): void {
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
  formatForSystemPrompt(): string {
    const sections: string[] = [];

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
      const readList = Array.from(this.filesRead);
      const displayList = readList.length > 15
        ? [...readList.slice(-15), `... (+${readList.length - 15} earlier files)`]
        : readList;
      sections.push(
        `• Files Inspected / Read:\n  - ${displayList.join("\n  - ")}`,
      );
    }

    // 4. Files Modified
    if (this.filesModified.size > 0) {
      const modItems: string[] = [];
      for (const [path, action] of this.filesModified.entries()) {
        modItems.push(`${action}: ${path}`);
      }
      sections.push(`• Files Modified During Task:\n  - ${modItems.join("\n  - ")}`);
    }

    // 5. Exploration & Findings
    if (this.keyFindings.length > 0) {
      const findings = this.keyFindings.slice(-6);
      sections.push(
        `• Key Repository Findings:\n  - ${findings.join("\n  - ")}`,
      );
    }

    // 6. Command & Test Results
    if (this.commandResults.length > 0) {
      const cmds = this.commandResults.slice(-5);
      sections.push(
        `• Command / Test Results:\n  - ${cmds.join("\n  - ")}`,
      );
    }

    // 7. Errors Encountered (if any)
    if (this.errorsEncountered.length > 0) {
      const errors = this.errorsEncountered.slice(-5);
      sections.push(
        `• Errors / Issues Encountered (address these if still unresolved):\n  - ${errors.join("\n  - ")}`,
      );
    }

    // 8. Recent Actions Taken
    if (this.actionsTaken.length > 0) {
      const recent = this.actionsTaken.slice(-5);
      sections.push(`• Recent Actions Taken in Current Task:\n  ${recent.join("\n  ")}`);
    }

    if (sections.length === 0) {
      return "";
    }

    return (
      `=== CURRENT TASK WORKING MEMORY & CONTEXT ===\n` +
      `The following memory reflects your actions, findings, file modifications, and test results so far.\n` +
      `Use this context to stay aligned with the user's goal, avoid redundant reads, build on your edits, and fix any failed tests:\n\n` +
      sections.join("\n\n") +
      `\n==============================================`
    );
  }

  /**
   * Format a compact, structured summary of durable task state for the Phase 6
   * compaction anchor. This is injected as a user message in the dynamic suffix
   * immediately after compaction — it must never include raw file contents,
   * full command outputs, or API secrets.
   *
   * Version: 1 (schema bumped on structural changes, no migrations in Phase 6).
   */
  formatForCompactionAnchor(): string {
    const lines: string[] = [
      "=== TASK MEMORY ANCHOR (v1) ===",
      "This summarizes durable task state preserved across context compaction.",
      "Older conversation turns have been removed to stay within token limits.",
      "",
    ];

    // Goal / user request(s)
    if (this.userRequests.length > 0) {
      lines.push("GOAL:");
      lines.push(`  ${this.userRequests[0]}`);
      if (this.userRequests.length > 1) {
        lines.push("FOLLOW-UP INSTRUCTIONS:");
        for (const req of this.userRequests.slice(1, 5)) {
          lines.push(`  - ${req.slice(0, 200)}`);
        }
      }
      lines.push("");
    }

    // Active plan steps (if any)
    if (this.planSteps.length > 0) {
      lines.push("ACTIVE PLAN:");
      for (const step of this.planSteps.slice(0, 8)) {
        lines.push(`  ${step.slice(0, 200)}`);
      }
      lines.push("");
    }

    // Important files (paths only — never full contents)
    const modifiedFiles = Array.from(this.filesModified.entries());
    if (modifiedFiles.length > 0) {
      lines.push("FILES MODIFIED:");
      for (const [path, action] of modifiedFiles.slice(0, 15)) {
        lines.push(`  ${action}: ${path}`);
      }
      lines.push("");
    }

    const readFiles = Array.from(this.filesRead);
    if (readFiles.length > 0) {
      const displayFiles = readFiles.length > 10
        ? [...readFiles.slice(-10), `(+${readFiles.length - 10} earlier)`]
        : readFiles;
      lines.push("FILES READ:");
      for (const f of displayFiles) {
        lines.push(`  - ${f}`);
      }
      lines.push("");
    }

    // Command / test results (summaries only — no raw output)
    if (this.commandResults.length > 0) {
      lines.push("COMMAND RESULTS:");
      for (const r of this.commandResults.slice(-5)) {
        lines.push(`  ${r.slice(0, 200)}`);
      }
      lines.push("");
    }

    // Errors still to address
    if (this.errorsEncountered.length > 0) {
      lines.push("ERRORS / ISSUES (address if unresolved):");
      for (const e of this.errorsEncountered.slice(-5)) {
        lines.push(`  - ${e.slice(0, 200)}`);
      }
      lines.push("");
    }

    // Recent actions (for continuity)
    if (this.actionsTaken.length > 0) {
      lines.push("RECENT ACTIONS:");
      for (const a of this.actionsTaken.slice(-5)) {
        lines.push(`  ${a.slice(0, 200)}`);
      }
      lines.push("");
    }

    lines.push("=== END TASK MEMORY ANCHOR ===");

    return lines.join("\n");
  }

  /** Export data for persistence. */
  exportData(): TaskMemoryData {
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
