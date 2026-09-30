# Daxiom

> Autonomous AI Coding Agent & Terminal Harness

Daxiom is a high-performance terminal AI coding agent and harness built with TypeScript and Node.js. It inspects repositories, reasons through complex software engineering tasks, modifies files across directories, executes terminal commands, verifies changes, and manages Git and GitHub workflows—all through an interactive Terminal User Interface (TUI) backed by an OpenAI-compatible Large Language Model (LLM) and a modular tool execution layer.

---

## Features

* **Terminal User Interface (TUI)**: Fast, distraction-free terminal interface with interactive prompt input, real-time streaming LLM reasoning, color-coded tool execution cards, phase indicators, and status updates.
* **Autonomous AI Agent Loop**: Multi-turn agent loop (`ChatSession`) executing up to 25 tool roundtrips per task, feeding structured tool outputs back into context until the model completes the solution.
* **Repository Exploration**:
  * `list_files`: Explores directory hierarchies with depth control and glob filtering.
  * `search_workspace`: Substring and regex text search across repository files with ripgrep-like efficiency.
  * `read_file`: Line-range slicing and full-file reading with truncation guardrails.
  * `read_active_editor` & `read_selection`: Inspects open files and active editor selections.
* **Code Modification**:
  * `create_file`: Generates new files and parent directories.
  * `edit_file`: Performs targeted search-and-replace edits against existing files.
  * `multi_edit`: Performs multiple contiguous or non-contiguous search-and-replace edits within a single file.
  * `rename_file`: Moves and renames files or directories safely within the workspace.
  * `delete_file`: Deletes obsolete or temporary files safely.
* **Terminal Command Execution**:
  * `run_command`: Executes shell commands, test runners (`npm test`, `pytest`), compilers, and linters with timeout handling and output capture.
* **Autonomous Execution & Auto Edit**:
  * Default Auto Edit mode applies changes immediately without manual blocker prompts.
  * Plan Mode (`/plan`) provides safe read-only inspection.
* **Live Change Management**:
  * `ChangeManager`: Tracks staged file creations, modifications, and deletions in memory.
  * `/diff`: Displays colorful unified diffs of all pending changes before disk writes.
* **Context & Working Memory**:
  * `TaskMemory`: Maintains structured knowledge (identified files, active plan, discoveries, completed steps) across turns.
  * `ConversationManager`: Persists conversation histories across sessions.
* **Runtime LLM Configuration**:
  * `/model <model>`: Live switching of the active LLM model without restarting the session.
  * `/base-url <url>`: Live switching of the LLM provider endpoint (e.g. OpenRouter, AWS Bedrock).
  * `/config`: Safe view of current runtime settings (model, endpoint, API key status, workspace).
* **GitHub Integration**:
  * Detects repository remotes, default branches, and GitHub CLI authentication (`/git`).
  * Clones remote repositories directly into isolated workspaces (`/repo <url>`).
  * Creates feature branches, commits changes, pushes branches, and opens GitHub Pull Requests (`/pr`).
  * `fetch_github_issue`: Fetches issue descriptions and comments directly into agent context.
* **Web Documentation Tools**:
  * `web_search` & `web_fetch`: Searches authoritative online documentation and fetches technical references when troubleshooting external libraries.

---

## Architecture

```text
┌───────────────────────────────────────────────────────────┐
│                 Terminal User Interface (TUI)             │
│            (Interactive REPL & Slash Command Parser)       │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│                        ChatSession                        │
│          (Agent Loop, Working Memory & Orchestrator)      │
└──────────────┬─────────────────────────────┬──────────────┘
               │                             │
               ▼                             ▼
┌──────────────────────────────┐ ┌──────────────────────────┐
│          LLMClient           │ │       ToolRegistry       │
│    (OpenAI-Compatible SSE)   │ │ (14 Built-in Tool Impls) │
└──────────────┬───────────────┘ └───────────┬──────────────┘
               │                             │
               ▼                             │
┌──────────────────────────────┐             │
│        ProviderClient        │             │
│   (Endpoint & Auth Router)   │             │
└──────┬───────────────┬───────┘             │
       │               │                     │
       ▼               ▼                     ▼
┌─────────────┐ ┌─────────────┐  ┌──────────────────────────┐
│ OpenRouter  │ │ AWS Bedrock │  │  Filesystem / ChangeSet  │
│  Endpoint   │ │  Endpoint   │  │   & Terminal Execution   │
└─────────────┘ └─────────────┘  └──────────────────────────┘
```

### Component Breakdown

1. **TUI & CLI Entry Point (`src/cli.ts`, `src/cli/tui.ts`)**:
   - Manages terminal input/output, interactive readline turns, command routing, and ANSI-colored output formatting.
2. **ChatSession (`src/agent/ChatSession.ts`)**:
   - Orchestrates multi-turn agent turns, system prompt synthesis, tool calling iteration, and context budget management.
3. **LLMClient (`src/llm/LLMClient.ts`)**:
   - Native `fetch`-based SSE client for OpenAI-compatible chat completion endpoints. Handles live model/endpoint switching.
4. **ProviderClient (`src/llm/ProviderClient.ts`, `src/llm/providers.ts`)**:
   - Multi-provider abstraction with automatic connectivity detection, health probing, header configuration (OpenRouter vs. AWS Bedrock), and failover.
5. **Tool Registry (`src/tools/index.ts`, `src/tools/registry.ts`)**:
   - Central registration and dispatch table for all tools. Tools declare strict JSON schemas and execute against the isolated `ToolContext`.
6. **Workspace Isolation (`src/cli/workspaceIsolation.ts`)**:
   - Ensures coding operations execute inside target repositories (or dedicated workspaces under `~/Desktop/`), preventing accidental modification of Daxiom's own installation directory.

---

## Requirements

* **Node.js**: Version 18.0.0 or higher (Node 20+ or 22+ LTS recommended).
* **npm**: Version 9.0.0 or higher.
* **Git**: Installed and available on your system `PATH`.
* **Operating System**: macOS or Linux (with zsh or bash).
* **GitHub CLI (`gh`)** *(Optional)*: Required only if using `/pr` or `fetch_github_issue` workflows with GitHub authentication.

---

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/arpittripathi755/AI-Harness.git
   cd AI-Harness
   ```

2. **Run setup**:
   ```bash
   make setup
   ```

### What `make setup` does:
* Runs `npm ci` to install exact locked dependencies from `package-lock.json`.
* Runs `npm run compile` to execute Webpack 5, generating production bundles for the CLI (`dist/cli.js`), extension (`dist/extension.js`), and webview (`dist/webview.js`).

---

## Configuration

### API Key

Daxiom requires an OpenAI-compatible API key set via environment variable:

```bash
export AI_API_KEY="<YOUR_API_KEY>"
```

*(Alternatively, `DEEPSEEK_API_KEY` or `OPENAI_API_KEY` are accepted as fallbacks).*

> [!IMPORTANT]
> Never commit API keys or credentials to version control. Daxiom will never print, log, or commit your API credentials.

### Configuration Precedence

Daxiom uses a deterministic configuration hierarchy:

```text
1. Runtime Slash Commands (/model, /base-url)
      ↓
2. Current Session Configuration
      ↓
3. Environment Variables (MODEL, BASE_URL)
      ↓
4. Default Configuration
```

### Models & Endpoints

* **Default Canonical Model**:
  ```text
  deepseek/deepseek-v4.1-flash
  ```

* **Verified DeepSeek Models**:
  * `deepseek/deepseek-v4.1-flash` (DeepSeek V4.1 Flash — 1M context)
  * `deepseek/deepseek-v4-pro` (DeepSeek V4 Pro — 1M context)
  * `deepseek/deepseek-v4-flash` (DeepSeek V4 Flash — 1M context)
  * `deepseek/deepseek-chat` (DeepSeek V3 — 163k context)
  * `deepseek/deepseek-r1` (DeepSeek R1 — 64k context)

* **Verified Qwen Models**:
  * `qwen/qwen3-coder` (Qwen3 Coder 480B — 262k context)
  * `qwen/qwen3-coder-plus` (Qwen3 Coder Plus — 1M context)
  * `qwen/qwen3-coder-flash` (Qwen3 Coder Flash — 1M context)
  * `qwen/qwen3.8-flash` (Qwen3.8 Flash — 1M context)
  * `qwen/qwen-2.5-72b-instruct` (Qwen2.5 72B Instruct — 32k context)
  * `qwen/qwen-plus` (Qwen Plus — 1M context)

* **Supported Provider Endpoints**:
  * **OpenRouter**:
    ```text
    https://openrouter.ai/api/v1/
    ```
  * **AWS Bedrock** (OpenAI-compatible runtime):
    ```text
    https://bedrock-runtime.ap-south-1.amazonaws.com/openai/v1/
    ```

### Environment Variables Template

You can copy `.env.example` as a template for local environment variables:

```env
OPENROUTER_API_KEY=
# or AI_API_KEY=
MODEL=deepseek/deepseek-v4.1-flash
BASE_URL=https://openrouter.ai/api/v1/
MAX_TOKENS=16384
AI_MAX_TOKENS=
INPUT_TOKEN_BUDGET=24000
MAX_SESSION_USD=
MAX_TOOL_TURNS=25
PHASE_MODEL_OVERRIDE=
```

---

## Token Budget & Cost Controls

Daxiom employs an adaptive, affordability-aware token budgeting and cost control architecture designed to eliminate OpenRouter HTTP 402 credit errors, optimize LLM spend, and maintain maximum prompt caching efficiency.

### 1. Per-Phase Output Token Budgets

Completion requests are dynamically budgeted according to the active execution phase:

| Call Phase | Default Budget | Description |
|---|---|---|
| `tool_decision` | 1,024 tokens | Selecting which tool to execute (exploring, reading, searching, verifying) |
| `edit` | 4,096 tokens | Writing code, creating files, applying edits or multi-edit patches |
| `explain` | 1,536 tokens | User-facing summaries, task explanations, and final reports |
| `plan` | 2,048 tokens | Architecture analysis and step-by-step implementation plans |

### 2. Output Budget Resolution Order

When resolving completion token limits (`effectiveMaxTokens`), each step can **only lower** the budget, never raise it:
1. **Phase Default / Explicit Override**: Starts with `override` (if supplied) or `PHASE_BUDGET[phase]`.
2. **Environment Ceiling**: Capped by the hard ceiling defined in `MAX_TOKENS` or `AI_MAX_TOKENS` (if set). Environment variables establish an upper ceiling rather than an inflexible global constant.
3. **Model Output Limit**: Capped by the model's native `maxOutputTokens` from its metadata.
4. **Affordability Clamping**: In OpenRouter environments, clamped to `Math.floor((limit_remaining * 0.9) / completionPricePerToken)` based on remaining key balance.
5. **Safe Validation**: Validated through `resolveMaxTokens` to guarantee a positive integer fallback on NaN, non-integer, or invalid values.

### 3. OpenRouter HTTP 402 Fallback & Auto-Retry

When an OpenRouter request encounters an HTTP 402 (Insufficient Credits / Balance Limit Exceeded):
1. **Affordability Parsing**: If the response body matches `can only afford (\d+)`, Daxiom parses the affordable token amount $N$.
2. **Single Retry**: Sets `max_tokens = Math.floor(N * 0.9)` (applying a 10% safety margin) and retries the request **exactly once**.
3. **Sane Minimum Threshold**: If $N < 256$, Daxiom does not retry; it immediately surfaces a clear error informing the user that their balance is too low.
4. **Cache Invalidation**: On a 402 response, the in-memory `/key` balance cache is invalidated immediately to ensure up-to-date accounting.
5. **Loop Prevention**: If the single retry also encounters a 402, the request fails without looping.

### 4. Token-Based Input Context Management

- **Token Estimation**: Fast tokenizer heuristic ($tokens \approx \lceil characters / 3.5 \rceil$).
- **Head & Tail Output Truncation**: Commands executed via `run_command` preserve the first 6,000 characters and the last 12,000 characters (where test runner failures and compiler diagnostics reside), replacing the middle with `\n… [N lines omitted] …\n`.
- **History Compaction (`compactHistory`)**:
  - When estimated conversation tokens exceed 70% of `INPUT_TOKEN_BUDGET` (default: 24,000 tokens), older tool execution results are condensed into single-line stubs: `[tool result omitted: read_file src/a.ts (~1,200 tokens). Re-read if needed.]`.
  - The system prompt and the last 3 turns are always preserved verbatim.
  - If still over budget, oldest turns are pruned while strictly maintaining tool-call and tool-result pairing.

### 5. Cache-Friendly Prompt Layout

To maximize KV prompt cache hit rates on OpenRouter and modern LLMs:
- **Stable Prefix**: Core directives, mode rules, tool efficiency instructions, and web safety rules are placed first and are byte-identical across turns.
- **Volatile Suffix**: Dynamic variables (active working memory, ephemeral task phase) are placed at the end of the prompt.

### 6. Loop & Safety Guards

- **Turn Cap (`MAX_TOOL_TURNS`)**: The agent loop allows up to 25 tool turn round-trips by default. Upon reaching the limit, the agent stops executing tools and provides a clear summary of what was completed and what remains.
- **Duplicate Tool Caching**: Redundant calls to read-only tools (`read_file`, `list_files`, `search_workspace`, etc.) with identical arguments return cached results prefixed with `[duplicate call; returning earlier result]` without re-executing. Side-effecting tools (`run_command`, file modifications) are never cached. Any successful file mutation clears the read-only cache.
- **Session Cost Guard (`MAX_SESSION_USD`)**: Optional dollar cap on session spending. Emits a warning when reaching 80% and halts the agent loop gracefully at 100%.

### 7. Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `MAX_TOKENS` | `16384` | Hard ceiling on output tokens per completion; caps per-phase budgets. |
| `AI_MAX_TOKENS` | Unset | Alias for `MAX_TOKENS`. |
| `INPUT_TOKEN_BUDGET` | `24000` | Input token threshold before older message compaction kicks in. |
| `MAX_SESSION_USD` | Unset | Maximum session dollar spend. Warns at 80%, stops at 100%. |
| `MAX_TOOL_TURNS` | `25` | Maximum number of tool-calling iterations before stopping with a summary. |
| `PHASE_MODEL_OVERRIDE` | Unset | Optional JSON map of phase to model ID (e.g. `{"edit":"qwen/qwen-2.5-coder-32b-instruct"}`). |


---

## Running Daxiom

Launch Daxiom using Make:

```bash
make run
```

### What happens when `make run` executes:
1. Re-compiles the project (`npm run compile`) to ensure your build is always up to date.
2. Invokes `./scripts/launch-tui.sh`:
   - Validates that `AI_API_KEY` is present.
   - On macOS with a GUI terminal (Terminal.app or iTerm.app), it activates the terminal and opens Daxiom in a dedicated, clean terminal window.
   - In headless environments, CI, or when `AXIOM_HEADLESS=1` is set, it runs directly attached in the current terminal.
3. Probes the configured LLM provider and starts the interactive TUI.

### Targeting a Specific Repository

You can launch Daxiom directly against a Git repository:

```bash
# Using REPO environment variable with make run
make run REPO=https://github.com/octocat/Hello-World

# Or passing arguments to the CLI
node dist/cli.js --repo=https://github.com/octocat/Hello-World "Fix broken unit tests"
```

Daxiom clones the repository to an isolated workspace under `~/Desktop/<repo-name>` and sets it as the active workspace root.

---

## TUI Usage

When Daxiom starts, you are presented with the status header showing the active Model, Workspace, Mode, and Provider connection:

```text
┌────────────────────────────────────────────────────────────────┐
│  DAXIOM                                          AUTO EDIT: ON  │
├────────────────────────────────────────────────────────────────┤
│  Model: deepseek/deepseek-v4.1-flash    Workspace: my-repo     │
│  Provider: OpenRouter                   Connected              │
├────────────────────────────────────────────────────────────────┤
```

### 1. Entering a Task
Simply type your task description at the `>` prompt:
```text
> Find all unused imports across src/ and remove them. Run tests to verify.
```

### 2. Observing Agent Execution
Daxiom streams the assistant's reasoning and displays each tool action in real time:
- `◉ Reading files… read_file (src/index.ts:1-50)`
- `◉ Editing files… edit_file (src/index.ts)`
- `◉ Running terminal command… run_command (npm test)`
- `✓ 12 tests passed`
- `✓ Changes applied immediately to disk (1 file).`

### 3. Auto Edit vs. Plan Mode
- **Auto Edit (Default)**: Full autonomous execution. File modifications are applied immediately to disk and terminal commands run automatically.
- **Plan Mode**: Switch using `/plan`. In Plan mode, mutating tools are restricted, allowing safe read-only repository inspection and planning. Switch back using `/auto`.

### 4. Managing Changes
- Type `/diff` at any time to preview the unified diff of staged changes.
- Type `/clear` to clear current task memory and discard staged changes.

### 5. Managing Conversations
- Type `/new` to archive the current conversation and start a clean session with fresh context.

### 6. Exiting
- Type `/exit` or `/quit` (or press `Ctrl+C`) to exit Daxiom.

---

## Slash Commands

Daxiom supports the following runtime slash commands:

| Command | Description |
|---|---|
| `/help` | Display all available commands and their descriptions. |
| `/model <model-name>` | Switch the active LLM model live in the current session (e.g. `/model deepseek/deepseek-v4.1-flash`). |
| `/base-url <url>` | Switch the active LLM provider endpoint live in the current session (e.g. `/base-url https://openrouter.ai/api/v1`). |
| `/config` | Display the current runtime configuration safely (Model, Base URL, API key status, Mode, Workspace). |
| `/clear` | Clear the current conversation history, task memory, and discard staged changes. |
| `/new` | Start a completely new conversation session. |
| `/auto` | Enable Auto Edit mode (autonomous execution with immediate disk writes). |
| `/plan` | Enable Plan mode (read-only inspection without file mutations). |
| `/diff` | Preview colored unified diffs of staged changes. |
| `/status` | Display detailed agent status (current phase, read files, staged files, verification result, git details). |
| `/git` | Display repository remote URL, owner/repo, branch, and GitHub auth status. |
| `/repo <url>` | Clone a remote GitHub repository to `~/Desktop/` and switch the active workspace. |
| `/pr` | Commit accepted changes, push a feature branch to the remote, and open a GitHub Pull Request. |
| `/models` | List built-in model presets and aliases. |
| `/exit`, `/quit` | Exit the Daxiom application. |

---

## Testing & Quality

To run the automated test suite and linter:

```bash
# Run ESLint and all unit tests
make test

# Or run separately:
npm run lint
npm run compile-tests
```

Unit tests cover the provider layer, LLM client streaming, SSE decoding, tool execution, workspace safety boundaries, and cancellation handling.

---

## Security & Safety Guardrails

* **No Credential Leakage**: API credentials from `AI_API_KEY` are never printed in the TUI, never displayed by `/config`, and never written to logs or error messages.
* **Workspace Isolation**: Agent filesystem operations are strictly confined within the selected repository workspace, preventing accidental path traversal outside the project.
* **Sensitive File Protection**: Modifications to critical environment files (such as `.env` or system configurations) are blocked or strictly guarded.
