import Image from 'next/image';

/**
 * The Penn shield crest, cropped from source PNGs supplied by the product
 * owner (no vector source exists yet). See docs/design/brand-source/README.md
 * for provenance and the crest's use everywhere else (mobile splash, app
 * icons). The crest is used exactly as supplied, unmodified, on every
 * background including the dark header chrome, per the locked-in decision
 * recorded there.
 */
export type LogoVariant = 'color' | 'reversed' | 'mono';

export function LogoMark({
  size = 24,
  variant, // eslint-disable-line @typescript-eslint/no-unused-vars -- kept for call-site compatibility; the crest itself is variant-agnostic (see docs/design/brand-source/README.md)
  className,
}: {
  size?: number;
  variant?: LogoVariant;
  className?: string;
}) {
  return (
    <Image
      src="/brand/crest.png"
      alt="Shift"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
      priority
    />
  );
}

/** The wordmark, set in Roboto Slab bold per the locked-in brand decision. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={`brand-wordmark ${className ?? ''}`.trim()}>SHIFT</span>;
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
