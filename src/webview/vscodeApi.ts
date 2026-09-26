import type { ExtensionToWebview, WebviewToExtension } from "../shared/protocol";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// `acquireVsCodeApi` may only be called once per webview load.
const vscode = acquireVsCodeApi();

/** Send a typed message to the extension host. */
export function postMessage(message: WebviewToExtension): void {
  vscode.postMessage(message);
}

/** Subscribe to typed messages from the extension host. Returns an unsubscribe fn. */
export function onMessage(
  handler: (message: ExtensionToWebview) => void,
): () => void {
  const listener = (event: MessageEvent) => handler(event.data as ExtensionToWebview);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
