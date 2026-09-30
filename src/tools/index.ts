import { ToolRegistry } from "./registry";
import { listFilesTool } from "./impl/listFiles";
import { readFileTool } from "./impl/readFile";
import { readActiveEditorTool } from "./impl/readActiveEditor";
import { readSelectionTool } from "./impl/readSelection";
import { searchWorkspaceTool } from "./impl/searchWorkspace";
import { createFileTool } from "./impl/createFile";
import { editFileTool } from "./impl/editFile";
import { renameFileTool } from "./impl/renameFile";
import { deleteFileTool } from "./impl/deleteFile";
import { multiEditTool } from "./impl/multiEdit";
import { runCommandTool } from "./impl/runCommand";
import { gitCloneTool } from "./impl/gitClone";
import { fetchGithubIssueTool } from "./impl/fetchGithubIssue";
import { webSearchTool } from "./impl/webSearch";
import { webFetchTool } from "./impl/webFetch";

/**
 * The ONE place built-in tools are wired up. To add a capability: create a Tool
 * in `impl/`, import it, and `.register()` it here. Nothing else in the agent,
 * LLM client, or registry needs to change.
 */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry
    // Read-only inspection & external documentation
    .register(listFilesTool)
    .register(readFileTool)
    .register(readActiveEditorTool)
    .register(readSelectionTool)
    .register(searchWorkspaceTool)
    .register(fetchGithubIssueTool)
    .register(webSearchTool)
    .register(webFetchTool)
    // Mutating
    .register(createFileTool)
    .register(editFileTool)
    .register(renameFileTool)
    .register(multiEditTool)
    .register(gitCloneTool)
    // Destructive / side-effecting (require modal confirmation)
    .register(deleteFileTool)
    .register(runCommandTool);
  return registry;
}

export { ToolRegistry } from "./registry";
export { webSearchTool, createWebSearchTool } from "./impl/webSearch";
export { webFetchTool, createWebFetchTool } from "./impl/webFetch";
export * from "./types";
