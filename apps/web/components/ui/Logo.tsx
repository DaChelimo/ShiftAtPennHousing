import {
  BRAND_COLORS,
  BRAND_LOWER_PATH,
  BRAND_UPPER_PATH,
  BRAND_UPPER_PATH_MONO,
  BRAND_VIEW_BOX,
} from '../../lib/brandPaths';

/**
 * The chevronel. Path data is generated from scripts/brand/geometry.mjs, the
 * same source as the favicon, the iOS AppIcon and the Android adaptive icon —
 * so this cannot drift from them. See docs/design/logo.md.
 *
 * Variants exist because Penn red on Penn navy has no usable contrast: on a
 * dark ground the upper chevron lifts to a muted blue and the lower goes white,
 * rather than trying to keep the red.
 */
export type LogoVariant = 'color' | 'reversed' | 'mono';

export function LogoMark({
  size = 24,
  variant = 'color',
  className,
}: {
  size?: number;
  variant?: LogoVariant;
  className?: string;
}) {
  const mono = variant === 'mono';
  const upper = mono
    ? 'currentColor'
    : variant === 'reversed'
      ? BRAND_COLORS.ghost
      : BRAND_COLORS.red;
  const lower = mono ? 'currentColor' : variant === 'reversed' ? '#FFFFFF' : BRAND_COLORS.navy;

  return (
    <svg
      viewBox={BRAND_VIEW_BOX}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Shift@PennHousing"
      focusable="false"
    >
      <path fill={upper} d={mono ? BRAND_UPPER_PATH_MONO : BRAND_UPPER_PATH} />
      <path fill={lower} fillRule="evenodd" d={BRAND_LOWER_PATH} />
    </svg>
  );
}

/**
 * The name, set on one line. The `@` is the only red in the wordmark and sits
 * where the name pivots, which is the job the red chevron does in the mark.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      Shift<span className="brand-at">@</span>PennHousing
    </span>
  );
}

/** Mark plus wordmark, the horizontal lockup. */
export function Logo({
  size = 24,
  variant = 'color',
  className,
  markClassName,
  wordmarkClassName,
}: {
  size?: number;
  variant?: LogoVariant;
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={className}>
      <LogoMark size={size} variant={variant} className={markClassName} />
      <Wordmark className={wordmarkClassName} />
    </span>
  );
}
