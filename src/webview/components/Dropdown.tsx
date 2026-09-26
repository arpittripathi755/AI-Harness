import * as React from "react";

interface DropdownProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
}

/**
 * A compact themed dropdown. Uses a native <select> for accessibility and
 * keyboard support, styled to blend into the header.
 */
export function Dropdown({
  label,
  value,
  options,
  onChange,
  disabled,
  title,
}: DropdownProps) {
  return (
    <label className="dropdown" title={title}>
      <span className="dropdown-label">{label}</span>
      <select
        className="dropdown-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
