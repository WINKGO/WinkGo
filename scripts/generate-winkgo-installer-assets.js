#!/usr/bin/env node

/**
 * Generate the two 24-bit BMP images consumed by the assisted NSIS installer.
 * Keeping this as source makes the installer branding reproducible instead of
 * relying on manually exported binary files.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const projectRoot = path.resolve(__dirname, '..');
const resourcesDir = path.join(projectRoot, 'resources');
const logoPath = path.join(resourcesDir, 'app.png');

function encodeBmp24(rgb, width, height) {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const buffer = Buffer.alloc(54 + pixelBytes);

  buffer.write('BM', 0, 2, 'ascii');
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelBytes, 34);
  buffer.writeInt32LE(2835, 38);
  buffer.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    const outputRow = 54 + y * rowStride;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (sourceY * width + x) * 3;
      const outputOffset = outputRow + x * 3;
      buffer[outputOffset] = rgb[sourceOffset + 2];
      buffer[outputOffset + 1] = rgb[sourceOffset + 1];
      buffer[outputOffset + 2] = rgb[sourceOffset];
    }
  }

  return buffer;
}

async function renderBmp({ backgroundSvg, composites, height, output, width }) {
  const { data, info } = await sharp(Buffer.from(backgroundSvg))
    .composite(composites)
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3 || info.width !== width || info.height !== height) {
    throw new Error(`Unexpected installer asset dimensions for ${output}`);
  }

  fs.writeFileSync(path.join(resourcesDir, output), encodeBmp24(data, width, height));
}

async function main() {
  const sidebarWidth = 164;
  const sidebarHeight = 314;
  const sidebarLogo = await sharp(logoPath).resize(118, 118, { fit: 'contain' }).png().toBuffer();

  await renderBmp({
    width: sidebarWidth,
    height: sidebarHeight,
    output: 'installerSidebar.bmp',
    backgroundSvg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="${sidebarWidth}" height="${sidebarHeight}">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ffffff"/>
            <stop offset="1" stop-color="#edf3ff"/>
          </linearGradient>
          <linearGradient id="wave" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#d5deed"/>
            <stop offset="1" stop-color="#f8faff"/>
          </linearGradient>
        </defs>
        <rect width="164" height="314" fill="url(#bg)"/>
        <circle cx="-28" cy="307" r="102" fill="url(#wave)"/>
        <circle cx="180" cy="316" r="80" fill="#f8fbff" stroke="#dde7f7" stroke-width="2"/>
        <text x="82" y="223" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif"
              font-size="11" font-weight="700" letter-spacing="2.2" fill="#101318">WINK GO</text>
        <text x="82" y="243" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif"
              font-size="7" letter-spacing="1.1" fill="#6d7786">AI DESKTOP WORKSPACE</text>
        <text x="82" y="285" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif"
              font-size="8" fill="#6d7786">winkgo.top</text>
      </svg>`,
    composites: [{ input: sidebarLogo, left: 23, top: 65 }],
  });

  const headerWidth = 150;
  const headerHeight = 57;
  const headerLogo = await sharp(logoPath).resize(48, 48, { fit: 'contain' }).png().toBuffer();

  await renderBmp({
    width: headerWidth,
    height: headerHeight,
    output: 'installerHeader.bmp',
    backgroundSvg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="${headerWidth}" height="${headerHeight}">
        <defs>
          <linearGradient id="headerBg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#ffffff"/>
            <stop offset="1" stop-color="#edf4ff"/>
          </linearGradient>
        </defs>
        <rect width="150" height="57" fill="url(#headerBg)"/>
        <path d="M112 0H150V57H91C111 42 120 22 112 0Z" fill="#dfeaff" opacity=".8"/>
        <text x="58" y="25" font-family="Segoe UI,Arial,sans-serif"
              font-size="14" font-weight="700" letter-spacing="1.8" fill="#101318">WINK GO</text>
        <text x="58" y="40" font-family="Segoe UI,Arial,sans-serif"
              font-size="7" letter-spacing=".7" fill="#6d7786">DESKTOP AI</text>
      </svg>`,
    composites: [{ input: headerLogo, left: 5, top: 4 }],
  });

  console.log('Generated resources/installerSidebar.bmp and resources/installerHeader.bmp');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
