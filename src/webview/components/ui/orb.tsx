"use client";

import * as React from "react";
import { ThinkingOrb, type OrbState, type OrbSize, type OrbTheme } from "thinking-orbs";

export type { OrbState, OrbSize, OrbTheme } from "thinking-orbs";

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

export interface OrbColorOption {
  label: string;
  value?: string;
  hex: string;
}

export const ORB_COLORS: OrbColorOption[] = [
  { label: "Default", value: undefined, hex: "#ffffff" },
  { label: "Electric Blue", value: "#4D8DFF", hex: "#4D8DFF" },
  { label: "Soft Blue", value: "#8DB5FF", hex: "#8DB5FF" },
  { label: "Beige", value: "#e8d8c8", hex: "#e8d8c8" },
  { label: "Red", value: "#ef4444", hex: "#ef4444" },
  { label: "Amber", value: "#f59e0b", hex: "#f59e0b" },
  { label: "Emerald", value: "#10b981", hex: "#10b981" },
  { label: "Cyan", value: "#06b6d4", hex: "#06b6d4" },
  { label: "Blue", value: "#3b82f6", hex: "#3b82f6" },
  { label: "Violet", value: "#8b5cf6", hex: "#8b5cf6" },
  { label: "Rose", value: "#ec4899", hex: "#ec4899" },
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

  const canvas = (
    <ThinkingOrb
      state={currentState}
      size={size}
      theme={theme}
      speed={speed}
      paused={paused}
      color={color}
      style={{ width: px, height: px, display: "block" }}
    />
  );

  if (!interactive && !onClick) {
    return (
      <span
        className={`orb-wrapper ${className}`.trim()}
        style={{ width: px, height: px, display: "inline-flex", alignItems: "center", justifyContent: "center", userSelect: "none", flexShrink: 0 }}
        aria-hidden="true"
      >
        {canvas}
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
      {canvas}
    </button>
  );
}

export const ThinkingOrbComponent = Orb;
export default Orb;
