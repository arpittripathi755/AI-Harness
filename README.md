# Axiom

> An autonomous AI coding agent and harness embedded directly within Visual Studio Code.

---

## Overview

Axiom is an embedded VS Code AI coding agent designed to explore, understand, and modify codebases autonomously. Operating directly inside the VS Code Extension Host, Axiom pairs a rich React-based sidebar interface with an agentic loop capable of inspecting workspace files, executing terminal commands, performing precise code edits, and streaming real-time reasoning and tool actions.

---

## Architecture

The system consists of a dual-target architecture: an extension backend running in Node.js inside the VS Code Extension Host, and a web-based chat frontend running in a VS Code webview panel.

```
                    ┌─────────────────────────┐
                    │          User           │
                    └────────────┬────────────┘
                                 │ Interacts via UI
                                 ▼
        ┌──────────────────────────────────────────────────┐
        │               Axiom VS Code Extension            │
        │  ┌────────────────────┐  ┌────────────────────┐  │
        │  │  React 19 Webview  │  │  SidebarProvider   │  │
        │  │  (dist/webview.js) │◀─┼─▶(dist/extension.js│  │
        │  └────────────────────┘  └──────────┬─────────┘  │
        └─────────────────────────────────────┼────────────┘
                                              │
                                              ▼
                             ┌─────────────────────────────────┐
                             │ ChatSession/ConversationManager │
                             └────────────────┬────────────────┘
                                              │
                         ┌────────────────────┴────────────────────┐
                         ▼                                         ▼
              ┌─────────────────────┐                   ┌─────────────────────┐
              │      LLMClient      │                   │     Tool Layer      │
              │  (OpenAI-compatible │                   │  (Registry & Core   │
              │  Streaming SSE API) │                   │    Tool Impls)      │
              └──────────┬──────────┘                   └──────────┬──────────┘
                         │                                         │
                         ▼                                         ▼
              ┌─────────────────────┐                   ┌─────────────────────┐
              │   Lightning AI /    │                   │ VS Code Workspace / │
              │   OpenAI Endpoint   │                   │    Local System     │
              └─────────────────────┘                   └─────────────────────┘
```

### Components
* **VS Code Extension Host**: Hosts the core extension logic, lifecycle management, secret storage, and command registry.
* **React 19 Webview**: An interactive sidebar interface (`dist/webview.js`) providing conversational history, model/mode configuration, and live tool call cards.
* **Webpack Bundles**: Dual-configured bundling via Webpack 5 compiling `src/extension.ts` (Node target) and `src/webview/index.tsx` (web target).
* **LLM Client (`src/llm/LLMClient.ts`)**: A custom, lightweight streaming client leveraging native `fetch` with server-sent events (SSE) support and automatic retry with exponential backoff on HTTP 429 rate limits.
* **Tool Layer (`src/tools/`)**: A modular tool execution registry dispatching actions against the workspace.
* **Workspace APIs**: Utilizes VS Code's native file system and terminal APIs (`vscode.workspace`, `vscode.window`) with safety guardrails against path traversal.

---

## Current Capabilities

Axiom includes the following verified tool capabilities:

* **Repository Inspection & Navigation**:
  * `list_files`: Lists directory contents with recursion depth control.
  * `search_workspace`: Substring and regex text search across the codebase.
  * `read_file`: Reads whole files or specific line number slices.
  * `read_active_editor`: Inspects the currently focused document in the editor.
  * `read_selection`: Inspects the active text selection in the editor.
* **Code Modification**:
  * `create_file`: Generates new files and directories.
  * `edit_file`: Applies precise search-and-replace edits to existing files.
  * `multi_edit`: Performs multiple contiguous or non-contiguous search-and-replace chunks across a file.
  * `rename_file`: Moves or renames files and directories.
  * `delete_file`: Deletes files or folders with explicit user confirmation.
* **Environment Execution**:
  * `run_command`: Executes commands in the VS Code integrated terminal (with user confirmation or optional auto-run).
* **Model Configuration**:
  * Model switching via the central model registry in `src/shared/models.ts`.

---

## Current Agent Workflow

Axiom executes through an iterative agentic loop managed by `ChatSession`:

```
User Request
     │
     ▼
[ChatSession.send()] ─── System prompt + conversation history assembled
     │
     ▼
[LLMClient.stream()] ─── Streams assistant reasoning & tool-call deltas
     │
     ├─► If model emits text only ──────────────► [Assistant Output to User] ──► Done
     │
     └─► If model requests tool call(s)
              │
              ▼
         [runToolCall()] ── Dispatch to ToolRegistry
              │
              ▼
         [Tool Execution] ── File I/O or terminal command
              │
              ▼
         [Tool Result] ── Appended as role: "tool" to conversation
              │
              ▼
         (Loop back to LLMClient with updated messages up to MAX_ITERATIONS=25)
```

---

## Current Limitations

To provide an honest evaluation, the following features are **not** present in the current release:

* **No Autonomous Verification Loop**: Axiom does not automatically invoke test suites, linters, or syntax checks after file edits unless explicitly instructed by the user via terminal tools.
* **No Autonomous Failure Recovery**: Beyond basic HTTP 429 retry backoff, there is no automatic error reflection, multi-strategy backtracking, or loop detection.
* **No MCP (Model Context Protocol)**: Tools are currently hardcoded and registered natively in the codebase.
* **No Git Checkpoint / Rollback**: Axiom does not create automatic Git commits, stash checkpoints, or rollback bad edits on failure.
* **No Token / Context Compaction**: Conversation messages and tool responses are appended linearly without dynamic token budget pruning or rolling compaction.
* **No AST / LSP Repository Navigation**: Search is text-based (ripgrep-style) without language server protocol symbol graphs or AST indexing.

---

## Hackathon Evaluation

The repository adheres to the standardized AI Harness Hackathon 2026 evaluation contract. The evaluator provides the credential externally via the environment without needing to edit source files or use GUI prompts.

### Evaluation Commands

1. **Set Environment Credential**:
   ```bash
   export AI_API_KEY="<PROVIDED_API_KEY>"
   ```

2. **Setup**:
   ```bash
   make setup
   ```
   *Installs locked dependencies via `npm ci` and compiles the extension bundles.*

3. **Run**:
   ```bash
   make run
   ```
   *Validates `AI_API_KEY` presence, verifies build artifacts, and launches the Extension Development Host (`code --extensionDevelopmentPath=. .`).*

4. **Test**:
   ```bash
   make test
   ```
   *Runs ESLint and the extension automated test suite.*

5. **Clean**:
   ```bash
   make clean
   ```
   *Removes compiled build artifacts (`dist/`, `out/`).*

### Model Configuration

* **Default Evaluation Model**: `lightning-ai/nvidia-nemotron-3-ultra-550b-a55b` (Nemotron 550B).
* **Text-Only Compliance**: The default model explicitly declares `supportsVision: false`. Image inputs and multimodal payload parts are omitted from API requests, ensuring strict compliance with text-only evaluation requirements.

---

## Local Development

For developers actively working on Axiom within VS Code:

1. **Install Dependencies**:
   ```bash
   npm ci
   ```

2. **Build and Watch**:
   ```bash
   npm run watch
   ```

3. **Launch & Debug**:
   * Open the project in VS Code.
   * Press **F5** (or navigate to Run & Debug and select **Run Extension**).
   * An Extension Development Host window will open with Axiom active in the secondary sidebar.

---

## Harness Roadmap

The following enhancements are planned for upcoming iterations of the Axiom harness:

* **Verification Engine**: Automated post-edit linting, syntax verification, and test execution before completing tasks.
* **Failure Recovery**: Autonomous error diagnosis, strategy switching, and automatic Git checkpoints with rollback on broken builds.
* **Model Context Protocol (MCP)**: Dynamic tool discovery and integration with external MCP servers.
* **Planner & Task Decomposition**: Explicit two-phase planning and goal-tracking loops prior to execution.
* **Context Budget Management**: Token-aware message compaction, tool output pruning, and sliding-window history.
* **AST / Symbol Navigation**: Integration with LSP to enable semantic code exploration and cross-file references.
* **Observability & Tracing**: Structured logging of agent iterations, tool latency, and token consumption metrics.

---

## Hackathon Alignment

| Responsibility | Current Axiom Implementation | Planned Enhancement |
|---|---|---|
| **Orchestration** | Single iterative `ChatSession` loop (up to 25 tool round-trips) | Multi-phase planner, task decomposition, and sub-agent delegates |
| **Context** | In-memory message history with full tool outputs | Token-budgeted compaction, sliding window, and tool summary pruning |
| **Tools** | Native workspace tools (`list`, `read`, `edit`, `search`, `run_command`) | Extensible Model Context Protocol (MCP) tool integration |
| **Verification** | Build/lint/test infrastructure exists, but no autonomous post-edit verification | Autonomous verification engine running test/lint checks after edits |
| **Recovery** | Basic transient HTTP 429 exponential backoff | Error reflection, strategy backtracking, and automated Git rollback |
| **Efficiency** | Prompt guidance for concise reading and line-range slicing | Semantic symbol caching, AST indexing, and prompt caching |
