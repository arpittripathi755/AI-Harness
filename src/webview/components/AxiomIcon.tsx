import * as React from "react";

interface AxiomIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  className?: string;
  color?: string;
}

/**
 * Axiom brand icon: 6 circular nodes in a hexagonal ring with pairwise bridging,
 * exactly matching the new visual identity.
 */
export function AxiomIcon({
  size = 20,
  className = "",
  color = "currentColor",
  ...props
}: AxiomIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={`axiom-icon ${className}`.trim()}
      {...props}
    >
      {/* Node connecting bridges */}
      <line x1="9" y1="6.5" x2="15" y2="6.5" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <line x1="5.8" y1="12" x2="8.5" y2="17.5" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <line x1="18.2" y1="12" x2="15.5" y2="17.5" stroke={color} strokeWidth="2.4" strokeLinecap="round" />

      {/* 6 Circular Nodes */}
      <circle cx="9" cy="6.5" r="2.6" fill={color} />
      <circle cx="15" cy="6.5" r="2.6" fill={color} />
      <circle cx="5.8" cy="12" r="2.6" fill={color} />
      <circle cx="18.2" cy="12" r="2.6" fill={color} />
      <circle cx="8.5" cy="17.5" r="2.6" fill={color} />
      <circle cx="15.5" cy="17.5" r="2.6" fill={color} />
    </svg>
  );
}

export default AxiomIcon;
