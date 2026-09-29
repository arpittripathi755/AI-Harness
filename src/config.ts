import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL_ID,
  getMaxTokens,
  resolveMaxTokens,
  resolveModelId,
} from "./shared/models";
import { resolveModeId, type ModeId } from "./shared/modes";

export { DEFAULT_MAX_TOKENS, getMaxTokens, resolveMaxTokens };

/** SecretStorage key under which the Lightning API key is stored. */
const API_KEY_SECRET = "claudeAgent.apiKey";

/** globalState keys — these persist across VS Code restarts. */
const KEY_MODEL = "claudeAgent.model";
const KEY_MODE = "claudeAgent.mode";
const KEY_BASE_URL = "claudeAgent.baseUrl";
const KEY_TERMINAL_AUTO = "claudeAgent.terminalAutoRun";
const KEY_MAX_TOKENS = "claudeAgent.maxTokens";

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1/";

/**
 * Thrown when no API key has been configured yet. The SidebarProvider catches
 * this specifically and offers to open the API settings.
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super("No OpenRouter API key configured for Axiom.");
    this.name = "MissingApiKeyError";
  }
}

/** Resolved configuration needed to talk to the endpoint. */
export interface ResolvedConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxTokens: number;
}

/** Normalize a base URL to exactly one trailing slash. */
function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim() || DEFAULT_BASE_URL;
  return trimmed.replace(/\/+$/, "") + "/";
}

/** Read fallback key from .env file in workspace root if not in process.env. */
function readWorkspaceEnvFallback(keyName: string): string | undefined {
  try {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }
    const envPath = path.join(folders[0].uri.fsPath, ".env");
    if (!fs.existsSync(envPath)) {
      return undefined;
    }
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const k = trimmed.slice(0, eqIdx).trim();
        let v = trimmed.slice(eqIdx + 1).trim();
        v = v.replace(/^["'“”]+|["'“”]+$/g, "");
        if (k === keyName && v) {
          return v;
        }
      }
    }
  } catch {
    // Fail open
  }
  return undefined;
}

// ---- persisted settings (globalState) ----

export function getModelId(context: vscode.ExtensionContext): string {
  const envModel =
    process.env.MODEL?.trim() ||
    process.env.AI_MODEL?.trim() ||
    readWorkspaceEnvFallback("MODEL") ||
    readWorkspaceEnvFallback("AI_MODEL");
  if (envModel) {
    return resolveModelId(envModel);
  }
  const stored = context.globalState.get<string>(KEY_MODEL);
  if (!stored || stored.includes("lightning-ai") || stored === "ultra" || stored.includes("nemotron")) {
    return DEFAULT_MODEL_ID;
  }
  return resolveModelId(stored);
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

export function getBaseUrl(context: vscode.ExtensionContext, apiKey?: string): string {
  const envUrl =
    process.env.AI_BASE_URL?.trim() ||
    process.env.OPENROUTER_BASE_URL?.trim() ||
    process.env.BASE_URL?.trim() ||
    process.env.DEEPSEEK_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    readWorkspaceEnvFallback("AI_BASE_URL") ||
    readWorkspaceEnvFallback("OPENROUTER_BASE_URL") ||
    readWorkspaceEnvFallback("BASE_URL");
  if (envUrl) {
    return normalizeBaseUrl(envUrl);
  }
  const key =
    apiKey ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    process.env.AI_API_KEY?.trim() ||
    readWorkspaceEnvFallback("OPENROUTER_API_KEY") ||
    readWorkspaceEnvFallback("AI_API_KEY") ||
    "";
  if (key.startsWith("nvapi-")) {
    return "https://integrate.api.nvidia.com/v1/";
  }
  if (key.startsWith("sk-or-v1-")) {
    return "https://openrouter.ai/api/v1/";
  }
  const stored = context.globalState.get<string>(KEY_BASE_URL);
  if (stored && stored.includes("lightning.ai")) {
    return DEFAULT_BASE_URL;
  }
  return normalizeBaseUrl(stored ?? DEFAULT_BASE_URL);
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

/** Get the configured token output budget (persisted or environment variable fallback). */
export function getMaxTokensConfig(context?: vscode.ExtensionContext): number {
  const persisted = context?.globalState?.get<number>(KEY_MAX_TOKENS);
  return getMaxTokens(persisted);
}

/** Store a user-defined max token budget in globalState. */
export async function setMaxTokensConfig(
  context: vscode.ExtensionContext,
  value: number,
): Promise<void> {
  await context.globalState.update(KEY_MAX_TOKENS, resolveMaxTokens(value));
}

// ---- API key (Environment or SecretStorage) ----

function cleanEnvKey(val?: string): string | undefined {
  if (!val) {
    return undefined;
  }
  const cleaned = val.trim().replace(/^["'“”]+|["'“”]+$/g, "");
  return cleaned.length > 0 ? cleaned : undefined;
}

export async function getApiKey(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  const envKey = cleanEnvKey(
    process.env.OPENROUTER_API_KEY ||
    process.env.AI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    readWorkspaceEnvFallback("OPENROUTER_API_KEY") ||
    readWorkspaceEnvFallback("AI_API_KEY") ||
    readWorkspaceEnvFallback("DEEPSEEK_API_KEY") ||
    readWorkspaceEnvFallback("OPENAI_API_KEY")
  );
  if (envKey) {
    return envKey;
  }
  return context.secrets.get(API_KEY_SECRET);
}

export async function hasApiKey(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const key = await getApiKey(context);
  return !!key;
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
    baseUrl: getBaseUrl(context, apiKey),
    model: getModelId(context),
    apiKey,
    maxTokens: getMaxTokensConfig(context),
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
    title: "Axiom — OpenRouter API Key",
    prompt: "Paste your OpenRouter API key (sk-or-v1-...). Stored securely in VS Code SecretStorage.",
    password: true,
    ignoreFocusOut: true,
  });
  if (!value) {
    return false;
  }
  await setApiKey(context, value);
  return true;
}
