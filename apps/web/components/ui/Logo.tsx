import Image from 'next/image';

/**
 * The Penn shield crest, cropped from source PNGs supplied by the product
 * owner (no vector source exists yet). See docs/design/brand-source/README.md
 * for provenance and the crest's use everywhere else (mobile splash, app
 * icons). `color` is the crest exactly as supplied, for light backgrounds;
 * `reversed` is the white-outline cut for dark backgrounds (the header chrome,
 * the login page's dark brand panel) where the default's thin dark outline
 * reads poorly.
 */
export type LogoVariant = 'color' | 'reversed';

const CREST_SRC: Record<LogoVariant, string> = {
  color: '/brand/crest.png',
  reversed: '/brand/crest-reversed.png',
};

export function LogoMark({
  size = 24,
  variant = 'color',
  className,
}: {
  size?: number;
  variant?: LogoVariant;
  className?: string;
}) {
  return (
    <Image
      src={CREST_SRC[variant]}
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
