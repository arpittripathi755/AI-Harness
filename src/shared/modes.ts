/**
 * Agent Mode Registry — the single source of truth for agent modes. Shared by
 * both bundles: the webview shows `label`, the agent uses `id` + `allowMutations`.
 * Add a future mode here only.
 */

export type ModeId = "plan" | "auto";

export interface ModeInfo {
  id: ModeId;
  label: string;
  description: string;
  /**
   * Whether the agent may run file-mutating tools automatically. In Plan mode the
   * agent inspects/reads/searches and explains proposed changes, but does not edit.
   */
  allowMutations: boolean;
}

export const MODES: ModeInfo[] = [
  {
    id: "plan",
    label: "Plan Mode",
    description:
      "Analyze, inspect, read, and search — then explain the changes to make. Does not modify files.",
    allowMutations: false,
  },
  {
    id: "auto",
    label: "Auto Edit Mode",
    description:
      "Inspect, read, search, create, edit, and rename files autonomously until the task is done.",
    allowMutations: true,
  },
];

export const DEFAULT_MODE: ModeId = "auto";

export function resolveModeId(id: string | undefined): ModeId {
  return MODES.some((m) => m.id === id) ? (id as ModeId) : DEFAULT_MODE;
}

export function getMode(id: ModeId): ModeInfo {
  return MODES.find((m) => m.id === id) ?? MODES[1];
}
