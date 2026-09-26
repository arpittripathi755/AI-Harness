import * as React from "react";
import { Logo } from "./Logo";

interface HeaderProps {
  busy: boolean;
  onChats: () => void;
  onNewChat: () => void;
  onOpenApi: () => void;
}

/** Minimal top bar: chats + brand on the left, actions on the right. */
export function Header({ busy, onChats, onNewChat, onOpenApi }: HeaderProps) {
  return (
    <div className="header">
      <div className="header-left">
        <button
          className="icon-btn"
          onClick={onChats}
          title="Chats"
          aria-label="Chats"
        >
          ☰
        </button>
        <Logo className="header-logo" />
      </div>
      <div className="header-actions">
        <button
          className="icon-btn"
          onClick={onNewChat}
          disabled={busy}
          title="New chat"
          aria-label="New chat"
        >
          ＋
        </button>
        <button
          className="icon-btn"
          onClick={onOpenApi}
          title="Settings"
          aria-label="Settings"
        >
          ⚙
        </button>
      </div>
    </div>
  );
}
