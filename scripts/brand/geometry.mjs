// The Shift@PennHousing chevronel — single geometric source of truth.
//
// Every brand asset on every platform (web SVG, Next favicon, Android vector
// drawable + mipmaps, iOS AppIcon, the SwiftUI/Compose in-app marks) derives
// from the numbers in this file. See docs/design/logo.md for the rationale.
//
// Both chevrons share one arm vector (30 across, 32 down), which is what keeps
// the gap between them constant from the apex to the arm ends. The three plates
// are positioned by arc length along the navy centreline — one at the vertex,
// one at PLATE_SPACING down each arm — never by eye.
//
// Strokes are resolved to explicit outline polygons here rather than emitted as
// stroked paths, because Android VectorDrawable has no mask support and stroke
// rasterisation differs subtly between renderers. The plates become evenOdd
// counter-subpaths, so they are true holes on every platform.

export const COLORS = {
  navy: '#011F5B', // Penn Blue
  red: '#990000', // Penn Red
  ground: '#F4F3F0', // paper ground the mark is drawn on
  ghost: '#5B72A8', // upper chevron when reversed out of navy
  white: '#FFFFFF',
};

export const ARTBOARD = 100;

/** Primary cut. Used at 24px and above. */
export const PRIMARY = {
  red: { apex: [50, 23], ends: [[20, 55], [80, 55]], width: 10 },
  navy: { apex: [50, 48], ends: [[20, 80], [80, 80]], width: 14 },
  plateRadius: 5.2,
  plateSpacing: 20,
};

/** Monochrome cut. Upper band thins to 7 so weight alone separates the two. */
export const MONO = {
  ...PRIMARY,
  red: { ...PRIMARY.red, width: 7 },
};

/**
 * 16px cut. Plates fall under a pixel below ~20px and the gap starts to close,
 * so the plates are dropped and both bands thicken. Gap opens 5.10 -> 7.02.
 */
export const FAVICON = {
  red: { apex: [50, 21], ends: [[20, 53], [80, 53]], width: 12 },
  navy: { apex: [50, 51], ends: [[20, 83], [80, 83]], width: 15 },
  plateRadius: 0,
  plateSpacing: 20,
};

const n = (v) => Number(v.toFixed(4));

function unit(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return [dx / len, dy / len];
}

function add(p, d, k) {
  return [p[0] + d[0] * k, p[1] + d[1] * k];
}

/** Resolve a stroked chevron into its closed outline polygon (miter joins, butt caps). */
export function chevronOutline({ apex, ends, width }) {
  const [L, R] = ends;
  const h = width / 2;
  const u = unit(apex, L);
  const v = unit(apex, R);

  // "Up" is the outward bisector: away from the opening of the V.
  const bx = u[0] + v[0];
  const by = u[1] + v[1];
  const bl = Math.hypot(bx, by);
  const up = [-bx / bl, -by / bl];

  // Of each arm's two normals, take the one pointing to the up side.
  const pick = (d) => {
    const p = [-d[1], d[0]];
    return p[0] * up[0] + p[1] * up[1] > 0 ? p : [d[1], -d[0]];
  };
  const nL = pick(u);
  const nR = pick(v);

  const halfAngle = Math.acos(Math.min(1, Math.max(-1, u[0] * v[0] + u[1] * v[1]))) / 2;
  const miter = h / Math.sin(halfAngle);

  return [
    add(L, nL, h),
    add(apex, up, miter),
    add(R, nR, h),
    add(R, nR, -h),
    add(apex, up, -miter),
    add(L, nL, -h),
  ];
}

/** Plate centres: the chevron vertex, then `spacing` along each arm. */
export function platePositions({ apex, ends }, spacing) {
  const [L, R] = ends;
  return [apex, add(apex, unit(apex, L), spacing), add(apex, unit(apex, R), spacing)];
}

const polygonPath = (pts) =>
  `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`;

const circlePath = ([cx, cy], r) =>
  `M${n(cx - r)} ${n(cy)}a${r} ${r} 0 1 0 ${n(r * 2)} 0a${r} ${r} 0 1 0 ${n(-r * 2)} 0Z`;

/** The navy chevron with its plates cut out, as one evenOdd path. */
export function navyPath(cut) {
  const outline = polygonPath(chevronOutline(cut.navy));
  if (cut.plateRadius <= 0) return outline;
  const holes = platePositions(cut.navy, cut.plateSpacing)
    .map((p) => circlePath(p, cut.plateRadius))
    .join('');
  return outline + holes;
}

export function redPath(cut) {
  return polygonPath(chevronOutline(cut.red));
}

/** Tight bounding box of the whole mark, in artboard units. */
export function bounds(cut) {
  const pts = [...chevronOutline(cut.red), ...chevronOutline(cut.navy)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX, maxX, minY, maxY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/** Distance from the mark's centre to its furthest point — sizing for circular masks. */
export function boundingRadius(cut) {
  const b = bounds(cut);
  const pts = [...chevronOutline(cut.red), ...chevronOutline(cut.navy)];
  return Math.max(...pts.map(([x, y]) => Math.hypot(x - b.cx, y - b.cy)));
}

/**
 * The mark as two <path> elements. `fill` overrides both colours (monochrome);
 * `upper` / `lower` override one chevron each (reversed).
 */
export function markPaths(cut, { fill, upper: upperOverride, lower: lowerOverride } = {}) {
  const upper = fill ?? upperOverride ?? COLORS.red;
  const lower = fill ?? lowerOverride ?? COLORS.navy;
  return (
    `<path fill="${upper}" d="${redPath(cut)}"/>` +
    `<path fill="${lower}" fill-rule="evenodd" d="${navyPath(cut)}"/>`
  );
}

const HEAD = '<svg xmlns="http://www.w3.org/2000/svg"';

/** Standalone mark on a transparent ground, cropped tight with a little air. */
export function markSvg(cut = PRIMARY, opts = {}) {
  const b = bounds(cut);
  const pad = 2;
  const x = n(b.minX - pad);
  const y = n(b.minY - pad);
  const w = n(b.width + pad * 2);
  const h = n(b.height + pad * 2);
  return (
    `${HEAD} viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Shift@PennHousing">` +
    markPaths(cut, opts) +
    '</svg>\n'
  );
}

/**
 * A square icon: full-bleed ground plus the mark centred on the artboard.
 * `shape` is 'square' | 'rounded' | 'circle'; `inset` shrinks the mark for
 * maskable icons that must survive an aggressive safe-zone crop.
 */
export function tileSvg(cut = PRIMARY, { ground = COLORS.ground, shape = 'square', inset = 1, size = ARTBOARD, ...opts } = {}) {
  const b = bounds(cut);
  const scale = inset;
  const tx = n(ARTBOARD / 2 - b.cx * scale);
  const ty = n(ARTBOARD / 2 - b.cy * scale);

  let bg;
  if (shape === 'circle') bg = `<circle cx="50" cy="50" r="50" fill="${ground}"/>`;
  else if (shape === 'rounded') bg = `<rect width="100" height="100" rx="22.37" fill="${ground}"/>`;
  else bg = `<rect width="100" height="100" fill="${ground}"/>`;

  return (
    `${HEAD} width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="Shift@PennHousing">` +
    bg +
    `<g transform="translate(${tx} ${ty}) scale(${n(scale)})">${markPaths(cut, opts)}</g>` +
    '</svg>\n'
  );
}
