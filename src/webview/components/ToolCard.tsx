import * as React from "react";
import type { UiToolCall } from "../../shared/protocol";

interface ToolCardProps {
  tool: UiToolCall;
}

const STATUS_ICON: Record<UiToolCall["status"], string> = {
  running: "◍",
  ok: "✓",
  error: "✗",
};

export function ToolCard({ tool }: ToolCardProps) {
  return (
    <div className={`tool-card tool-${tool.status}`}>
      <span className="tool-icon">{STATUS_ICON[tool.status]}</span>
      <div className="tool-body">
        <div className="tool-title">{tool.title}</div>
        {tool.summary && tool.status !== "running" && (
          <div className="tool-summary">{tool.summary}</div>
        )}
      </div>
    </div>
  );
}
