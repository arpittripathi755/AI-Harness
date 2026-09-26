import * as React from "react";
import type { ChatSummary } from "../../shared/protocol";

interface ChatListProps {
  chats: ChatSummary[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

/** Slide-down panel listing all chats, like Claude Code's chat history. */
export function ChatList({
  chats,
  activeId,
  onSelect,
  onDelete,
  onNew,
  onClose,
}: ChatListProps) {
  return (
    <div className="chatlist-overlay" onClick={onClose}>
      <div className="chatlist" onClick={(e) => e.stopPropagation()}>
        <div className="chatlist-header">
          <span>Chats</span>
          <button className="btn btn-send chatlist-new" onClick={onNew}>
            ＋ New
          </button>
        </div>
        <div className="chatlist-items">
          {chats.length === 0 && <div className="chatlist-empty">No chats yet.</div>}
          {chats.map((c) => (
            <div
              key={c.id}
              className={`chatlist-item${c.id === activeId ? " active" : ""}`}
              onClick={() => onSelect(c.id)}
            >
              <span className="chatlist-title">{c.title || "New Chat"}</span>
              <button
                className="chatlist-delete"
                title="Delete chat"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
