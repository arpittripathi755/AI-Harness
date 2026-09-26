import * as React from "react";
import { MODELS } from "../../shared/models";
import { MODES } from "../../shared/modes";
import { Dropdown } from "./Dropdown";

interface ToolbarProps {
  modelId: string;
  modeId: string;
  onModelChange: (modelId: string) => void;
  onModeChange: (modeId: string) => void;
}

/** Compact model/mode selector row, docked just above the composer. */
export function Toolbar({
  modelId,
  modeId,
  onModelChange,
  onModeChange,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <Dropdown
        label="Model"
        value={modelId}
        title="Model used for API requests"
        options={MODELS.map((m) => ({
          value: m.apiModelId,
          label: m.displayName,
        }))}
        onChange={onModelChange}
      />
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
