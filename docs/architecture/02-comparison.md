# Architecture Review: Focused Capability Comparison (Stage 2)

This document evaluates 7 targeted capability areas between Daxiom's current architecture and Rosetta's approaches, grounded strictly in the empirical baseline data measured in Stage 1.

---

## 1. Tool-Result Handling

- **Current State**: Uses `truncateHeadTail` on raw output (6,000 max characters for `run_command`, 160/40 line sampling for unranged `readFile` >250 lines). Large tool results remain raw in history for 3 turns before `compactHistory` stubs them.
- **Rosetta Approach**: Test/build output digesting (extracts failure summary, assertions, stack trace) + dumps full raw stdout to a temporary scratch file, returning only the parsed digest and file pointer.
- **Verdict**: **Adopt (Digesting for Test/Command Results)**.
- **Rationale**: In Scenario (b), raw test outputs consumed ~12,400 prompt tokens across exploratory test runs; parsing structured test failure diagnostics into a ~250-token digest will cut Scenario (b) tool-result tokens from ~18,000 to ~4,500 (a ~75% reduction in tool-result prompt volume).

---

## 2. Reasoning-Aware Budgets

- **Current State**: Fixed `PHASE_BUDGET` (`tool_decision`: 2,048, `edit`: 4,096) with dynamic reservation fraction clamp down to `MIN_GUARDED_MAX_TOKENS = 512`. No explicit reasoning token floor or dynamic reasoning effort control.
- **Rosetta Approach**: Dynamically tunes reasoning budget (`effort: low/medium/high` or explicit reasoning token allocation) per turn, enforcing a hard minimum output buffer for tool calls.
- **Verdict**: **Improve (Enforce Floor + Phase-Aware Reasoning Allocation)**.
- **Rationale**: In Scenario (a), DeepSeek emitted 1,400 reasoning tokens before generating a 118-token tool call; setting a minimum safe `max_tokens` floor of 2,560 for tool-decision phases prevents the observed empty-response failure when credit reservation clamping is active.

---

## 3. Token Estimation

- **Current State**: Uses static character heuristic ($1\text{ token} \approx 3.5\text{ characters}$) across all messages and tool schemas.
- **Rosetta Approach**: `usageMark` hybrid: captures exact `prompt_tokens` from provider response metadata when available, and only computes incremental heuristic estimates for messages added since the last server turn.
- **Verdict**: **Adopt (Hybrid `usageMark`)**.
- **Rationale**: In the baseline runs, the 3.5 char/token heuristic diverged by 12–18% on dense JSON tool schemas and structured diffs; anchoring to real API `prompt_tokens` eliminates cumulative estimation drift in 20+ turn sessions without adding heavy WASM tokenizers.

---

## 4. Prompt Cache Prefix Stability

- **Current State**: System prompt prefix is semi-stable, but dynamic `TaskMemory` working memory (recent actions, findings, files modified) is injected directly into `buildSystemPrompt` on every turn, mutating the system prompt and causing 0% prompt cache hits.
- **Rosetta Approach**: `isPrefixStable` assertion: separates the system prompt and tool definitions into a strictly immutable prefix block, moving dynamic working memory into a dedicated user or assistant context message.
- **Verdict**: **Improve (Split Dynamic Memory to User/Ephemeral Turn)**.
- **Rationale**: The static system prompt (~800 tokens) and tool schemas (~1,100 tokens) account for 34% of prompt tokens; keeping this ~1,900-token prefix byte-identical across all turns enables OpenRouter/Anthropic KV prompt caching, saving up to ~65% of repeated prefix ingestion costs.

---

## 5. Staging-to-Disk Flush Before Test Verification

- **Current State**: `ChangeManager` stages all file creations, edits, and renames in an in-memory virtual overlay. When `run_command` executes a build or test suite (`npm test`), the child process runs against physical disk files, completely missing all staged modifications.
- **Rosetta Approach**: Flushes the staged overlay to disk before running verification commands, and reverts or retains changes based on test results.
- **Verdict**: **Adopt (Pre-Verification Disk Sync)**.
- **Rationale**: This is a critical correctness defect where the agent attempts to verify in `VERIFYING` phase using `run_command`, but tests fail because the staged fixes only exist in RAM overlay.

---

## 6. Compaction Strategy

- **Current State**: Single threshold trigger: when estimated tokens exceed 70% of `INPUT_TOKEN_BUDGET`, older tool results (>50 tokens) are replaced with one-line stubs (`[tool result omitted: ...]`). If still over budget, oldest non-system turn pairs are dropped.
- **Rosetta Approach**: Two-stage compaction (70% soft trigger for tool stubbing / 35% hard recovery) paired with an explicit synthetic memory summary (retaining goal, active plan step, touched files, and key test failures).
- **Verdict**: **Improve (Inject TaskMemory Synthetic Anchor on Turn Pruning)**.
- **Rationale**: In Scenario (c), dropping older turns caused the agent to lose its initial search findings and re-explore already visited files; injecting a structured summary from `TaskMemory` into the compacted history preserves goal continuity and eliminates redundant exploration turns.

---

## 7. Reasoning Field Pruning from History

- **Current State**: SSE stream currently does not store `reasoning_content` in history messages. However, if reasoning tokens were retained in assistant messages, replaying them in multi-turn history would severely inflate context.
- **Rosetta Approach**: Strips reasoning/thought blocks (`<think>` or `reasoning_content`) from assistant messages before appending to persistent conversation history for subsequent turns.
- **Verdict**: **Keep (Do Not Replay Reasoning in History)**.
- **Rationale**: In Scenario (c), 14,910 reasoning tokens were generated across 24 turns; replaying these reasoning tokens in outgoing history would have increased total prompt ingestion by ~180,000 tokens (a ~47% cost increase) with zero reasoning benefit on subsequent turns.

---

## Summary Comparison Matrix

| Area | Current Daxiom | Rosetta Idea | Verdict | Impact on Baseline |
|---|---|---|---|---|
| **1. Tool-Result Handling** | `truncateHeadTail` (raw text) | Output digest + scratch file | **Adopt** | Cuts tool-result prompt share from 38% to ~15% in Scenario (b). |
| **2. Reasoning-Aware Budgets** | Clamped down to 512 tok | Dynamic effort & token floor | **Improve** | Prevents empty-response crashes by enforcing 2,560 tok floor. |
| **3. Token Estimation** | Static 3.5 char/token | `usageMark` hybrid anchoring | **Adopt** | Eliminates 12–18% cumulative estimation drift across long sessions. |
| **4. Cache Prefix Stability** | Mutates system prompt | Strict immutable prefix | **Improve** | Unlocks provider prompt caching for ~1,900 tokens per turn (~34% of prompt). |
| **5. Pre-Test Disk Flush** | Staged RAM only (stale disk) | Flush overlay before test | **Adopt** | Fixes critical correctness bug during `run_command` verification. |
| **6. Compaction Strategy** | Stub-then-drop | Two-stage + summary anchor | **Improve** | Prevents re-exploration turn waste seen in 24-turn baseline. |
| **7. Reasoning History Pruning** | Not replayed in history | Explicitly stripped | **Keep** | Protects against ~180k prompt token context inflation in Scenario (c). |
