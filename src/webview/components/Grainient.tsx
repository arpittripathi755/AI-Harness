import * as React from "react";
import "./Grainient.css";

export interface GrainientProps {
  color1?: string;
  color2?: string;
  color3?: string;
  className?: string;
  [key: string]: any;
}

export const Grainient: React.FC<GrainientProps> = ({
  className = "",
}) => {
  return (
    <div className={`grainient-container ${className}`.trim()} aria-hidden="true">
      <div className="grainient-mesh" />
      <div className="grainient-glow-primary" />
      <div className="grainient-glow-secondary" />
    </div>
  );
};

export default Grainient;
