import * as React from "react";

interface ApiModalProps {
  baseUrl: string;
  hasApiKey: boolean;
  terminalAutoRun: boolean;
  onSave: (baseUrl: string, apiKey?: string) => void;
  onTerminalAutoRunChange: (value: boolean) => void;
  onClose: () => void;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1/";

/**
 * Settings modal: OpenRouter base URL + API key (write-only, stored in
 * SecretStorage) and the terminal command execution mode (auto / manual).
 */
export function ApiModal({
  baseUrl,
  hasApiKey,
  terminalAutoRun,
  onSave,
  onTerminalAutoRunChange,
  onClose,
}: ApiModalProps) {
  const [url, setUrl] = React.useState(baseUrl || DEFAULT_BASE_URL);
  const [key, setKey] = React.useState("");

  const save = () => {
    onSave(url.trim() || DEFAULT_BASE_URL, key.trim() ? key.trim() : undefined);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings</h3>
          <button className="btn btn-ghost modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <label className="field">
          <span className="field-label">Base URL</span>
          <input
            className="field-input"
            type="text"
            value={url}
            placeholder={DEFAULT_BASE_URL}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">
            Lightning API Key{" "}
            <span className="field-hint">
              {hasApiKey ? "(a key is saved — leave blank to keep it)" : "(required)"}
            </span>
          </span>
          <input
            className="field-input"
            type="password"
            value={key}
            placeholder={hasApiKey ? "••••••••" : "Paste your API key"}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>

        <div className="field">
          <span className="field-label">Terminal commands</span>
          <div className="segmented">
            <button
              className={`segment${!terminalAutoRun ? " active" : ""}`}
              onClick={() => onTerminalAutoRunChange(false)}
            >
              Manual
            </button>
            <button
              className={`segment${terminalAutoRun ? " active" : ""}`}
              onClick={() => onTerminalAutoRunChange(true)}
            >
              Auto
            </button>
          </div>
          <span className="field-note">
            {terminalAutoRun
              ? "⚠ Terminal commands run automatically without asking. Use with care."
              : "The agent asks for confirmation before running any terminal command."}
          </span>
        </div>

        <p className="field-note">
          Your key is stored securely in VS Code SecretStorage and never leaves your machine
          except in requests to the endpoint above.
        </p>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-send" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
