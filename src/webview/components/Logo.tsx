import * as React from "react";

interface LogoProps {
  className?: string;
}

/** AXIOM wordmark, recreated as an inline SVG so it stays crisp at any size. */
const BRAND = "#EC5A52";

export function Logo({ className }: LogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 250 64"
      role="img"
      aria-label="Axiom"
      fill="none"
      stroke={BRAND}
      strokeWidth={8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* A */}
      <path d="M4 58 L22 8 L40 58" />
      <path d="M13 40 L31 40" />
      {/* X */}
      <path d="M54 10 L92 58" />
      <path d="M92 10 L54 58" />
      {/* I */}
      <path d="M108 10 L108 58" />
      {/* O */}
      <circle cx="146" cy="34" r="24" />
      {/* M */}
      <path d="M184 58 L184 10 L212 46 L240 10 L240 58" />
    </svg>
  );
}
