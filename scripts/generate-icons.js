// scripts/generate-icons.js
// Renders the brand SVGs in public/brand into the PNG sizes Chrome and the Web Store need.
// Small sizes use the heavier-stroke icon so the mark survives at 16px.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brand = (name) => fs.readFileSync(path.join(root, 'public/brand', name), 'utf8');

function renderPng(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

const icons = [
  { size: 16, source: 'hirivo-icon-small.svg' },
  { size: 32, source: 'hirivo-icon-small.svg' },
  { size: 48, source: 'hirivo-icon.svg' },
  { size: 128, source: 'hirivo-icon.svg' },
];

fs.mkdirSync(path.join(root, 'public/icons'), { recursive: true });
for (const { size, source } of icons) {
  fs.writeFileSync(path.join(root, `public/icons/icon${size}.png`), renderPng(brand(source), size));
  console.log(`icons/icon${size}.png`);
}

// Chrome Web Store small promo tile (440x280): wordmark centred on paper.
const wordmark = brand('hirivo-wordmark.svg');
const [, wmW, wmH] = wordmark.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
const scale = 260 / wmW;
const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
  <rect width="440" height="280" fill="#FAFAF7"/>
  <image x="${(440 - wmW * scale) / 2}" y="${(280 - wmH * scale) / 2}" width="${wmW * scale}" height="${wmH * scale}"
    href="data:image/svg+xml;base64,${Buffer.from(wordmark).toString('base64')}"/>
</svg>`;
fs.mkdirSync(path.join(root, 'store'), { recursive: true });
fs.writeFileSync(path.join(root, 'store/promo-small-440x280.png'), renderPng(tile, 440));
console.log('store/promo-small-440x280.png');
