import * as React from "react";
import type { AgentStatus } from "../../shared/protocol";
import { Orb, type OrbState } from "./Orb";

interface StatusBarProps {
  status: AgentStatus;
  busy: boolean;
}

/** Playful words cycled when the concrete action is generic. */
const FUN_WORDS = [
  "Reasoning",
  "Analyzing",
  "Synthesizing",
  "Computing",
  "Exploring",
  "Formulating",
  "Refining",
  "Orchestrating",
  "Assembling",
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

/** Animated glowing ruby beacon with concentric radar waves */
function GlowingBeacon() {
  return (
    <div className="status-beacon" aria-hidden="true">
      <span className="status-beacon-core" />
      <span className="status-beacon-wave wave-1" />
      <span className="status-beacon-wave wave-2" />
    </div>
  );
}

/** Equalizer wave bars */
function EqualizerWave() {
  return (
    <div className="status-eq-bars" aria-hidden="true">
      <span className="eq-bar bar-1" />
      <span className="eq-bar bar-2" />
      <span className="eq-bar bar-3" />
      <span className="eq-bar bar-4" />
    </div>
  );
}

/** Live, animated status line with reddish glow styling */
export function StatusBar({ status, busy }: StatusBarProps) {
  const active = busy && status !== "Idle" && status !== "Finished";

  const [wordIdx, setWordIdx] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);

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

  const formatElapsed = (sec: number) => {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  return (
    <div className="status-bar-container">
      <div className={`status-bar ${active ? "status-active" : ""}`}>
        {active ? (
          <>
            <Orb
              state={
                status.startsWith("Searching") || status.startsWith("Reading")
                  ? "searching"
                  : status.startsWith("Editing")
                  ? "shaping"
                  : status.startsWith("Running terminal") || status.startsWith("Fetching")
                  ? "connecting"
                  : status.startsWith("Waiting")
                  ? "listening"
                  : "working"
              }
              size={20}
              display={20}
              color="#4D8DFF"
              theme="dark"
              interactive={false}
            />
            <EqualizerWave />
            <span className="status-badge">AXIOM</span>
            <span className="status-word">{word}…</span>
            <span className="status-elapsed">{formatElapsed(elapsed)}</span>
          </>
        ) : (
          <span className="status-text">{status}</span>
        )}
      </div>
    </div>
  );
}
