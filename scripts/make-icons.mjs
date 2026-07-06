import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile('public/icon.svg');
const out = (size, name) =>
  sharp(svg, { density: 300 }).resize(size, size).png().toFile('public/' + name);

await Promise.all([
  out(192, 'icon-192.png'),
  out(512, 'icon-512.png'),
  out(512, 'icon-maskable-512.png'), // same art; rx of the source keeps it safe-zone friendly
  out(180, 'apple-touch-icon.png')
]);
console.log('icons written');
