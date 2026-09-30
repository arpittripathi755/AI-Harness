import * as React from "react";

export type OrbState =
  | "breathing"
  | "searching"
  | "working"
  | "solving"
  | "listening"
  | "connecting"
  | "weaving"
  | "composing"
  | "shaping";

export type OrbSize = number;
export type OrbTheme = "dark" | "light";

export interface OrbColorOption {
  label: string;
  value?: string;
  hex: string;
}

export const ORB_STATES: OrbState[] = [
  "breathing",
  "searching",
  "working",
  "solving",
  "listening",
  "connecting",
  "weaving",
  "composing",
  "shaping",
];

export const ORB_COLORS: OrbColorOption[] = [
  { label: "Electric Blue", value: "#4D8DFF", hex: "#4D8DFF" },
  { label: "Soft Blue", value: "#8DB5FF", hex: "#8DB5FF" },
  { label: "Emerald", value: "#10b981", hex: "#10b981" },
  { label: "Cyan", value: "#06b6d4", hex: "#06b6d4" },
  { label: "Amber", value: "#f59e0b", hex: "#f59e0b" },
];

export interface OrbProps {
  state?: OrbState;
  defaultState?: OrbState;
  size?: OrbSize;
  display?: number;
  paused?: boolean;
  speed?: number;
  theme?: OrbTheme;
  color?: string;
  interactive?: boolean;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLElement>, nextState: OrbState) => void;
  onStateChange?: (state: OrbState) => void;
}

export function Orb({
  state: controlledState,
  defaultState = "working",
  size = 64,
  display,
  paused = false,
  speed = 1,
  theme = "dark",
  color = "#4D8DFF",
  interactive = false,
  className = "",
  onClick,
  onStateChange,
}: OrbProps) {
  const isControlled = controlledState !== undefined;
  const [internalState, setInternalState] = React.useState<OrbState>(defaultState);
  const currentState = isControlled ? controlledState : internalState;

  const px = display ?? size;

  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const currentIndex = ORB_STATES.indexOf(currentState);
      const nextIndex = (currentIndex + 1) % ORB_STATES.length;
      const nextState = ORB_STATES[nextIndex];

      if (!isControlled) {
        setInternalState(nextState);
      }
      onStateChange?.(nextState);
      onClick?.(e, nextState);
    },
    [currentState, isControlled, onClick, onStateChange],
  );

  const durationSec = Math.max(0.4, 2.5 / speed);
  const pulseDurationSec = Math.max(0.6, 1.8 / speed);

  const orbSvg = (
    <svg
      viewBox="0 0 100 100"
      width={px}
      height={px}
      style={{
        display: "block",
        overflow: "visible",
      }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`orb-core-grad-${px}`} cx="45%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="35%" stopColor={color} stopOpacity="0.85" />
          <stop offset="70%" stopColor="#1E3A8A" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#0B132B" stopOpacity="0.3" />
        </radialGradient>

        <radialGradient id={`orb-glow-grad-${px}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.6" />
          <stop offset="60%" stopColor={color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>

        <filter id={`orb-filter-glow-${px}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <style>{`
        @keyframes orbSpinClockwise {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes orbSpinCounter {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        @keyframes orbPulseMotion {
          0% { transform: scale(0.92); opacity: 0.75; }
          50% { transform: scale(1.06); opacity: 1; }
          100% { transform: scale(0.92); opacity: 0.75; }
        }
        @keyframes orbWaveMotion {
          0% { r: 36px; opacity: 0.5; }
          50% { r: 44px; opacity: 0.9; }
          100% { r: 36px; opacity: 0.5; }
        }
        .orb-outer-ring {
          transform-origin: 50px 50px;
          animation: ${paused ? "none" : `orbSpinClockwise ${durationSec}s linear infinite`};
        }
        .orb-inner-ring {
          transform-origin: 50px 50px;
          animation: ${paused ? "none" : `orbSpinCounter ${durationSec * 1.5}s linear infinite`};
        }
        .orb-core-pulse {
          transform-origin: 50px 50px;
          animation: ${paused ? "none" : `orbPulseMotion ${pulseDurationSec}s ease-in-out infinite`};
        }
      `}</style>

      {/* Ambient background glow */}
      <circle cx="50" cy="50" r="48" fill={`url(#orb-glow-grad-${px})`} />

      {/* Outer orbit ring */}
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeDasharray="18 10 6 10"
        strokeOpacity="0.45"
        className="orb-outer-ring"
      />

      {/* Secondary inner ring */}
      <circle
        cx="50"
        cy="50"
        r="33"
        fill="none"
        stroke="#8DB5FF"
        strokeWidth="1.2"
        strokeDasharray="8 6"
        strokeOpacity="0.35"
        className="orb-inner-ring"
      />

      {/* Pulsing Core Sphere */}
      <circle
        cx="50"
        cy="50"
        r="24"
        fill={`url(#orb-core-grad-${px})`}
        filter={`url(#orb-filter-glow-${px})`}
        className="orb-core-pulse"
      />

      {/* Highlight specular dot */}
      <circle cx="43" cy="42" r="3.5" fill="#FFFFFF" opacity="0.8" />
    </svg>
  );

  if (!interactive && !onClick) {
    return (
      <span
        className={`orb-wrapper ${className}`.trim()}
        style={{
          width: px,
          height: px,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          userSelect: "none",
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {orbSvg}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Orb state is ${currentState}. Click to cycle state.`}
      className={`orb-btn ${className}`.trim()}
      style={{
        width: px,
        height: px,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        userSelect: "none",
        borderRadius: "9999px",
        outline: "none",
        flexShrink: 0,
      }}
    >
      {orbSvg}
    </button>
  );
}

export const ThinkingOrbComponent = Orb;
export default Orb;
