#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LEGAL_FILES = [
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'THIRD_PARTY_DEPENDENCIES.json',
  'THIRD_PARTY_LICENSES.txt',
  'PRIVACY.md',
  'TERMS.md',
];

function refused(message = 'Release receiver command refused.') {
  throw new Error(message);
}

function parseForcedCommand(command) {
  if (command === 'probe') {
    return { action: 'probe' };
  }

  const match = /^publish ([0-9]+\.[0-9]+\.[0-9]+)$/.exec(command || '');
  if (!match) {
    refused();
  }

  return { action: 'publish', version: match[1] };
}

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateBundle(bundleDirectory, version) {
  invariant(/^\d+\.\d+\.\d+$/.test(version), 'Invalid release version.');

  const installerName = `WINK-GO-Free-Setup-${version}-x64.exe`;
  const installerPath = path.join(bundleDirectory, installerName);
  const checksumPath = path.join(bundleDirectory, `${installerName}.sha256.txt`);
  const latestPath = path.join(bundleDirectory, 'latest.yml');
  const manifestPath = path.join(bundleDirectory, 'winkgo-free-update.json');

  for (const requiredPath of [
    installerPath,
    checksumPath,
    latestPath,
    manifestPath,
    ...LEGAL_FILES.map((fileName) => path.join(bundleDirectory, fileName)),
  ]) {
    invariant(
      fs.lstatSync(requiredPath, { throwIfNoEntry: false })?.isFile(),
      `Missing release file: ${path.basename(requiredPath)}`
    );
    invariant(fs.statSync(requiredPath).size > 0, `Release file is empty: ${path.basename(requiredPath)}`);
  }

  const installer = fs.readFileSync(installerPath);
  invariant(installer.length > 0, 'Installer is empty.');
  const sha256 = crypto.createHash('sha256').update(installer).digest('hex').toUpperCase();
  const sizeBytes = installer.byteLength;

  const checksumText = fs.readFileSync(checksumPath, 'utf8').trim();
  const checksumMatch = /^([A-Fa-f0-9]{64}) {2}([^/\\]+)$/.exec(checksumText);
  invariant(checksumMatch, 'Invalid installer checksum file.');
  invariant(checksumMatch[1].toUpperCase() === sha256, 'Installer checksum does not match its bytes.');
  invariant(checksumMatch[2] === installerName, 'Checksum references the wrong installer.');

  const latest = fs.readFileSync(latestPath, 'utf8');
  invariant(
    new RegExp(`^version:\\s*['\"]?${version.replaceAll('.', '\\.')}['\"]?\\s*$`, 'm').test(latest),
    'Updater YAML has the wrong version.'
  );
  const latestReferences = [...latest.matchAll(/^\s*(?:-\s+)?(?:url|path):\s*['\"]?([^'\"\r\n]+)['\"]?\s*$/gm)].map(
    (match) => match[1].trim()
  );
  invariant(latestReferences.length > 0, 'Updater YAML does not reference an installer.');
  invariant(
    latestReferences.every((reference) => reference === installerName),
    'Updater YAML references the wrong installer.'
  );

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const expectedUrl = `https://winkgo.top/releases/free/${version}/${installerName}`;
  for (const candidate of [manifest, manifest.windows]) {
    invariant(candidate && typeof candidate === 'object', 'Website update manifest is incomplete.');
    invariant(candidate.version === version, 'Website update manifest has the wrong version.');
    invariant(candidate.fileName === installerName, 'Website update manifest references the wrong installer.');
    invariant(candidate.downloadUrl === expectedUrl, 'Website update manifest has the wrong domestic download URL.');
    invariant(
      String(candidate.sha256 || '').toUpperCase() === sha256,
      'Website update manifest checksum does not match.'
    );
    invariant(candidate.sizeBytes === sizeBytes, 'Website update manifest size does not match.');
  }
  invariant(
    manifest.edition === 'free' && manifest.releaseProfile === 'free',
    'Website update manifest is not Free edition.'
  );

  return { installerName, sha256, sizeBytes };
}

function validateArchiveEntries(entries, version) {
  const installerName = `WINK-GO-Free-Setup-${version}-x64.exe`;
  const expected = [
    installerName,
    `${installerName}.sha256.txt`,
    'latest.yml',
    'winkgo-free-update.json',
    ...LEGAL_FILES,
  ];
  invariant(
    Array.isArray(entries) && entries.length === expected.length,
    'Release archive has an unexpected entry count.'
  );
  invariant(new Set(entries).size === entries.length, 'Release archive contains duplicate entries.');

  for (const entry of entries) {
    invariant(typeof entry === 'string' && entry.length > 0, 'Release archive has an invalid entry.');
    invariant(
      path.posix.basename(entry) === entry && path.win32.basename(entry) === entry,
      'Release archive entry is not flat.'
    );
    invariant(
      !entry.includes('..') && !entry.includes('/') && !entry.includes('\\'),
      'Release archive entry is unsafe.'
    );
    invariant(expected.includes(entry), `Release archive entry is not approved: ${entry}`);
  }

  for (const required of expected) {
    invariant(entries.includes(required), `Release archive is missing: ${required}`);
  }
  return entries;
}

function validateArchiveTypes(verboseEntries, expectedCount) {
  invariant(verboseEntries.length === expectedCount, 'Release archive type listing has the wrong entry count.');
  invariant(
    verboseEntries.every((entry) => entry.startsWith('-')),
    'Release archive entries must all be regular files.'
  );
}

function updateHomepageUrls(source, version, installerName) {
  const domesticUrl = `https://winkgo.top/releases/free/${version}/${installerName}`;
  const githubUrl = `https://github.com/WINKGO/WinkGo/releases/download/v${version}/${installerName}`;
  let domesticMatches = 0;
  let githubMatches = 0;

  const html = source
    .replace(
      /https:\/\/winkgo\.top\/releases\/free\/\d+\.\d+\.\d+\/WINK-GO-Free-Setup-\d+\.\d+\.\d+-x64\.exe/gi,
      () => {
        domesticMatches += 1;
        return domesticUrl;
      }
    )
    .replace(
      /https:\/\/github\.com\/WINKGO\/wink-?go\/releases\/download\/v\d+\.\d+\.\d+\/WINK-GO-Free-Setup-\d+\.\d+\.\d+-x64\.exe/gi,
      () => {
        githubMatches += 1;
        return githubUrl;
      }
    );

  invariant(domesticMatches > 0, 'Homepage has no domestic release URL to update.');
  invariant(githubMatches > 0, 'Homepage has no GitHub release URL to update.');
  return html;
}

function atomicWrite(destination, contents) {
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  fs.writeFileSync(temporary, contents, { flag: 'wx', mode: 0o644 });
  try {
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (process.platform !== 'win32' || !fs.existsSync(destination)) {
      throw error;
    }
    fs.rmSync(destination, { force: true });
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function publishBundle({ bundleDirectory, releasesRoot, siteIndexPath, version }) {
  const validated = validateBundle(bundleDirectory, version);
  const versionDirectory = path.join(releasesRoot, version);
  invariant(!fs.existsSync(versionDirectory), `Same-version release already exists: ${version}`);
  invariant(fs.lstatSync(siteIndexPath, { throwIfNoEntry: false })?.isFile(), 'Homepage index.html is missing.');

  const siteRoot = path.dirname(siteIndexPath);
  const siteManifestPath = path.join(siteRoot, 'winkgo-free-update.json');
  const homepageBefore = fs.readFileSync(siteIndexPath);
  const homepageAfter = updateHomepageUrls(homepageBefore.toString('utf8'), version, validated.installerName);
  const latestBefore = fs.existsSync(path.join(releasesRoot, 'latest.yml'))
    ? fs.readFileSync(path.join(releasesRoot, 'latest.yml'))
    : null;
  const manifestBefore = fs.existsSync(siteManifestPath) ? fs.readFileSync(siteManifestPath) : null;
  const stagingDirectory = path.join(releasesRoot, `.incoming-${version}-${crypto.randomUUID()}`);
  const createdAliases = [];
  let versionPublished = false;

  fs.mkdirSync(releasesRoot, { recursive: true, mode: 0o755 });
  fs.cpSync(bundleDirectory, stagingDirectory, { errorOnExist: true, recursive: true });
  validateBundle(stagingDirectory, version);

  try {
    fs.renameSync(stagingDirectory, versionDirectory);
    versionPublished = true;

    for (const fileName of [validated.installerName, `${validated.installerName}.sha256.txt`]) {
      const aliasPath = path.join(releasesRoot, fileName);
      invariant(!fs.existsSync(aliasPath), `Release alias already exists: ${fileName}`);
      fs.linkSync(path.join(versionDirectory, fileName), aliasPath);
      createdAliases.push(aliasPath);
    }

    atomicWrite(path.join(releasesRoot, 'latest.yml'), fs.readFileSync(path.join(versionDirectory, 'latest.yml')));
    atomicWrite(siteManifestPath, fs.readFileSync(path.join(versionDirectory, 'winkgo-free-update.json')));
    atomicWrite(siteIndexPath, homepageAfter);
    return validated;
  } catch (error) {
    for (const aliasPath of createdAliases) {
      fs.rmSync(aliasPath, { force: true });
    }
    if (latestBefore) atomicWrite(path.join(releasesRoot, 'latest.yml'), latestBefore);
    else fs.rmSync(path.join(releasesRoot, 'latest.yml'), { force: true });
    if (manifestBefore) atomicWrite(siteManifestPath, manifestBefore);
    else fs.rmSync(siteManifestPath, { force: true });
    atomicWrite(siteIndexPath, homepageBefore);
    if (versionPublished) fs.rmSync(versionDirectory, { force: true, recursive: true });
    throw error;
  } finally {
    fs.rmSync(stagingDirectory, { force: true, recursive: true });
  }
}

function runTar(arguments_) {
  const result = childProcess.spawnSync('tar', arguments_, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  invariant(!result.error, `Unable to run tar: ${result.error?.message || 'unknown error'}`);
  invariant(result.status === 0, `tar failed: ${(result.stderr || result.stdout || '').trim()}`);
  return result.stdout;
}

function publishArchive({ archivePath, releasesRoot, siteIndexPath, version }) {
  const archiveStat = fs.lstatSync(archivePath, { throwIfNoEntry: false });
  invariant(archiveStat?.isFile(), 'Release archive is missing or is not a regular file.');
  invariant(archiveStat.size > 0 && archiveStat.size <= 1024 * 1024 * 1024, 'Release archive size is invalid.');

  const entries = runTar(['-tzf', archivePath]).split(/\r?\n/).filter(Boolean);
  validateArchiveEntries(entries, version);
  const verboseEntries = runTar(['-tvzf', archivePath]).split(/\r?\n/).filter(Boolean);
  validateArchiveTypes(verboseEntries, entries.length);

  const extractionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'winkgo-release-extract-'));
  try {
    const extractionArguments = ['-xzf', archivePath, '-C', extractionDirectory];
    if (process.platform !== 'win32') {
      extractionArguments.push('--no-same-owner', '--no-same-permissions');
    }
    runTar(extractionArguments);
    validateBundle(extractionDirectory, version);
    return publishBundle({ bundleDirectory: extractionDirectory, releasesRoot, siteIndexPath, version });
  } finally {
    fs.rmSync(extractionDirectory, { force: true, recursive: true });
  }
}

async function receiveArchiveFromStdin(version) {
  const { pipeline } = require('node:stream/promises');
  const incomingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'winkgo-release-upload-'));
  const archivePath = path.join(incomingDirectory, 'release.tar.gz');
  try {
    await pipeline(process.stdin, fs.createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }));
    return publishArchive({
      archivePath,
      releasesRoot: '/www/wwwroot/winkgo.top/releases/free',
      siteIndexPath: '/www/wwwroot/winkgo.top/index.html',
      version,
    });
  } finally {
    fs.rmSync(incomingDirectory, { force: true, recursive: true });
  }
}

async function main() {
  if (process.argv[2] === 'validate') {
    const version = process.argv[3];
    const bundleDirectory = process.argv[4];
    invariant(/^\d+\.\d+\.\d+$/.test(version || ''), 'Local validation requires a strict version.');
    invariant(bundleDirectory, 'Local validation requires a bundle directory.');
    const result = validateBundle(path.resolve(bundleDirectory), version);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  const command = parseForcedCommand(process.env.SSH_ORIGINAL_COMMAND);
  if (command.action === 'probe') {
    process.stdout.write('WINKGO_RELEASE_RECEIVER_READY 1\n');
    return;
  }

  const result = await receiveArchiveFromStdin(command.version);
  process.stdout.write(`WINKGO_RELEASE_PUBLISHED ${command.version} ${result.sha256} ${result.sizeBytes}\n`);
}

module.exports = {
  parseForcedCommand,
  validateBundle,
  validateArchiveEntries,
  validateArchiveTypes,
  publishBundle,
  publishArchive,
  receiveArchiveFromStdin,
  updateHomepageUrls,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`winkgo-release-receiver: ${error.message}\n`);
    process.exitCode = 1;
  });
}
