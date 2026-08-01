#!/usr/bin/env node
// Generates every brand asset: the crest-based marks/icons from the raster crops in
// docs/design/brand-source/ (see the README there), and the mobile login-screen chevron
// mark from the vector geometry in scripts/brand/geometry.mjs.
//
//   node scripts/brand/build-icons.mjs
//
// Writes into apps/web, apps/mobile/androidApp and apps/mobile/iosApp. All
// outputs are committed — this script exists so each source has one home, not
// so assets are built on demand. Re-run it after editing geometry.mjs or the
// brand-source crops.
//
// sharp is resolved out of apps/web/node_modules (it is a web dependency, used
// there for KB PDF rendering); there is no separate install for this script.

import { createRequire } from 'node:module';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COLORS, PRIMARY,
  bounds, boundingRadius,
  redPath, navyPath,
} from './geometry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = join(ROOT, 'apps/web');
const ANDROID = join(ROOT, 'apps/mobile/androidApp/src/main/res');
const IOS = join(ROOT, 'apps/mobile/iosApp/iosApp');
const BRAND_SOURCE = join(ROOT, 'docs/design/brand-source');

const require = createRequire(join(WEB, 'package.json'));
const sharp = require('sharp');

const written = [];

async function put(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  written.push(path.slice(ROOT.length + 1));
}

// Composites a raster crest crop (from BRAND_SOURCE, see the README there for
// provenance) centered on a square canvas of `size`, occupying `widthFrac` of
// it. Used for every crest-based icon (web favicon/manifest/apple-touch, the
// Android adaptive icon, the iOS AppIcon) so there is exactly one place that
// does this compositing — none of those targets store a pre-baked canvas.
async function crestCanvas(source, size, widthFrac, { background = null } = {}) {
  const markWidth = Math.round(size * widthFrac);
  const mark = await sharp(join(BRAND_SOURCE, source))
    .resize({ width: markWidth })
    .png()
    .toBuffer();
  const markMeta = await sharp(mark).metadata();
  let canvas = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([
    { input: mark, left: Math.round((size - markMeta.width) / 2), top: Math.round((size - markMeta.height) / 2) },
  ]);
  if (background) canvas = canvas.flatten({ background });
  return canvas.png({ compressionLevel: 9 }).toBuffer();
}

// Recolors a crest crop's silhouette solid white, alpha preserved — for
// Android's themed (monochrome) icon.
async function whiteSilhouette(source, size, widthFrac) {
  const markWidth = Math.round(size * widthFrac);
  const mark = await sharp(join(BRAND_SOURCE, source))
    .resize({ width: markWidth })
    .png()
    .toBuffer();
  const markMeta = await sharp(mark).metadata();
  const white = await sharp({
    create: { width: markMeta.width, height: markMeta.height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: mark, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: white, left: Math.round((size - markMeta.width) / 2), top: Math.round((size - markMeta.height) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// Mobile splash lockup — the full "SHIFT AT PENN" wordmark on the OS splash screen and its
// in-app continuation (SplashOverlay.kt / SplashView.swift). Both platforms lay it out at a
// fixed SPLASH_HEIGHT_PT point size ("natural size", never resized in code), so sharpness on
// high-density screens comes only from generating one pixel slice per device density here —
// see the per-platform density loops in buildAndroid/buildIos below.
const SPLASH_HEIGHT_PT = 111;

async function splashLockup(source, scale) {
  const height = Math.round(SPLASH_HEIGHT_PT * scale);
  return sharp(join(BRAND_SOURCE, source)).resize({ height }).png({ compressionLevel: 9 }).toBuffer();
}

// In-app login-screen mark (iOS LoginView.swift / Android LoginScreen.kt): the same
// crest crop as the web login mark (Logo.tsx), not the geometry-derived chevron. This
// surface deliberately held onto the chevron during the 2026-07-25/29 crest rebrand
// (see brand-source/README.md); superseded 2026-07-29 at the product owner's request so
// the whole app agrees on one mark. Fixed-point-size layout, one slice per density/scale
// like splashLockup above.
const LOGIN_MARK_HEIGHT_PT = 72;

async function loginMark(source, scale) {
  const height = Math.round(LOGIN_MARK_HEIGHT_PT * scale);
  return sharp(join(BRAND_SOURCE, source)).resize({ height }).png({ compressionLevel: 9 }).toBuffer();
}

const GENERATED = 'Generated by scripts/brand/build-icons.mjs from scripts/brand/geometry.mjs. Do not edit by hand.';

/* ── web ──────────────────────────────────────────────────────────────── */

// Web favicon/manifest/apple-touch/OG icons all come from the Penn crest crop
// in BRAND_SOURCE (see docs/design/brand-source/README.md for provenance),
// not from geometry.mjs — the chevron mark is retired everywhere on web.
// crestCanvas/whiteSilhouette (above) do the compositing so nothing here is a
// pre-baked, hand-maintained canvas.
const WEB_ICON_SOURCE = 'shield-light-2048.png';

async function buildWeb() {
  // Header/login mark (apps/web/components/ui/Logo.tsx): the crest crop
  // exactly as supplied, no compositing — the component sizes it itself.
  await sharp(join(BRAND_SOURCE, 'shield-light.png')).png({ compressionLevel: 9 })
    .toFile(join(WEB, 'public/brand/crest.png'));
  await sharp(join(BRAND_SOURCE, 'shield-dark.png')).png({ compressionLevel: 9 })
    .toFile(join(WEB, 'public/brand/crest-reversed.png'));

  await put(join(WEB, 'app/icon.png'), await crestCanvas(WEB_ICON_SOURCE, 256, 0.82, { background: COLORS.ground }));
  await put(join(WEB, 'app/apple-icon.png'), await crestCanvas(WEB_ICON_SOURCE, 180, 0.82, { background: COLORS.ground }));
  await put(join(WEB, 'public/brand/icon-192.png'), await crestCanvas(WEB_ICON_SOURCE, 192, 0.82, { background: COLORS.ground }));
  await put(join(WEB, 'public/brand/icon-512.png'), await crestCanvas(WEB_ICON_SOURCE, 512, 0.82, { background: COLORS.ground }));
  // Maskable: the OS crops to a circle inside the safe zone, so the mark is
  // pulled in and the background must be opaque (no transparency to reveal).
  await put(join(WEB, 'public/brand/icon-maskable-512.png'), await crestCanvas(WEB_ICON_SOURCE, 512, 0.6, { background: COLORS.ground }));
  await put(join(WEB, 'public/brand/og.png'), await crestCanvas(WEB_ICON_SOURCE, 512, 0.82, { background: COLORS.ground }));

  // Stale generated files from the retired chevron mark / stock scaffolding.
  for (const stale of [
    'app/icon.svg', 'app/favicon.ico', 'lib/brandPaths.ts',
    'public/brand/logo.svg', 'public/brand/logo-mono.svg', 'public/brand/logo-reversed.svg', 'public/brand/icon.svg',
    'public/file.svg', 'public/globe.svg', 'public/next.svg', 'public/vercel.svg', 'public/window.svg',
  ]) {
    await rm(join(WEB, stale), { force: true });
  }
}

/* ── android ──────────────────────────────────────────────────────────── */

// Adaptive icons are drawn on a 108dp canvas; only the central 72dp is safe and
// circular launcher masks show a 66dp circle. Scale so the mark's bounding
// radius (43.08 artboard units) lands inside that circle with margin.
const ADAPTIVE_SCALE = Number((33 / boundingRadius(PRIMARY) * 0.965).toFixed(4));

function vectorDrawable(inner, { viewport = 100, size = 108 } = {}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${GENERATED} -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${size}dp"
    android:height="${size}dp"
    android:viewportWidth="${viewport}"
    android:viewportHeight="${viewport}">
${inner}
</vector>
`;
}

function adaptiveGroup(cut, { upper, lower }) {
  const b = bounds(cut);
  const s = ADAPTIVE_SCALE;
  const tx = (54 - b.cx * s).toFixed(4);
  const ty = (54 - b.cy * s).toFixed(4);
  return `    <group
        android:scaleX="${s}"
        android:scaleY="${s}"
        android:translateX="${tx}"
        android:translateY="${ty}">
        <path android:fillColor="${upper}" android:pathData="${redPath(cut)}"/>
        <path android:fillColor="${lower}" android:fillType="evenOdd" android:pathData="${navyPath(cut)}"/>
    </group>`;
}

// The launcher icon (app icon) is the real Penn shield crest — a raster scan, not
// vector geometry, so it does not derive from geometry.mjs like the rest of this
// file. Source of truth is the crop in docs/design/brand-source/ (see the README
// there for provenance/decisions); crestCanvas/whiteSilhouette composite it onto
// the launcher canvas on every run so re-running this script cannot silently
// reintroduce the retired chevron icon or drift from a hand-baked PNG.
//
// The in-app login-screen mark (ui/LoginScreen.kt) is a separate surface from the
// launcher icon / splash screen — see the ic_login_mark generation below.
// Matches the app's light theme background, ui/theme/Color.kt L.bg.
const ICON_BACKGROUND = '#F6F7F9';
// Adaptive icons are drawn on a 1024px canvas; only the central ~2/3 is the safe
// zone before circular/squircle launcher masks start clipping.
const ANDROID_ICON_SOURCE = 'shield-light-2048.png';
const ANDROID_ICON_WIDTH_FRAC = 0.58;

async function buildAndroid() {
  await put(join(ANDROID, 'drawable/ic_launcher_background.xml'), vectorDrawable(
    `    <path android:fillColor="${ICON_BACKGROUND}" android:pathData="M0,0h108v108h-108z"/>`,
    { viewport: 108 }));

  await put(join(ANDROID, 'drawable/ic_launcher_foreground.png'),
    await crestCanvas(ANDROID_ICON_SOURCE, 1024, ANDROID_ICON_WIDTH_FRAC));
  await put(join(ANDROID, 'drawable/ic_launcher_monochrome.png'),
    await whiteSilhouette(ANDROID_ICON_SOURCE, 1024, ANDROID_ICON_WIDTH_FRAC));

  const adaptive = (round) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/brand/build-icons.mjs. Do not edit by hand. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`;
  await put(join(ANDROID, 'mipmap-anydpi-v26/ic_launcher.xml'), adaptive(false));
  await put(join(ANDROID, 'mipmap-anydpi-v26/ic_launcher_round.xml'), adaptive(true));

  // minSdk is 24, so API 24-25 still need raster mipmaps with the background baked in
  // (no <adaptive-icon> layering pre-26). Composite the crest over the same background
  // color used above, letter-boxed inside the safe zone. The round variant reuses the
  // identical square composite: most OEM launchers on API 24-25 apply their own
  // circular mask over whatever bitmap is supplied regardless.
  for (const [bucket, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
    const buf = await crestCanvas(ANDROID_ICON_SOURCE, size, ANDROID_ICON_WIDTH_FRAC, { background: ICON_BACKGROUND });
    await put(join(ANDROID, `mipmap-${bucket}/ic_launcher.webp`), await sharp(buf).webp({ quality: 95 }).toBuffer());
    await put(join(ANDROID, `mipmap-${bucket}/ic_launcher_round.webp`), await sharp(buf).webp({ quality: 95 }).toBuffer());
  }

  // The widget picker previews @mipmap/ic_launcher, which is now the crest.

  // Splash lockup: one slice per Android density bucket, both themes (splashLockup above).
  // An earlier pass shipped a single unqualified drawable/splash_lockup.png — Android treats
  // that as a low-priority fallback, not a guaranteed 1x baseline, so real devices rendered
  // it soft. Explicit density buckets are the correct fix; the unqualified files are retired
  // below so there is exactly one splash_lockup per density, not an ambiguous extra copy.
  const ANDROID_DENSITY_SCALE = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [bucket, scale] of Object.entries(ANDROID_DENSITY_SCALE)) {
    await put(join(ANDROID, `drawable-${bucket}/splash_lockup.png`), await splashLockup('lockup-horizontal-light.png', scale));
    await put(join(ANDROID, `drawable-night-${bucket}/splash_lockup.png`), await splashLockup('lockup-horizontal-dark.png', scale));
  }
  for (const stale of ['drawable/splash_lockup.png', 'drawable-night/splash_lockup.png']) {
    await rm(join(ANDROID, stale), { force: true });
  }

  // Login-screen mark (ui/LoginScreen.kt): same crest crop, same density-bucket
  // treatment as the splash lockup above (loginMark helper).
  for (const [bucket, scale] of Object.entries(ANDROID_DENSITY_SCALE)) {
    await put(join(ANDROID, `drawable-${bucket}/ic_login_mark.png`), await loginMark('shield-light.png', scale));
    await put(join(ANDROID, `drawable-night-${bucket}/ic_login_mark.png`), await loginMark('shield-dark.png', scale));
  }
  await rm(join(ANDROID, 'drawable/ic_brand_mark.xml'), { force: true });
}

/* ── ios ──────────────────────────────────────────────────────────────── */

async function buildIos() {
  const cat = join(IOS, 'Assets.xcassets');
  const info = { info: { author: 'xcode', version: 1 } };

  await put(join(cat, 'Contents.json'), JSON.stringify(info, null, 2) + '\n');

  await put(join(cat, 'AppIcon.appiconset/Contents.json'), JSON.stringify({
    images: [{ filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
    ...info,
  }, null, 2) + '\n');
  // App Store Connect rejects transparency, so the crest is composited onto an
  // opaque white canvas (App Icons can't have their own background otherwise).
  await put(join(cat, 'AppIcon.appiconset/AppIcon-1024.png'),
    await crestCanvas('shield-light-2048.png', 1024, 0.72, { background: '#FFFFFF' }));

  // Splash lockup (LaunchLogo): one @1x/@2x/@3x slice per theme (splashLockup above). An
  // earlier pass shipped only a single "1x"-scale entry per theme, so SwiftUI's non-resizable
  // Image rendered it at the full pixel size on every device — correct footprint on a 1x
  // simulator, soft on a real Retina device. Proper scale slices fix that without changing
  // the natural-size 111pt layout SplashView.swift relies on.
  const launchLogo = join(cat, 'LaunchLogo.imageset');
  const iosImages = [];
  for (const scale of [1, 2, 3]) {
    const lightName = scale === 1 ? 'lockup-horizontal-light.png' : `lockup-horizontal-light@${scale}x.png`;
    await put(join(launchLogo, lightName), await splashLockup('lockup-horizontal-light.png', scale));
    iosImages.push({ filename: lightName, idiom: 'universal', scale: `${scale}x` });

    const darkName = scale === 1 ? 'lockup-horizontal-dark.png' : `lockup-horizontal-dark@${scale}x.png`;
    await put(join(launchLogo, darkName), await splashLockup('lockup-horizontal-dark.png', scale));
    iosImages.push({
      appearances: [{ appearance: 'luminosity', value: 'dark' }],
      filename: darkName, idiom: 'universal', scale: `${scale}x`,
    });
  }
  await put(join(launchLogo, 'Contents.json'), JSON.stringify({ images: iosImages, ...info }, null, 2) + '\n');

  // Accent stays Shift Blue — the mark's palette is deliberately not the UI accent.
  await put(join(cat, 'AccentColor.colorset/Contents.json'), JSON.stringify({
    colors: [{
      color: {
        'color-space': 'srgb',
        components: { alpha: '1.000', blue: '0xFC', green: '0x61', red: '0x00' },
      },
      idiom: 'universal',
    }],
    ...info,
  }, null, 2) + '\n');

  // Login-screen mark (LoginView.swift): same crest crop, same appearance-switched
  // imageset pattern as LaunchLogo above (loginMark helper).
  const loginMarkSet = join(cat, 'LoginMark.imageset');
  const loginMarkImages = [];
  for (const scale of [1, 2, 3]) {
    const lightName = scale === 1 ? 'login-mark-light.png' : `login-mark-light@${scale}x.png`;
    await put(join(loginMarkSet, lightName), await loginMark('shield-light.png', scale));
    loginMarkImages.push({ filename: lightName, idiom: 'universal', scale: `${scale}x` });

    const darkName = scale === 1 ? 'login-mark-dark.png' : `login-mark-dark@${scale}x.png`;
    await put(join(loginMarkSet, darkName), await loginMark('shield-dark.png', scale));
    loginMarkImages.push({
      appearances: [{ appearance: 'luminosity', value: 'dark' }],
      filename: darkName, idiom: 'universal', scale: `${scale}x`,
    });
  }
  await put(join(loginMarkSet, 'Contents.json'), JSON.stringify({ images: loginMarkImages, ...info }, null, 2) + '\n');

  await rm(join(IOS, 'BrandMarkGeometry.swift'), { force: true });
}

/* ── run ──────────────────────────────────────────────────────────────── */

await buildWeb();
await buildAndroid();
await buildIos();

console.log(`adaptive icon scale ${ADAPTIVE_SCALE} (bounding radius ${boundingRadius(PRIMARY).toFixed(2)} -> ${(boundingRadius(PRIMARY) * ADAPTIVE_SCALE).toFixed(2)} of the 33dp safe circle)`);
console.log(`${written.length} files written:`);
for (const f of written) console.log('  ' + f);
