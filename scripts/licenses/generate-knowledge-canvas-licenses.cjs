#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'public', 'knowledge-canvas');
const DIRECT_RUNTIME_DEPENDENCIES = ['@xyflow/react', 'lucide-react', 'qrcode', 'react', 'react-dom', 'zustand'];
const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;

function fail(message) {
  console.error(`Knowledge Canvas license generation failed: ${message}`);
  process.exit(1);
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function normalizeText(content) {
  return (
    content
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .trim() + '\n'
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findLicenseFiles(packageDirectory) {
  return fs
    .readdirSync(packageDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
    .map((entry) => path.join(packageDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

const sourceRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!sourceRoot) fail('pass the WINK-GO-Canvans source directory as the first argument');

const packagePath = path.join(sourceRoot, 'package.json');
const lockPath = path.join(sourceRoot, 'pnpm-lock.yaml');
const packageMapPath = path.join(sourceRoot, 'node_modules', '.package-map.json');
const sourceDistPath = path.join(sourceRoot, 'dist', 'index.html');
const bundledCanvasPath = path.join(OUTPUT_ROOT, 'index.html');
for (const requiredPath of [packagePath, lockPath, packageMapPath, sourceDistPath, bundledCanvasPath]) {
  if (!fs.existsSync(requiredPath)) fail(`required file is missing: ${requiredPath}`);
}

const packageManifest = readJson(packagePath);
const packageMap = readJson(packageMapPath).packages;
const rootDependencies = packageMap['.']?.dependencies || {};
const queue = DIRECT_RUNTIME_DEPENDENCIES.map((name) => rootDependencies[name]);
if (queue.some((entry) => !entry)) fail('one or more direct runtime dependencies are absent');

const visited = new Set();
while (queue.length > 0) {
  const packageId = queue.shift();
  if (!packageId || visited.has(packageId)) continue;
  visited.add(packageId);
  const record = packageMap[packageId];
  if (!record) fail(`package map entry is missing: ${packageId}`);
  for (const dependencyId of Object.values(record.dependencies || {})) queue.push(dependencyId);
}

const licenseTexts = new Map();
const inventory = [];
for (const packageId of [...visited].sort()) {
  const record = packageMap[packageId];
  const packageDirectory = path.resolve(sourceRoot, 'node_modules', record.url);
  const manifest = readJson(path.join(packageDirectory, 'package.json'));
  const licenseFiles = findLicenseFiles(packageDirectory);
  if (licenseFiles.length === 0) fail(`no license file found for ${manifest.name}@${manifest.version}`);

  const hashes = [];
  for (const licensePath of licenseFiles) {
    const text = normalizeText(fs.readFileSync(licensePath, 'utf8'));
    const hash = sha256(text);
    if (!licenseTexts.has(hash)) {
      licenseTexts.set(hash, { hash, text, fileNames: new Set(), packages: new Set() });
    }
    const license = licenseTexts.get(hash);
    license.fileNames.add(path.basename(licensePath));
    license.packages.add(`${manifest.name}@${manifest.version}`);
    hashes.push(hash);
  }

  inventory.push({
    name: manifest.name,
    version: manifest.version,
    license: manifest.license || null,
    repository: typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url || null,
    licenseTextHashes: [...new Set(hashes)].sort(),
  });
}

inventory.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
const archive = [
  'WINK GO KNOWLEDGE CANVAS THIRD-PARTY LICENSE ARCHIVE',
  '',
  'This archive covers the runtime dependency closure embedded in the restored',
  'single-file Knowledge Canvas. Exact package versions are recorded in',
  'THIRD_PARTY_DEPENDENCIES.json.',
  '',
];
for (const license of [...licenseTexts.values()].sort((left, right) => left.hash.localeCompare(right.hash))) {
  archive.push('='.repeat(80));
  archive.push(`SHA-256: ${license.hash}`);
  archive.push(`Files: ${[...license.fileNames].sort().join(', ')}`);
  archive.push('Packages:');
  for (const packageName of [...license.packages].sort()) archive.push(`- ${packageName}`);
  archive.push('');
  archive.push(license.text.trimEnd());
  archive.push('');
}

const sourcePackage = fs.readFileSync(packagePath);
const sourceLock = fs.readFileSync(lockPath);
const sourceDist = fs.readFileSync(sourceDistPath);
const bundledCanvas = fs.readFileSync(bundledCanvasPath);
const sourceRecord = `# WINK GO Knowledge Canvas source record

The bundled \`index.html\` is a restored build of the independently developed
\`${packageManifest.name}\` project, version \`${packageManifest.version}\`. The source project is
preserved in WINK GO's read-only historical project archive. It is independently
developed WINK GO material, not derived from AionUI or AionCore.

- Source package.json SHA-256: \`${sha256(sourcePackage)}\`
- Source pnpm-lock.yaml SHA-256: \`${sha256(sourceLock)}\`
- Preserved source dist/index.html SHA-256: \`${sha256(sourceDist)}\`
- Bundled public/knowledge-canvas/index.html SHA-256: \`${sha256(bundledCanvas)}\`

The bundled file includes the React Flow attribution link. The complete license
texts and exact runtime dependency inventory generated from the preserved
source installation are distributed beside this record.
`;

fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
fs.writeFileSync(
  path.join(OUTPUT_ROOT, 'THIRD_PARTY_DEPENDENCIES.json'),
  `${JSON.stringify({ generatedFrom: `${packageManifest.name}@${packageManifest.version}`, packages: inventory }, null, 2)}\n`
);
fs.writeFileSync(path.join(OUTPUT_ROOT, 'THIRD_PARTY_LICENSES.txt'), `${archive.join('\n').trimEnd()}\n`);
fs.writeFileSync(path.join(OUTPUT_ROOT, 'SOURCE.md'), sourceRecord);

console.log(
  `Generated Knowledge Canvas legal bundle: ${inventory.length} packages, ${licenseTexts.size} license texts.`
);
