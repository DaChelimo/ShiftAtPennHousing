// Controlled switch. The broadcast-subscription toggle (design-brief §8) is
// hidden for HM/BM at the call site; this atom is presentational only.
export function Toggle({
  checked,
  onChange,
  label,
  ariaLabel,
  size = 'md',
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  // Accessible name when the switch shows no visible `label` text (e.g. a switch in
  // a table column whose meaning comes from the column header).
  ariaLabel?: string;
  size?: 'md' | 'sm';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      className={`toggle toggle-${size} ${checked ? 'is-on' : ''}`.trim()}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className="toggle-track">
        <span className="toggle-knob" />
      </span>
      {label && <span className="toggle-label">{label}</span>}
    </button>
  );
}
