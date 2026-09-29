import * as React from "react";
import type { AgentStatus, UiTimelineItem } from "../../shared/protocol";
import { MessageItem } from "./MessageItem";
import { ToolCard } from "./ToolCard";
import { ChatWorkingLoader } from "./ChatWorkingLoader";
import { AppleHelloEnglishEffect } from "./AppleHelloEffect";

interface MessageListProps {
  items: UiTimelineItem[];
  streamingId: string | null;
  busy?: boolean;
  status?: AgentStatus;
  onSuggestion: (text: string) => void;
}

interface Capability {
  title: string;
  description: string;
  prompt: string;
}

const CAPABILITIES: Capability[] = [
  {
    title: "Codebase\nInsights",
    description: "Explore architecture, search dependencies, and explain open files.",
    prompt: "What does this project do and how is it structured?",
  },
  {
    title: "Debug &\nFix Issues",
    description: "Diagnose errors, trace execution bugs, and apply fixes automatically.",
    prompt: "Find and fix bugs in this codebase",
  },
  {
    title: "Feature\nBuilder",
    description: "Implement new components, write logic, and wire up project modules.",
    prompt: "Help me implement a new feature in this project",
  },
  {
    title: "Terminal &\nTesting",
    description: "Execute terminal commands, verify builds, and add unit test coverage.",
    prompt: "Add tests for the main module and verify execution",
  },
];

export function MessageList({
  items,
  streamingId,
  busy = false,
  status = "Idle",
  onSuggestion,
}: MessageListProps) {
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, streamingId, busy]);

  // Determine if we should show the working loader in the chat stream
  const lastItem = items.length > 0 ? items[items.length - 1] : null;
  const isAssistantThinking =
    busy &&
    (!streamingId ||
      (lastItem?.kind === "message" &&
        (lastItem.role === "user" || (lastItem.role === "assistant" && lastItem.content.trim() === ""))) ||
      lastItem?.kind === "tool");

  if (items.length === 0) {
    if (busy) {
      return (
        <div className="message-list">
          <ChatWorkingLoader status={status} />
          <div ref={endRef} />
        </div>
      );
    }
    return (
      <div className="message-list message-list-empty">
        <div className="empty-state">
          {/* Animated Apple Hello-style "hello" SVG */}
          <div className="hero-hello-wrap">
            <AppleHelloEnglishEffect
              speed={0.9}
              className="hero-hello-svg"
            />
          </div>

          <h2 className="hero-headline">
            How can we <span className="hero-highlight">assist</span> you today?
          </h2>

          <p className="hero-desc">
            AI-powered agents that read, write, debug, and run terminal commands
            across your entire workspace — all in one place.
          </p>

          {/* Capability Cards */}
          <div className="cards-grid">
            {CAPABILITIES.map((cap) => (
              <button
                key={cap.title}
                className="capability-card"
                onClick={() => onSuggestion(cap.prompt)}
              >
                <div className="card-top-row">
                  <span className="card-headline">{cap.title}</span>
                  <div className="card-arrow-circle" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="7" y1="17" x2="17" y2="7" />
                      <polyline points="7 7 17 7 17 17" />
                    </svg>
                  </div>
                </div>
                <p className="card-subtext">{cap.description}</p>
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

      {isAssistantThinking && <ChatWorkingLoader status={status} />}

      <div ref={endRef} />
    </div>
  );
}
