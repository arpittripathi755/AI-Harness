import * as React from "react";
import type {
  AgentStatus,
  ChatSummary,
  UiSettings,
  UiTimelineItem,
} from "../shared/protocol";
import { DEFAULT_MODEL_ID, modelSupportsTools } from "../shared/models";
import { DEFAULT_MODE } from "../shared/modes";
import { onMessage, postMessage } from "./vscodeApi";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { Header } from "./components/Header";
import { Toolbar } from "./components/Toolbar";
import { ApiModal } from "./components/ApiModal";
import { ChatList } from "./components/ChatList";
import { StatusBar } from "./components/StatusBar";

const INITIAL_SETTINGS: UiSettings = {
  modelId: DEFAULT_MODEL_ID,
  modeId: DEFAULT_MODE,
  baseUrl: "https://lightning.ai/api/v1/",
  hasApiKey: false,
  terminalAutoRun: false,
};

export function App() {
  const [items, setItems] = React.useState<UiTimelineItem[]>([]);
  const [streamingId, setStreamingId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState<UiSettings>(INITIAL_SETTINGS);
  const [status, setStatus] = React.useState<AgentStatus>("Idle");
  const [apiOpen, setApiOpen] = React.useState(false);
  const [chats, setChats] = React.useState<ChatSummary[]>([]);
  const [activeChat, setActiveChat] = React.useState<string | undefined>();
  const [chatsOpen, setChatsOpen] = React.useState(false);

  React.useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      switch (msg.type) {
        case "init":
        case "settings":
          setSettings(msg.settings);
          break;
        case "chats":
          setChats(msg.list);
          setActiveChat(msg.activeId);
          break;
        case "openApiSettings":
          setApiOpen(true);
          break;
        case "status":
          setStatus(msg.status);
          break;
        case "restore":
          // Full timeline for the active chat (initial load or chat switch).
          setItems(msg.items);
          setStreamingId(null);
          setError(null);
          setStatus("Idle");
          setChatsOpen(false);
          break;
        case "assistantStart":
          setError(null);
          setStreamingId(msg.id);
          setItems((prev) => [
            ...prev,
            { kind: "message", id: msg.id, role: "assistant", content: "" },
          ]);
          break;
        case "assistantDelta":
          setItems((prev) =>
            prev.map((it) =>
              it.kind === "message" && it.id === msg.id
                ? { ...it, content: it.content + msg.delta }
                : it,
            ),
          );
          break;
        case "assistantDone":
          setStreamingId((cur) => (cur === msg.id ? null : cur));
          break;
        case "toolStart":
          setItems((prev) => [
            ...prev,
            {
              kind: "tool",
              callId: msg.callId,
              name: msg.name,
              title: msg.title,
              status: "running",
            },
          ]);
          break;
        case "toolEnd":
          setItems((prev) =>
            prev.map((it) =>
              it.kind === "tool" && it.callId === msg.callId
                ? { ...it, status: msg.ok ? "ok" : "error", summary: msg.summary }
                : it,
            ),
          );
          break;
        case "busy":
          setBusy(msg.value);
          break;
        case "error":
          setError(msg.message || null);
          setStreamingId(null);
          break;
      }
    });

    postMessage({ type: "ready" });
    return unsubscribe;
  }, []);

  const handleSend = (text: string, images: string[] = []) => {
    setItems((prev) => [
      ...prev,
      {
        kind: "message",
        id: `u${prev.length}-${Date.now()}`,
        role: "user",
        content: text,
        images: images.length ? images : undefined,
      },
    ]);
    postMessage({ type: "sendMessage", text, images: images.length ? images : undefined });
  };

  const handleModelChange = (modelId: string) => {
    setSettings((s) => ({ ...s, modelId }));
    postMessage({ type: "setModel", modelId });
  };

  const handleModeChange = (modeId: string) => {
    setSettings((s) => ({ ...s, modeId }));
    postMessage({ type: "setMode", modeId });
  };

  const handleSaveApi = (baseUrl: string, apiKey?: string) => {
    postMessage({ type: "saveApiSettings", baseUrl, apiKey });
  };

  const handleTerminalMode = (value: boolean) => {
    setSettings((s) => ({ ...s, terminalAutoRun: value }));
    postMessage({ type: "setTerminalAutoRun", value });
  };

  return (
    <div className="app">
      <Header
        busy={busy}
        onChats={() => setChatsOpen(true)}
        onNewChat={() => postMessage({ type: "newChat" })}
        onOpenApi={() => setApiOpen(true)}
      />

      <MessageList
        items={items}
        streamingId={streamingId}
        onSuggestion={handleSend}
      />

      {error && <div className="error-banner">{error}</div>}

      {!modelSupportsTools(settings.modelId) ? (
        <div className="mode-notice warn">
          ⚠ This model can’t use tools on this endpoint — chat only, no file access.
          Pick a Claude model to read &amp; edit files.
        </div>
      ) : settings.modeId === "plan" ? (
        <div className="mode-notice">
          🔍 <strong>Plan Mode</strong> — read-only. The agent can inspect and explain,
          but won’t edit files. Switch to <strong>Auto Edit</strong> below to make changes.
        </div>
      ) : null}

      <StatusBar status={status} busy={busy} />

      <div className="footer">
        <Toolbar
          modelId={settings.modelId}
          modeId={settings.modeId}
          onModelChange={handleModelChange}
          onModeChange={handleModeChange}
        />
        <Composer
          busy={busy}
          onSend={handleSend}
          onStop={() => postMessage({ type: "cancel" })}
        />
      </div>

      {chatsOpen && (
        <ChatList
          chats={chats}
          activeId={activeChat}
          onSelect={(id) => postMessage({ type: "switchChat", id })}
          onDelete={(id) => postMessage({ type: "deleteChat", id })}
          onNew={() => postMessage({ type: "newChat" })}
          onClose={() => setChatsOpen(false)}
        />
      )}

      {apiOpen && (
        <ApiModal
          baseUrl={settings.baseUrl}
          hasApiKey={settings.hasApiKey}
          terminalAutoRun={settings.terminalAutoRun}
          onSave={handleSaveApi}
          onTerminalAutoRunChange={handleTerminalMode}
          onClose={() => setApiOpen(false)}
        />
      )}
    </div>
  );
}
