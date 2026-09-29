import * as React from "react";
import { AxiomIcon } from "./AxiomIcon";

interface HeaderProps {
  busy: boolean;
  onChats: () => void;
  onNewChat: () => void;
  onOpenApi: () => void;
}

/**
 * Modern header/navbar featuring brand Axiom 6-node icon and clear, unclipped action buttons.
 */
export function Header({ busy, onChats, onNewChat, onOpenApi }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <button
          className="icon-btn"
          onClick={onChats}
          title="Toggle Sidebar (Chats & History)"
          aria-label="Toggle Sidebar"
        >
          {/* Classic Sidebar toggle icon */}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2.5" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
      </div>

      <div className="header-center">
        <div className="header-brand" onClick={onChats} title="View Chats & History" style={{ cursor: "pointer" }}>
          <AxiomIcon size={18} color="#4D8DFF" className="header-brand-icon" />
          <span className="header-wordmark">Axiom</span>
        </div>
      </div>

      <div className="header-actions">

        <button
          className="icon-btn"
          onClick={onNewChat}
          disabled={busy}
          title="New Chat"
          aria-label="New Chat"
        >
          {/* New Chat plus icon */}
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        <button
          className="icon-btn"
          onClick={onOpenApi}
          title="API & Runtime Settings"
          aria-label="Settings"
        >
          {/* Settings gear icon */}
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
}

export default Header;
