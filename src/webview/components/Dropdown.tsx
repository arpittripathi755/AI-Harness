import * as React from "react";

export interface DropdownOption {
  value: string;
  label: string;
  group?: string;
}

interface DropdownProps {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
}

/**
 * A compact themed dropdown. Uses a native <select> for accessibility and
 * keyboard support, styled to blend into the header.
 * Automatically organizes options into <optgroup> when options define a `group`.
 */
export function Dropdown({
  label,
  value,
  options,
  onChange,
  disabled,
  title,
}: DropdownProps) {
  const hasGroups = options.some((o) => !!o.group);

  let selectChildren: React.ReactNode;
  if (hasGroups) {
    const groups = new Map<string, DropdownOption[]>();
    for (const opt of options) {
      const g = opt.group || "Other";
      if (!groups.has(g)) {
        groups.set(g, []);
      }
      groups.get(g)!.push(opt);
    }
    selectChildren = Array.from(groups.entries()).map(([grp, opts]) => (
      <optgroup key={grp} label={grp}>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </optgroup>
    ));
  } else {
    selectChildren = options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ));
  }

  return (
    <label className="dropdown" title={title}>
      <span className="dropdown-label">{label}</span>
      <select
        className="dropdown-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {selectChildren}
      </select>
    </label>
  );
}
