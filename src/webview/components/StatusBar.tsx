import * as React from "react";
import type { AgentStatus } from "../../shared/protocol";

interface StatusBarProps {
  status: AgentStatus;
  busy: boolean;
}

/** Braille spinner frames (Claude Code-style). */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Playful words cycled when the concrete action is generic. */
const FUN_WORDS = [
  "Axioming",
  "Thinking",
  "Pondering",
  "Computing",
  "Reasoning",
  "Cooking",
  "Crunching",
  "Synthesizing",
  "Noodling",
  "Percolating",
  "Conjuring",
];

/** Statuses specific enough to show verbatim instead of a fun word. */
const SPECIFIC = new Set<AgentStatus>([
  "Searching workspace…",
  "Reading files…",
  "Editing files…",
  "Running terminal command…",
  "Waiting for approval…",
  "Rate limited — retrying…",
  "Searching web…",
  "Fetching web page…",
]);

/** Animated Axiom "A" mark that pulses while working. */
function AnimatedMark() {
  return (
    <svg
      className="status-mark"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#EC5A52"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20 L12 4 L20 20" />
      <path d="M8 14 L16 14" />
    </svg>
  );
}

/** Live, animated status line so the user always knows what the agent is doing. */
export function StatusBar({ status, busy }: StatusBarProps) {
  const active = busy && status !== "Idle" && status !== "Finished";

  const [frame, setFrame] = React.useState(0);
  const [wordIdx, setWordIdx] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);

  // Spinner animation.
  React.useEffect(() => {
    if (!active) {
      return;
    }
    const id = window.setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 90);
    return () => window.clearInterval(id);
  }, [active]);

  // Cycle the playful word (only used when the status is generic).
  React.useEffect(() => {
    if (!active) {
      return;
    }
    const id = window.setInterval(
      () => setWordIdx((i) => (i + 1) % FUN_WORDS.length),
      2200,
    );
    return () => window.clearInterval(id);
  }, [active]);

  // Elapsed timer, reset whenever a new active run starts.
  React.useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [active]);

  if (!busy && (status === "Idle" || status === "Finished")) {
    return null;
  }

  const word = SPECIFIC.has(status)
    ? status.replace(/…$/, "")
    : FUN_WORDS[wordIdx];

  return (
    <div className="status-bar">
      {active ? (
        <>
          <AnimatedMark />
          <span className="status-spinner">{SPINNER[frame]}</span>
          <span className="status-word">{word}…</span>
          <span className="status-elapsed">{elapsed}s</span>
        </>
      ) : (
        <span className="status-text">{status}</span>
      )}
    </div>
  );
}
