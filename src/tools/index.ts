import { ToolRegistry } from "./registry";
import { listFilesTool } from "./impl/listFiles";
import { readFileTool } from "./impl/readFile";
import { readActiveEditorTool } from "./impl/readActiveEditor";
import { readSelectionTool } from "./impl/readSelection";
import { searchWorkspaceTool } from "./impl/searchWorkspace";
import { fetchGithubIssueTool } from "./impl/fetchGithubIssue";
import { fetchRepoTool } from "./impl/fetchRepo";
import { createFileTool } from "./impl/createFile";
import { editFileTool } from "./impl/editFile";
import { renameFileTool } from "./impl/renameFile";
import { deleteFileTool } from "./impl/deleteFile";
import { multiEditTool } from "./impl/multiEdit";
import { runCommandTool } from "./impl/runCommand";

/**
 * The ONE place built-in tools are wired up. To add a capability: create a Tool
 * in `impl/`, import it, and `.register()` it here. Nothing else in the agent,
 * LLM client, or registry needs to change.
 */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry
    // Read-only inspection
    .register(listFilesTool)
    .register(readFileTool)
    .register(readActiveEditorTool)
    .register(readSelectionTool)
    .register(searchWorkspaceTool)
    // GitHub / repository tools
    .register(fetchGithubIssueTool)
    .register(fetchRepoTool)
    // Mutating file tools
    .register(createFileTool)
    .register(editFileTool)
    .register(renameFileTool)
    .register(multiEditTool)
    // Destructive / side-effecting
    .register(deleteFileTool)
    .register(runCommandTool);
  return registry;
}

export { ToolRegistry } from "./registry";
export * from "./types";
