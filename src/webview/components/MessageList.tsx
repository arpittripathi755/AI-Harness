import * as React from "react";
import type { UiTimelineItem } from "../../shared/protocol";
import { MessageItem } from "./MessageItem";
import { ToolCard } from "./ToolCard";
import { Logo } from "./Logo";

interface MessageListProps {
  items: UiTimelineItem[];
  streamingId: string | null;
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS = [
  "What does this project do?",
  "Find and fix bugs in this codebase",
  "Explain the file I have open",
  "Add tests for the main module",
];

export function MessageList({
  items,
  streamingId,
  onSuggestion,
}: MessageListProps) {
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, streamingId]);

  if (items.length === 0) {
    return (
      <div className="message-list">
        <div className="empty-state">
          <Logo className="empty-logo-img" />
          <p className="empty-sub">
            Ask about your project, or tell me what to build or fix. I can read,
            search, and edit files in your workspace.
          </p>
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="suggestion"
                onClick={() => onSuggestion(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list">
      {items.map((item) =>
        item.kind === "tool" ? (
          <ToolCard key={item.callId} tool={item} />
        ) : (
          <MessageItem
            key={item.id}
            message={item}
            streaming={item.id === streamingId}
          />
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}
