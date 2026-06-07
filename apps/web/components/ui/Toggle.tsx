// Controlled switch. The broadcast-subscription toggle (design-brief §8) is
// hidden for HM/BM at the call site; this atom is presentational only.
export function Toggle({
  checked,
  onChange,
  label,
  size = 'md',
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  size?: 'md' | 'sm';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
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
