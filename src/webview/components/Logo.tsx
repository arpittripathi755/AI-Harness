import * as React from "react";

interface LogoProps {
  className?: string;
  showIcon?: boolean;
}

/**
 * Axiom brand mark — 4-pointed spark in dark blue palette.
 * Used only if explicitly imported; Header now uses a plain wordmark span.
 */
export function Logo({ className, showIcon = true }: LogoProps) {
  return (
    <div className={`axiom-brand ${className || ""}`}>
      {showIcon && (
        <div className="axiom-squircle" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            className="axiom-squircle-svg"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient
                id="logo-spark-grad"
                x1="2" y1="2" x2="22" y2="22"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%"   stopColor="#8DB5FF" />
                <stop offset="55%"  stopColor="#4D8DFF" />
                <stop offset="100%" stopColor="#3672E0" />
              </linearGradient>
            </defs>
            <path
              d="M12 2 L13.6 9.5 L21 12 L13.6 14.5 L12 22 L10.4 14.5 L3 12 L10.4 9.5 Z"
              fill="url(#logo-spark-grad)"
            />
          </svg>
        </div>
      )}
      <span className="axiom-logotype">Axiom</span>
    </div>
  );
}

/** Large hero emblem (currently not used — hello SVG is the hero centerpiece) */
export function AxiomHeroBadge({ className }: { className?: string }) {
  return (
    <div
      className={`axiom-hero-squircle ${className || ""}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 40 40"
        className="axiom-hero-svg"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient
            id="hero-spark-grad"
            x1="2" y1="2" x2="38" y2="38"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%"   stopColor="#8DB5FF" />
            <stop offset="50%"  stopColor="#4D8DFF" />
            <stop offset="100%" stopColor="#2A5BBF" />
          </linearGradient>
          <filter id="hero-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          d="M20 3 L22.8 16.5 L37 20 L22.8 23.5 L20 37 L17.2 23.5 L3 20 L17.2 16.5 Z"
          fill="url(#hero-spark-grad)"
          filter="url(#hero-glow)"
        />
      </svg>
    </div>
  );
}
