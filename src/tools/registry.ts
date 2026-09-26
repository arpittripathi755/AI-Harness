import type { Tool } from "./types";
import type { ToolDefinition } from "../llm/types";

/**
 * Holds the set of available tools and exposes them to the agent loop.
 *
 * The agent dispatches purely by name via {@link get}; it never references a
 * concrete tool. New capabilities are added by registering a Tool here (see
 * `tools/index.ts`) — the core agent, LLM client, and this registry are untouched.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool registration: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** Tools available in the given mode. Plan mode excludes mutating tools. */
  listForMode(allowMutations: boolean): Tool[] {
    return this.list().filter((t) => allowMutations || !t.mutates);
  }

  /**
   * OpenAI-compatible `tools` array for the chat/completions request. When
   * `allowMutations` is false (Plan mode), mutating tools are omitted so the
   * model cannot edit files.
   */
  definitions(allowMutations = true): ToolDefinition[] {
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
