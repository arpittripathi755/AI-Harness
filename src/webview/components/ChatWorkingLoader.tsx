import * as React from "react";
import type { AgentStatus } from "../../shared/protocol";
import { Orb, type OrbState } from "./Orb";

interface ChatWorkingLoaderProps {
  status: AgentStatus;
}

const PHRASES = [
  "Reasoning through your prompt",
  "Analyzing project architecture",
  "Synthesizing optimal solution",
  "Computing agent steps",
  "Exploring workspace context",
  "Assembling response",
];

function mapStatusToOrbState(status: AgentStatus, phraseIdx: number): OrbState {
  if (!status || status === "Idle" || status === "Finished") {
    const cycle: OrbState[] = ["working", "solving", "weaving", "composing"];
    return cycle[phraseIdx % cycle.length];
  }
  if (status.startsWith("Searching") || status.startsWith("Reading")) {
    return "searching";
  }
  if (status.startsWith("Editing")) {
    return "shaping";
  }
  if (status.startsWith("Running terminal") || status.startsWith("Fetching")) {
    return "connecting";
  }
  if (status.startsWith("Waiting")) {
    return "listening";
  }
  return "working";
}

export function ChatWorkingLoader({ status }: ChatWorkingLoaderProps) {
  const [phraseIdx, setPhraseIdx] = React.useState(0);

  React.useEffect(() => {
    const id = window.setInterval(() => {
      setPhraseIdx((i) => (i + 1) % PHRASES.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, []);

  const displayStatus =
    status && status !== "Idle" && status !== "Finished"
      ? status
      : PHRASES[phraseIdx];

  const orbState = mapStatusToOrbState(status, phraseIdx);

  return (
    <div className="msg msg-assistant msg-working" aria-live="polite">
      <div className="msg-content">
        <div className="working-card working-card-orb">
          <div className="working-orb-wrapper">
            <div className="working-orb-glow" aria-hidden="true" />
            <Orb
              state={orbState}
              size={64}
              display={56}
              color="#4D8DFF"
              speed={1.15}
              theme="dark"
              interactive={true}
            />
          </div>

          <div className="working-orb-body">
            <div className="working-orb-header">
              <span className="working-orb-badge">AXIOM AGENT</span>
              <span className="working-orb-state-chip">{orbState}</span>
            </div>
            <div className="working-status-text">{displayStatus}</div>
            <div className="working-shimmer-bar">
              <div className="working-shimmer-thumb" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatWorkingLoader;
