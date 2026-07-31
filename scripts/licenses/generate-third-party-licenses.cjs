#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIRECTORY = path.join(PROJECT_ROOT, 'legal');
const INVENTORY_PATH = path.join(OUTPUT_DIRECTORY, 'THIRD_PARTY_DEPENDENCIES.json');
const LICENSE_ARCHIVE_PATH = path.join(OUTPUT_DIRECTORY, 'THIRD_PARTY_LICENSES.txt');
const OVERRIDES_PATH = path.join(__dirname, 'license-overrides.json');
const LICENSE_REFERENCE_DIRECTORY = path.join(__dirname, 'reference');
const LOCK_PATHS = [
  'bun.lock',
  'mobile/bun.lock',
  'backend/Cargo.lock',
  'backend/agent-runtime/Cargo.lock',
  'packages/desktop/native/winkgo-native-drop/Cargo.lock',
];
const NPM_INSTALL_ROOTS = [PROJECT_ROOT, path.join(PROJECT_ROOT, 'mobile')];
const CARGO_MANIFESTS = [
  'backend/Cargo.toml',
  'backend/agent-runtime/Cargo.toml',
  'packages/desktop/native/winkgo-native-drop/Cargo.toml',
];
const CARGO_RELEASE_TARGETS = [
  'x86_64-pc-windows-msvc',
  'aarch64-pc-windows-msvc',
  'x86_64-apple-darwin',
  'aarch64-apple-darwin',
  'x86_64-unknown-linux-gnu',
  'aarch64-unknown-linux-gnu',
];
const STANDARD_LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function normalizeText(content) {
  return (
    content
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim() + '\n'
  );
}

function parseJsonWithTrailingCommas(content, filePath) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === ',') {
      let next = index + 1;
      while (/\s/.test(content[next] || '')) next += 1;
      if (content[next] === '}' || content[next] === ']') continue;
    }
    result += character;
  }
  try {
    return JSON.parse(result);
  } catch (error) {
    throw new Error(`Invalid Bun lock file ${filePath}: ${error.message}`);
  }
}

function readTextFile(filePath) {
  const content = fs.readFileSync(filePath);
  if (content.includes(0)) return null;
  return normalizeText(content.toString('utf8'));
}

function normalizeLicense(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const licenses = value.map(normalizeLicense).filter(Boolean);
    return licenses.length > 0 ? [...new Set(licenses)].sort().join(' OR ') : null;
  }
  if (value && typeof value === 'object') {
    return normalizeLicense(value.type || value.name);
  }
  return null;
}

function normalizeRepository(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.url === 'string') return value.url;
  return null;
}

function normalizeNpmVersion(value) {
  const version = String(value).trim();
  return /^v\d+\.\d+\.\d+(?:[-+].*)?$/i.test(version) ? version.slice(1) : version;
}

function findLicenseFiles(packageDirectory, declaredLicenseFile) {
  const candidates = new Set();
  for (const entry of fs.readdirSync(packageDirectory, { withFileTypes: true })) {
    if (entry.isFile() && STANDARD_LICENSE_FILE.test(entry.name)) {
      candidates.add(path.join(packageDirectory, entry.name));
    }
  }
  if (declaredLicenseFile) {
    const resolved = path.resolve(packageDirectory, declaredLicenseFile);
    const relative = path.relative(packageDirectory, resolved);
    if (!relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(resolved)) {
      candidates.add(resolved);
    }
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

function addLicenseTexts(entry, packageDirectory, declaredLicenseFile, licenseTexts) {
  const refs = [];
  for (const filePath of findLicenseFiles(packageDirectory, declaredLicenseFile)) {
    const content = readTextFile(filePath);
    if (!content) continue;
    const hash = sha256(content);
    if (!licenseTexts.has(hash)) {
      licenseTexts.set(hash, {
        hash,
        text: content,
        fileNames: new Set(),
        packages: new Set(),
      });
    }
    const record = licenseTexts.get(hash);
    record.fileNames.add(path.basename(filePath));
    record.packages.add(entry.id);
    refs.push(hash);
  }
  entry.licenseTextHashes = [...new Set(refs)].sort();
}

function workspacePackageNames() {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const names = new Set([rootPackage.name]);
  const mobileManifestPath = path.join(PROJECT_ROOT, 'mobile/package.json');
  if (fs.existsSync(mobileManifestPath)) {
    names.add(JSON.parse(fs.readFileSync(mobileManifestPath, 'utf8')).name);
  }
  for (const workspacePattern of rootPackage.workspaces || []) {
    if (!workspacePattern.endsWith('/*')) continue;
    const workspaceRoot = path.join(PROJECT_ROOT, workspacePattern.slice(0, -2));
    if (!fs.existsSync(workspaceRoot)) continue;
    for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(workspaceRoot, entry.name, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name) names.add(manifest.name);
    }
  }
  return names;
}

function npmIdFromResolution(resolution) {
  if (typeof resolution !== 'string') return null;
  const separator = resolution.startsWith('@')
    ? resolution.indexOf('@', resolution.indexOf('/') + 1)
    : resolution.lastIndexOf('@');
  if (separator <= 0) return null;
  const name = resolution.slice(0, separator);
  const version = resolution.slice(separator + 1);
  if (!version || /^(?:workspace|file|link|git|github):/i.test(version)) return null;
  return `npm:${name}@${version}`;
}

function expectedNpmPackageIds() {
  const firstPartyNames = workspacePackageNames();
  const ids = new Set();
  for (const relativePath of ['bun.lock', 'mobile/bun.lock']) {
    const absolutePath = path.join(PROJECT_ROOT, relativePath);
    const lock = parseJsonWithTrailingCommas(fs.readFileSync(absolutePath, 'utf8'), relativePath);
    for (const record of Object.values(lock.packages || {})) {
      if (!Array.isArray(record)) continue;
      const id = npmIdFromResolution(record[0]);
      if (!id) continue;
      const nameAndVersion = id.slice('npm:'.length);
      const versionSeparator = nameAndVersion.startsWith('@')
        ? nameAndVersion.indexOf('@', nameAndVersion.indexOf('/') + 1)
        : nameAndVersion.lastIndexOf('@');
      if (!firstPartyNames.has(nameAndVersion.slice(0, versionSeparator))) ids.add(id);
    }
  }
  return ids;
}

function npmLicenseFamily(name) {
  const families = [
    /^@esbuild\//,
    /^@img\/sharp-libvips-/,
    /^@img\/sharp-/,
    /^@napi-rs\/canvas-/,
    /^@oxc-parser\/binding-/,
    /^@oxfmt\/binding-/,
    /^@oxlint\/binding-/,
    /^@rollup\/rollup-/,
    /^@sentry\/cli-/,
    /^@unrs\/resolver-binding-/,
    /^lightningcss-/,
  ];
  const family = families.find((pattern) => pattern.test(name));
  return family ? family.source : name;
}

const LOCK_ONLY_LICENSES = {
  '@emnapi/core': 'MIT',
  '@emnapi/runtime': 'MIT',
  '@emnapi/wasi-threads': 'MIT',
  '@napi-rs/wasm-runtime': 'MIT',
  '@tybys/wasm-util': 'MIT',
  fsevents: 'MIT',
};

function createLockOnlyNpmEntries(expectedIds, installedEntries) {
  const installedByFamilyAndVersion = new Map();
  const installedIds = new Set(installedEntries.map((entry) => entry.id));
  for (const entry of installedEntries) {
    installedByFamilyAndVersion.set(`${npmLicenseFamily(entry.name)}@${entry.version}`, entry);
  }

  const lockOnlyEntries = [];
  for (const id of expectedIds) {
    if (installedIds.has(id)) continue;
    const nameAndVersion = id.slice('npm:'.length);
    const versionSeparator = nameAndVersion.startsWith('@')
      ? nameAndVersion.indexOf('@', nameAndVersion.indexOf('/') + 1)
      : nameAndVersion.lastIndexOf('@');
    const name = nameAndVersion.slice(0, versionSeparator);
    const version = nameAndVersion.slice(versionSeparator + 1);
    const family = npmLicenseFamily(name);
    let familyEntry = installedByFamilyAndVersion.get(`${family}@${version}`);
    if (!familyEntry && family === '^@img\\/sharp-libvips-') {
      familyEntry = installedEntries.find((entry) => entry.name.startsWith('@img/sharp-'));
    }
    lockOnlyEntries.push({
      id,
      ecosystem: 'npm',
      name,
      version,
      source: 'bun.lock (package payload not installed on this host)',
      license: familyEntry?.license || LOCK_ONLY_LICENSES[name] || null,
      licenseTextHashes: [],
      resolutionState: 'lock-only-platform-or-optional',
      licenseProvenance: familyEntry ? `same-family package metadata: ${familyEntry.id}` : 'documented local override',
    });
  }
  return lockOnlyEntries;
}

function pruneUnlockedNpmLicenseTexts(expectedIds, licenseTexts) {
  for (const [hash, record] of licenseTexts) {
    for (const packageId of record.packages) {
      if (packageId.startsWith('npm:') && !expectedIds.has(packageId)) record.packages.delete(packageId);
    }
    if (record.packages.size === 0) licenseTexts.delete(hash);
  }
}

function packageDirectories(nodeModulesDirectory) {
  if (!fs.existsSync(nodeModulesDirectory)) return [];
  const directories = [];
  for (const entry of fs.readdirSync(nodeModulesDirectory, { withFileTypes: true })) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith('.')) continue;
    const entryPath = path.join(nodeModulesDirectory, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scopedEntry of fs.readdirSync(entryPath, { withFileTypes: true })) {
        if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) {
          directories.push(path.join(entryPath, scopedEntry.name));
        }
      }
    } else {
      directories.push(entryPath);
    }
  }
  return directories;
}

function bunStorePackageDirectories(installRoot) {
  const bunStore = path.join(installRoot, 'node_modules/.bun');
  if (!fs.existsSync(bunStore)) return [];
  const directories = [];
  for (const storeEntry of fs.readdirSync(bunStore, { withFileTypes: true })) {
    if (!storeEntry.isDirectory()) continue;
    const storeNodeModules = path.join(bunStore, storeEntry.name, 'node_modules');
    if (!fs.existsSync(storeNodeModules)) continue;
    for (const packageDirectory of packageDirectories(storeNodeModules)) {
      if (!fs.lstatSync(packageDirectory).isSymbolicLink()) directories.push(packageDirectory);
    }
  }
  return directories;
}

function collectNpmEntries(licenseTexts) {
  const firstPartyNames = workspacePackageNames();
  const entries = new Map();
  const pendingPackages = [];
  for (const installRoot of NPM_INSTALL_ROOTS) {
    pendingPackages.push(...packageDirectories(path.join(installRoot, 'node_modules')));
    pendingPackages.push(...bunStorePackageDirectories(installRoot));
  }
  const visitedPackages = new Set();

  while (pendingPackages.length > 0) {
    const packageDirectory = pendingPackages.pop();
    let realPackageDirectory;
    try {
      realPackageDirectory = fs.realpathSync(packageDirectory);
    } catch {
      continue;
    }
    if (visitedPackages.has(realPackageDirectory)) continue;
    visitedPackages.add(realPackageDirectory);

    if (!fs.lstatSync(packageDirectory).isSymbolicLink() && !packageDirectory.includes(`${path.sep}.bun${path.sep}`)) {
      const nestedNodeModules = path.join(packageDirectory, 'node_modules');
      pendingPackages.push(...packageDirectories(nestedNodeModules));
    }

    const manifestPath = path.join(packageDirectory, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      throw new Error(`Invalid npm package manifest ${manifestPath}: ${error.message}`);
    }
    if (!manifest.name || !manifest.version || firstPartyNames.has(manifest.name)) continue;

    const version = normalizeNpmVersion(manifest.version);
    const id = `npm:${manifest.name}@${version}`;
    if (entries.has(id)) continue;
    const entry = {
      id,
      ecosystem: 'npm',
      name: manifest.name,
      version,
      source: normalizeRepository(manifest.repository) || manifest.homepage || null,
      license: normalizeLicense(manifest.license || manifest.licenses),
      licenseTextHashes: [],
    };
    const declaredLicense =
      typeof entry.license === 'string' && /^SEE LICEN[CS]E IN /i.test(entry.license)
        ? entry.license.replace(/^SEE LICEN[CS]E IN /i, '').trim()
        : null;
    addLicenseTexts(entry, packageDirectory, declaredLicense, licenseTexts);
    entries.set(id, entry);
  }
  return [...entries.values()];
}

function cargoMetadata(manifestPath, target) {
  const result = spawnSync(
    'cargo',
    [
      'metadata',
      '--manifest-path',
      manifestPath,
      '--locked',
      '--offline',
      '--format-version',
      '1',
      '--filter-platform',
      target,
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: { ...process.env, CARGO_NET_OFFLINE: 'true' },
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  if (result.error) {
    throw new Error(`Unable to run Cargo for ${manifestPath} (${target}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Cargo metadata failed for ${manifestPath} (${target}):\n${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

function collectCargoEntries(licenseTexts) {
  const entries = new Map();
  for (const relativeManifest of CARGO_MANIFESTS) {
    for (const target of CARGO_RELEASE_TARGETS) {
      const metadata = cargoMetadata(relativeManifest, target);
      for (const cargoPackage of metadata.packages) {
        if (!cargoPackage.source) continue;
        const id = `cargo:${cargoPackage.name}@${cargoPackage.version}`;
        if (entries.has(id)) continue;
        const entry = {
          id,
          ecosystem: 'cargo',
          name: cargoPackage.name,
          version: cargoPackage.version,
          source: cargoPackage.source,
          license: normalizeLicense(cargoPackage.license),
          licenseTextHashes: [],
        };
        const packageDirectory = path.dirname(cargoPackage.manifest_path);
        addLicenseTexts(entry, packageDirectory, cargoPackage.license_file, licenseTexts);
        entries.set(id, entry);
      }
    }
  }
  return [...entries.values()];
}

function loadOverrides() {
  const parsed = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
  return parsed.overrides || {};
}

function applyOverrides(entries, licenseTexts, overrides) {
  const knownIds = new Set(entries.map((entry) => entry.id));
  const staleOverrides = Object.keys(overrides).filter((id) => !knownIds.has(id));
  if (staleOverrides.length > 0) {
    throw new Error(`Stale license override(s): ${staleOverrides.sort().join(', ')}`);
  }

  for (const entry of entries) {
    const override = overrides[entry.id];
    if (!override) continue;
    if (!override.reason || typeof override.reason !== 'string') {
      throw new Error(`License override ${entry.id} must include a reason`);
    }
    if (override.license) entry.license = override.license;
    if (override.licenseFile) {
      const filePath = path.resolve(PROJECT_ROOT, override.licenseFile);
      const relative = path.relative(PROJECT_ROOT, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
        throw new Error(`License override ${entry.id} references an invalid licenseFile`);
      }
      const content = readTextFile(filePath);
      if (!content) throw new Error(`License override ${entry.id} references an unreadable licenseFile`);
      const hash = sha256(content);
      if (!licenseTexts.has(hash)) {
        licenseTexts.set(hash, {
          hash,
          text: content,
          fileNames: new Set([path.basename(filePath)]),
          packages: new Set(),
        });
      }
      licenseTexts.get(hash).packages.add(entry.id);
      entry.licenseTextHashes = [...new Set([...entry.licenseTextHashes, hash])].sort();
    }
    entry.overrideReason = override.reason;
  }
}

function validateEntries(entries) {
  const unresolved = entries.filter((entry) => !entry.license && entry.licenseTextHashes.length === 0);
  if (unresolved.length > 0) {
    throw new Error(
      [
        'Third-party packages have neither license metadata nor a license text.',
        'Investigate each package and add a documented override only when its license is confirmed:',
        ...unresolved.map((entry) => `- ${entry.id}`),
      ].join('\n')
    );
  }
}

function attachSharpLibvipsCompliance(entries, licenseTexts) {
  const affectedEntries = entries.filter(
    (entry) => entry.ecosystem === 'npm' && (entry.name === 'sharp' || entry.name.startsWith('@img/sharp-'))
  );
  if (affectedEntries.length === 0) return;

  for (const fileName of ['LGPL-3.0.txt', 'GPL-3.0.txt', 'SHARP-LIBVIPS-SOURCE.md']) {
    const filePath = path.join(LICENSE_REFERENCE_DIRECTORY, fileName);
    const content = readTextFile(filePath);
    if (!content) throw new Error(`Missing required sharp/libvips compliance file: ${filePath}`);
    const hash = sha256(content);
    if (!licenseTexts.has(hash)) {
      licenseTexts.set(hash, {
        hash,
        text: content,
        fileNames: new Set([fileName]),
        packages: new Set(),
      });
    }
    const record = licenseTexts.get(hash);
    for (const entry of affectedEntries) {
      record.packages.add(entry.id);
      entry.licenseTextHashes = [...new Set([...entry.licenseTextHashes, hash])].sort();
    }
  }
}

function lockSources() {
  return LOCK_PATHS.map((relativePath) => {
    const absolutePath = path.join(PROJECT_ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`Missing dependency lock file: ${relativePath}`);
    return { path: relativePath.replaceAll('\\', '/'), sha256: sha256(fs.readFileSync(absolutePath)) };
  });
}

function renderInventory(entries, licenseTexts) {
  const npmCount = entries.filter((entry) => entry.ecosystem === 'npm').length;
  const cargoCount = entries.filter((entry) => entry.ecosystem === 'cargo').length;
  const lockOnlyCount = entries.filter((entry) => entry.resolutionState === 'lock-only-platform-or-optional').length;
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        scope:
          'Conservative inventory of all Bun lock packages and external Cargo packages resolved for WINK GO release targets. It includes build and development dependencies as a compliance-safe superset of release runtime dependencies.',
        cargoReleaseTargets: CARGO_RELEASE_TARGETS,
        generatedFrom: lockSources(),
        summary: {
          packages: entries.length,
          npmPackages: npmCount,
          cargoPackages: cargoCount,
          lockOnlyNpmPackages: lockOnlyCount,
          uniqueLicenseTexts: licenseTexts.size,
        },
        packages: entries,
      },
      null,
      2
    ) + '\n'
  );
}

function renderLicenseArchive(licenseTexts) {
  const sections = [
    'WINKGO THIRD-PARTY LICENSE TEXT ARCHIVE',
    '',
    'This archive contains deduplicated license and notice texts discovered in the',
    'installed Bun/npm dependency tree and the Cargo dependency sources resolved by',
    'the repository lock files. Package-to-text mappings and exact versions are in',
    'THIRD_PARTY_DEPENDENCIES.json.',
    '',
  ];
  for (const record of [...licenseTexts.values()].sort((left, right) => left.hash.localeCompare(right.hash))) {
    sections.push('='.repeat(80));
    sections.push(`SHA-256: ${record.hash}`);
    sections.push(`Files: ${[...record.fileNames].sort().join(', ')}`);
    sections.push('Packages:');
    for (const packageId of [...record.packages].sort()) sections.push(`- ${packageId}`);
    sections.push('');
    sections.push(record.text.trimEnd());
    sections.push('');
  }
  return sections.join('\n').trimEnd() + '\n';
}

function generateArtifacts() {
  const licenseTexts = new Map();
  const expectedNpmIds = expectedNpmPackageIds();
  const installedNpmEntries = collectNpmEntries(licenseTexts).filter((entry) => expectedNpmIds.has(entry.id));
  pruneUnlockedNpmLicenseTexts(expectedNpmIds, licenseTexts);
  const entries = [
    ...installedNpmEntries,
    ...createLockOnlyNpmEntries(expectedNpmIds, installedNpmEntries),
    ...collectCargoEntries(licenseTexts),
  ].sort((left, right) => left.id.localeCompare(right.id));
  applyOverrides(entries, licenseTexts, loadOverrides());
  attachSharpLibvipsCompliance(entries, licenseTexts);
  validateEntries(entries);
  return {
    inventory: renderInventory(entries, licenseTexts),
    licenseArchive: renderLicenseArchive(licenseTexts),
  };
}

function checkFile(filePath, expected) {
  if (!fs.existsSync(filePath))
    throw new Error(`Missing generated legal artifact: ${path.relative(PROJECT_ROOT, filePath)}`);
  if (fs.readFileSync(filePath, 'utf8') !== expected) {
    throw new Error(
      `Generated legal artifact is stale: ${path.relative(PROJECT_ROOT, filePath)}. Run bun run licenses:generate.`
    );
  }
}

function checkLockInputs() {
  if (!fs.existsSync(INVENTORY_PATH) || !fs.existsSync(LICENSE_ARCHIVE_PATH)) {
    throw new Error('Generated third-party legal artifacts are missing. Run bun run licenses:generate.');
  }
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  if (JSON.stringify(inventory.generatedFrom) !== JSON.stringify(lockSources())) {
    throw new Error('Dependency lock files changed. Run bun run licenses:generate.');
  }
  const entries = inventory.packages || [];
  validateEntries(entries);
  const ids = new Set(entries.map((entry) => entry.id));
  const missingNpmPackages = [...expectedNpmPackageIds()].filter((id) => !ids.has(id));
  if (missingNpmPackages.length > 0) {
    throw new Error(`Generated inventory omits Bun lock package(s): ${missingNpmPackages.sort().join(', ')}`);
  }
  if (ids.size !== entries.length) throw new Error('Generated inventory contains duplicate package identifiers.');
  const archive = fs.readFileSync(LICENSE_ARCHIVE_PATH, 'utf8');
  if (entries.some((entry) => entry.license?.includes('LGPL-3.0'))) {
    for (const marker of [
      'GNU LESSER GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007',
      'GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007',
      '# sharp and libvips distribution information',
    ]) {
      if (!archive.includes(marker)) throw new Error(`License archive omits required LGPL marker: ${marker}`);
    }
  }
  for (const entry of entries) {
    for (const hash of entry.licenseTextHashes) {
      if (!archive.includes(`SHA-256: ${hash}`)) {
        throw new Error(`License archive omits ${hash}, referenced by ${entry.id}`);
      }
    }
  }
  console.log('Third-party dependency lock coverage and license archive references are valid.');
}

function main(args = process.argv.slice(2)) {
  if (args.includes('--check-locks')) {
    checkLockInputs();
    return;
  }
  const check = args.includes('--check');
  const artifacts = generateArtifacts();
  if (check) {
    checkFile(INVENTORY_PATH, artifacts.inventory);
    checkFile(LICENSE_ARCHIVE_PATH, artifacts.licenseArchive);
    console.log('Third-party dependency license artifacts are current.');
    return;
  }
  fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  fs.writeFileSync(INVENTORY_PATH, artifacts.inventory);
  fs.writeFileSync(LICENSE_ARCHIVE_PATH, artifacts.licenseArchive);
  console.log(`Wrote ${path.relative(PROJECT_ROOT, INVENTORY_PATH)}`);
  console.log(`Wrote ${path.relative(PROJECT_ROOT, LICENSE_ARCHIVE_PATH)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  generateArtifacts,
  checkLockInputs,
  main,
  normalizeLicense,
  normalizeNpmVersion,
  validateEntries,
};
