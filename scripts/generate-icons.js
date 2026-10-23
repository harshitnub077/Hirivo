// scripts/generate-icons.js
// Pure Node.js script using built-in zlib to output valid PNG files at exact pixel dimensions.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createCRC32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
}

const crcTable = createCRC32Table();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(4 + 4 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const checkBuf = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = crc32(checkBuf);
  buf.writeUInt32BE(c, 8 + len);
  return buf;
}

function generateIcon(size) {
  const width = size;
  const height = size;

  // Raw RGBA pixel buffer: each scanline starts with filter byte 0
  const rawBytesPerLine = 1 + width * 4;
  const rawData = Buffer.alloc(rawBytesPerLine * height);

  for (let y = 0; y < height; y++) {
    const lineOffset = y * rawBytesPerLine;
    rawData[lineOffset] = 0; // Filter: None

    for (let x = 0; x < width; x++) {
      const pxOffset = lineOffset + 1 + x * 4;

      // Normalized coordinates [0, 1]
      const nx = x / (width - 1 || 1);
      const ny = y / (height - 1 || 1);

      // Rounded rectangle mask
      const radius = size * 0.22;
      const dx = Math.max(0, Math.abs(x - width / 2) - (width / 2 - radius));
      const dy = Math.max(0, Math.abs(y - height / 2) - (height / 2 - radius));
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > radius) {
        // Transparent outside rounded corners
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
        continue;
      }

      // Elegant deep indigo-to-violet gradient with cyan glow
      // Top-left to bottom-right
      const t = (nx + ny) * 0.5;
      let r = Math.round(15 + t * 40);    // 15 -> 55
      let g = Math.round(23 + t * 50);    // 23 -> 73
      let b = Math.round(42 + t * 160);   // 42 -> 202

      // Draw stylized "H" glyph in bright cyan/white
      const hPadding = size * 0.28;
      const barWidth = Math.max(1, Math.round(size * 0.14));
      const isLeftBar = x >= hPadding && x < hPadding + barWidth && y >= hPadding && y < height - hPadding;
      const isRightBar = x >= width - hPadding - barWidth && x < width - hPadding && y >= hPadding && y < height - hPadding;
      const midY = height / 2;
      const isCrossBar = y >= midY - barWidth / 2 && y <= midY + barWidth / 2 && x >= hPadding && x < width - hPadding;

      if (isLeftBar || isRightBar || isCrossBar) {
        // Bright cyan/emerald accent
        r = 56;
        g = 189;
        b = 248; // #38bdf8 cyan
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = 255;
    }
  }

  // PNG Header
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR Chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace (none)
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // IDAT Chunk
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND Chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const outDir = path.resolve('public/icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const png = generateIcon(size);
  const filePath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${filePath} (${size}x${size}, ${png.length} bytes)`);
}
