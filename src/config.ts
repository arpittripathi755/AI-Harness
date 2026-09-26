import * as vscode from "vscode";
import { resolveModelId } from "./shared/models";
import { resolveModeId, type ModeId } from "./shared/modes";

/** SecretStorage key under which the Lightning API key is stored. */
const API_KEY_SECRET = "claudeAgent.apiKey";

/** globalState keys — these persist across VS Code restarts. */
const KEY_MODEL = "claudeAgent.model";
const KEY_MODE = "claudeAgent.mode";
const KEY_BASE_URL = "claudeAgent.baseUrl";
const KEY_TERMINAL_AUTO = "claudeAgent.terminalAutoRun";

export const DEFAULT_BASE_URL = "https://lightning.ai/api/v1/";

/**
 * Thrown when no API key has been configured yet. The SidebarProvider catches
 * this specifically and offers to open the API settings.
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super("No API key configured for Axiom.");
    this.name = "MissingApiKeyError";
  }
}

/** Resolved configuration needed to talk to the endpoint. */
export interface ResolvedConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Normalize a base URL to exactly one trailing slash. */
function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim() || DEFAULT_BASE_URL;
  return trimmed.replace(/\/+$/, "") + "/";
}

// ---- persisted settings (globalState) ----

export function getModelId(context: vscode.ExtensionContext): string {
  return resolveModelId(context.globalState.get<string>(KEY_MODEL));
}

export async function setModelId(
  context: vscode.ExtensionContext,
  apiModelId: string,
): Promise<void> {
  await context.globalState.update(KEY_MODEL, resolveModelId(apiModelId));
}

export function getModeId(context: vscode.ExtensionContext): ModeId {
  return resolveModeId(context.globalState.get<string>(KEY_MODE));
}

export async function setModeId(
  context: vscode.ExtensionContext,
  mode: string,
): Promise<void> {
  await context.globalState.update(KEY_MODE, resolveModeId(mode));
}

export function getBaseUrl(context: vscode.ExtensionContext): string {
  return normalizeBaseUrl(
    context.globalState.get<string>(KEY_BASE_URL) ?? DEFAULT_BASE_URL,
  );
}

export async function setBaseUrl(
  context: vscode.ExtensionContext,
  baseUrl: string,
): Promise<void> {
  await context.globalState.update(KEY_BASE_URL, normalizeBaseUrl(baseUrl));
}

/** Whether terminal commands run automatically (true) or need confirmation (false). */
export function getTerminalAutoRun(context: vscode.ExtensionContext): boolean {
  return context.globalState.get<boolean>(KEY_TERMINAL_AUTO) === true;
}

export async function setTerminalAutoRun(
  context: vscode.ExtensionContext,
  value: boolean,
): Promise<void> {
  await context.globalState.update(KEY_TERMINAL_AUTO, value);
}

// ---- API key (Environment or SecretStorage) ----

export async function getApiKey(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  const envKey = process.env.AI_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }
  return context.secrets.get(API_KEY_SECRET);
}

export async function hasApiKey(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const envKey = process.env.AI_API_KEY?.trim();
  if (envKey) {
    return true;
  }
  return !!(await context.secrets.get(API_KEY_SECRET));
}

/** Store (or clear) the API key in SecretStorage. */
export async function setApiKey(
  context: vscode.ExtensionContext,
  value: string,
): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) {
    await context.secrets.store(API_KEY_SECRET, trimmed);
  } else {
    await context.secrets.delete(API_KEY_SECRET);
  }
}

/**
 * Resolve everything needed for a request. Throws {@link MissingApiKeyError}
 * if the key has not been set yet.
 */
export async function resolveConfig(
  context: vscode.ExtensionContext,
): Promise<ResolvedConfig> {
  const apiKey = await getApiKey(context);
  if (!apiKey) {
    throw new MissingApiKeyError();
  }
  return {
    baseUrl: getBaseUrl(context),
    model: getModelId(context),
    apiKey,
  };
}

/**
 * Prompt the user for an API key and persist it in SecretStorage.
 * Returns true if a key was stored. (Used by the command palette entry.)
 */
export async function promptAndStoreApiKey(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const value = await vscode.window.showInputBox({
    title: "Axiom — Lightning API Key",
    prompt: "Paste your Lightning API key. It is stored securely in VS Code SecretStorage.",
    password: true,
    ignoreFocusOut: true,
  });
  if (!value) {
    return false;
  }
  await setApiKey(context, value);
  return true;
}
