#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'out');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const version = String(packageJson.version || '').trim();
const edition =
  String(process.env.WINKGO_EDITION || 'free')
    .trim()
    .toLowerCase() === 'pro'
    ? 'pro'
    : 'free';
const expectedPrefix = edition === 'pro' ? `WINK-GO-Pro-Setup-${version}-` : `WINK-GO-Free-Setup-${version}-`;

const installerNames = fs
  .readdirSync(outDir)
  .filter((name) => name.startsWith(expectedPrefix) && name.toLowerCase().endsWith('.exe'))
  .sort((left, right) => {
    const leftX64 = left.toLowerCase().includes('x64') ? 1 : 0;
    const rightX64 = right.toLowerCase().includes('x64') ? 1 : 0;
    return rightX64 - leftX64 || left.localeCompare(right);
  });

if (!installerNames.length) {
  throw new Error(`No Windows installer matching ${expectedPrefix}*.exe was found in ${outDir}`);
}

const installerName = installerNames[0];
const installerPath = path.join(outDir, installerName);
const installer = fs.readFileSync(installerPath);
const sha256 = crypto.createHash('sha256').update(installer).digest('hex').toUpperCase();
const sizeBytes = installer.byteLength;
const generatedAt = new Date().toISOString();
const officialSite = 'https://winkgo.top/';
const domesticDownloadUrl = `https://winkgo.top/releases/free/${version}/${installerName}`;
const githubDownloadUrl = `https://github.com/WINKGO/WinkGo/releases/download/v${version}/${installerName}`;
const downloadUrl = String(
  process.env.WINKGO_DOWNLOAD_URL ||
    (edition === 'free' ? domesticDownloadUrl : 'https://github.com/WINKGO/wink-go/releases')
).trim();
const officialDownloadUrl = String(
  process.env.WINKGO_OFFICIAL_DOWNLOAD_URL || (edition === 'free' ? githubDownloadUrl : '')
).trim();
const notes =
  String(process.env.WINKGO_RELEASE_NOTES || '').trim() ||
  'WINK GO 桌面版能力与体验更新，具体内容请查看 GitHub Release 页面。';

const manifest = {
  schemaVersion: 1,
  version,
  productName: edition === 'pro' ? 'WINK GO Pro' : 'WINK GO',
  edition,
  releaseProfile: edition === 'pro' ? 'pro' : 'free',
  fileName: installerName,
  downloadUrl,
  ...(officialDownloadUrl ? { officialDownloadUrl } : {}),
  sha256,
  sizeBytes,
  generatedAt,
  officialSite,
  notes,
  windows: {
    version,
    downloadUrl,
    ...(officialDownloadUrl ? { officialDownloadUrl } : {}),
    fileName: installerName,
    sha256,
    sizeBytes,
    notes,
  },
};

const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const manifestPath = path.join(outDir, `winkgo-${edition}-update.json`);
const checksumPath = path.join(outDir, `${installerName}.sha256.txt`);

fs.writeFileSync(manifestPath, manifestText, 'utf8');
fs.writeFileSync(checksumPath, `${sha256}  ${installerName}\n`, 'utf8');

console.log(`[winkgo-release] Manifest: ${manifestPath}`);
console.log(`[winkgo-release] Installer: ${installerPath}`);
console.log(`[winkgo-release] SHA256: ${sha256}`);
console.log(`[winkgo-release] Bytes: ${sizeBytes}`);
