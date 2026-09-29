import * as React from "react";
import { MODES } from "../../shared/modes";
import { Dropdown } from "./Dropdown";
import { ModelSelector } from "./ui/model-selector";

interface ToolbarProps {
  modelId: string;
  modeId: string;
  onModelChange: (modelId: string) => void;
  onModeChange: (modeId: string) => void;
}

/** Compact model/mode selector row using the shadcn ModelSelector with provider logos. */
export function Toolbar({
  modelId,
  modeId,
  onModelChange,
  onModeChange,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-model-wrap">
        <span className="dropdown-label">Model</span>
        <ModelSelector value={modelId} onChange={onModelChange} />
      </div>
      <Dropdown
        label="Mode"
        value={modeId}
        title="Agent mode"
        options={MODES.map((m) => ({ value: m.id, label: m.label }))}
        onChange={onModeChange}
      />
    </div>
  );
}

export default Toolbar;
