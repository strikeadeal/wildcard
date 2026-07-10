import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

// One source of truth for the mark: a fanned deck with the WILDCARD brass "W"
// monogram, centred in a 512 canvas. Drawn as vector paths so rasterisation
// never depends on a system font being installed.
const ART = `
  <g transform="translate(256 262)">
    <g transform="rotate(-15)">
      <rect x="-156" y="-120" width="150" height="214" rx="20" fill="#d23b31" stroke="#f7f2e6" stroke-width="11"/>
    </g>
    <g transform="rotate(15)">
      <rect x="6" y="-120" width="150" height="214" rx="20" fill="#356fd0" stroke="#f7f2e6" stroke-width="11"/>
    </g>
    <g transform="rotate(-2)">
      <rect x="-86" y="-132" width="172" height="244" rx="24" fill="#f7f2e6"/>
      <ellipse cx="0" cy="-10" rx="62" ry="96" fill="#163a2c" transform="rotate(-16 0 -10)"/>
      <path d="M -46 -58 L -26 46 L 0 -14 L 26 46 L 46 -58"
            fill="none" stroke="#e6b84b" stroke-width="22"
            stroke-linejoin="round" stroke-linecap="round"/>
    </g>
  </g>`;

const FELT = `
  <defs>
    <radialGradient id="felt" cx="50%" cy="34%" r="75%">
      <stop offset="0%" stop-color="#1f5540"/>
      <stop offset="60%" stop-color="#163a2c"/>
      <stop offset="100%" stop-color="#0c2019"/>
    </radialGradient>
  </defs>`;

// Regular icon + favicon: art on a rounded felt tile, transparent corners.
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${FELT}
  <rect width="512" height="512" rx="104" fill="url(#felt)"/>
  ${ART}
</svg>`;

// Maskable / apple-touch: edge-to-edge, fully opaque, NO baked-in rounding —
// the OS applies its own mask. Art shrunk into the safe zone so the mask
// can't clip it.
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${FELT}
  <rect width="512" height="512" fill="url(#felt)"/>
  <g transform="translate(256 256) scale(0.82) translate(-256 -256)">${ART}</g>
</svg>`;

await writeFile('public/icon.svg', rounded.trim() + '\n');

const raster = (svg, size, name, flatten = false) => {
  let p = sharp(Buffer.from(svg), { density: 300 }).resize(size, size);
  if (flatten) p = p.flatten({ background: '#163a2c' });
  return p.png().toFile('public/' + name);
};

// iOS launch splash: opaque felt background, art centred and sized to ~40%
// of the shorter dimension so it reads at a glance while the app boots.
const splash = (w, h) => {
  const artSize = Math.round(Math.min(w, h) * 0.4);
  const scale = artSize / 512;
  const cx = w / 2;
  const cy = h / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  ${FELT}
  <rect width="${w}" height="${h}" fill="url(#felt)"/>
  <g transform="translate(${cx} ${cy}) scale(${scale}) translate(-256 -256)">${ART}</g>
</svg>`;
  return sharp(Buffer.from(svg), { density: 300 })
    .resize(w, h)
    .flatten({ background: '#163a2c' })
    .png()
    .toFile(`public/splash-${w}x${h}.png`);
};

const SPLASH_SIZES = [
  [750, 1334],
  [828, 1792],
  [1170, 2532],
  [1179, 2556],
  [1284, 2778],
  [1290, 2796]
];

await Promise.all([
  raster(rounded, 192, 'icon-192.png'),
  raster(rounded, 512, 'icon-512.png'),
  // Distinct full-bleed opaque variants (not a reused PNG):
  raster(fullBleed, 512, 'icon-maskable-512.png', true),
  raster(fullBleed, 180, 'apple-touch-icon.png', true),
  ...SPLASH_SIZES.map(([w, h]) => splash(w, h))
]);
console.log('icons written (rounded + full-bleed maskable/apple-touch + 6 splash sizes)');
