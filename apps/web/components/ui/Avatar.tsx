// Round initials avatar. Brand-blue by default; pass `color` to override.
export function Avatar({
  name = '',
  size = 28,
  color,
}: {
  name?: string;
  size?: number;
  color?: string;
}) {
  const initials = name
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.38, background: color }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
