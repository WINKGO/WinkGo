#!/usr/bin/env node
/**
 * Verifies Apache-2.0 upstream provenance and modification notices without
 * requiring a network connection or an upstream checkout.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { commentStyle } = require('./apply-upstream-attribution.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PROJECTS = [
  {
    name: 'AionUI',
    tag: 'v2.1.41',
    commit: '2d8925fc67a97a20996fadcd2a0862b778b572ba',
    source: 'https://github.com/iOfficeAI/AionUi',
    licenseSha256: 'a515d5a76da6c082f0d3d33a597bf82e32ecdac8841ed1783ac081ebd6d62ebf',
    inventory: 'docs/vendor/aionui-upstream-inventory.tsv',
    inventorySha256: '024032e60a71224fabb01ce7da5243be18c67653348af5b8e256344fcde9763e',
    upstreamEntries: 2033,
    currentRoot: '',
    manifest: 'docs/vendor/aionui-modification-manifest.tsv',
    rows: 1225,
    inline: 1079,
    manifestOnly: 146,
  },
  {
    name: 'AionCore',
    tag: 'v0.1.52',
    commit: '76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d',
    source: 'https://github.com/iOfficeAI/AionCore',
    licenseSha256: 'a515d5a76da6c082f0d3d33a597bf82e32ecdac8841ed1783ac081ebd6d62ebf',
    inventory: 'docs/vendor/aioncore-upstream-inventory.tsv',
    inventorySha256: '77756f9dda2f3694351abe7c0a39a9a968f8fadde77fe28b71fde469f3d225cd',
    upstreamEntries: 1181,
    currentRoot: 'backend',
    manifest: 'docs/vendor/aioncore-modification-manifest.tsv',
    rows: 694,
    inline: 674,
    manifestOnly: 20,
  },
  {
    name: 'aionrs',
    tag: 'v0.2.7',
    commit: '445a18e1625cc68ded3a647ee99332195fbe8508',
    source: 'https://github.com/iOfficeAI/aionrs',
    licenseSha256: '9ff7efda502098c7d8029a7f17e1b4e0e837a91d78c7add23a93d3ec0c08c7d4',
    inventory: 'docs/vendor/aionrs-upstream-inventory.tsv',
    inventorySha256: '1642312db6a3e7623b46edee63d429ada8b1c479367eac9ec991037562d44b07',
    upstreamEntries: 413,
    currentRoot: 'backend/agent-runtime',
    manifest: 'docs/vendor/aionrs-modification-manifest.tsv',
    rows: 386,
    inline: 383,
    manifestOnly: 3,
  },
];
const MANIFEST_COLUMNS = ['disposition', 'type', 'upstream_path', 'current_path', 'upstream_sha256', 'current_sha256'];
const INVENTORY_COLUMNS = ['type', 'upstream_path', 'current_path', 'upstream_sha256'];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256File(filePath, type = 'binary') {
  const bytes = fs.readFileSync(filePath);
  const comparable = type === 'text' ? Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'), 'utf8') : bytes;
  return crypto.createHash('sha256').update(comparable).digest('hex');
}

function sha256NormalizedTextFile(filePath) {
  const text = fs
    .readFileSync(filePath, 'utf8')
    .replace(/^\uFEFF/, '')
    .replaceAll('\r\n', '\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function parseTable(tablePath, columns) {
  const text = fs.readFileSync(tablePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const metadata = lines.filter((line) => line.startsWith('# '));
  const dataLines = lines.filter((line) => line !== '' && !line.startsWith('#'));
  invariant(dataLines.length >= 1, `TSV has no header: ${tablePath}`);
  invariant(dataLines[0] === columns.join('\t'), `TSV columns changed: ${tablePath}`);
  const rows = dataLines.slice(1).map((line, lineIndex) => {
    const values = line.split('\t');
    invariant(values.length === columns.length, `Malformed TSV row ${lineIndex + 2}: ${tablePath}`);
    return Object.fromEntries(columns.map((key, index) => [key, values[index]]));
  });
  return { metadata, rows };
}

function parseManifest(manifestPath) {
  return parseTable(manifestPath, MANIFEST_COLUMNS);
}

function parseInventory(inventoryPath) {
  return parseTable(inventoryPath, INVENTORY_COLUMNS);
}

function resolveRepositoryPath(repoRoot, repositoryPath) {
  invariant(repositoryPath !== '', 'Manifest current_path is empty');
  invariant(!path.posix.isAbsolute(repositoryPath), `Absolute current_path: ${repositoryPath}`);
  const normalized = path.posix.normalize(repositoryPath.replaceAll('\\', '/'));
  invariant(normalized !== '..' && !normalized.startsWith('../'), `current_path escapes repository: ${repositoryPath}`);
  const absolute = path.resolve(repoRoot, ...normalized.split('/'));
  invariant(
    absolute === repoRoot || absolute.startsWith(`${repoRoot}${path.sep}`),
    `current_path escapes repository: ${repositoryPath}`
  );
  return absolute;
}

function verifyManifestRows(repoRoot, project, rows) {
  invariant(rows.length === project.rows, `${project.name} manifest row count changed`);
  const seenUpstream = new Set();
  const seenCurrent = new Set();
  let inline = 0;
  let manifestOnly = 0;

  for (const row of rows) {
    invariant(
      row.disposition === 'inline' || row.disposition === 'manifest-only',
      `Invalid disposition for ${row.current_path}`
    );
    invariant(row.type === 'text' || row.type === 'binary', `Invalid type for ${row.current_path}`);
    invariant(
      /^[a-f0-9]{64}$/.test(row.upstream_sha256) && /^[a-f0-9]{64}$/.test(row.current_sha256),
      `Invalid SHA-256 for ${row.current_path}`
    );
    invariant(!seenUpstream.has(row.upstream_path), `Duplicate upstream path: ${row.upstream_path}`);
    invariant(!seenCurrent.has(row.current_path), `Duplicate current path: ${row.current_path}`);
    seenUpstream.add(row.upstream_path);
    seenCurrent.add(row.current_path);

    const absolute = resolveRepositoryPath(repoRoot, row.current_path);
    invariant(fs.existsSync(absolute) && fs.statSync(absolute).isFile(), `Missing ${row.current_path}`);
    if (row.disposition === 'inline') {
      inline += 1;
      invariant(row.type === 'text', `Binary file marked inline: ${row.current_path}`);
      const text = fs.readFileSync(absolute, 'utf8');
      invariant(
        text.includes(`Modified from ${project.name} by WINK GO contributors in 2026.`),
        `Missing modification notice: ${row.current_path}`
      );
      invariant(commentStyle(row.current_path, row.type) !== null, `Unsafe file marked inline: ${row.current_path}`);
    } else {
      manifestOnly += 1;
      invariant(
        sha256File(absolute, row.type) === row.current_sha256,
        `Manifest-only file changed without a manifest update: ${row.current_path}`
      );
      invariant(
        row.type === 'binary' || commentStyle(row.current_path, row.type) === null,
        `Safely commentable file lacks an inline notice: ${row.current_path}`
      );
    }
  }

  invariant(inline === project.inline, `${project.name} inline count changed`);
  invariant(manifestOnly === project.manifestOnly, `${project.name} manifest-only count changed`);
}

function verifyInventoryCoverage(repoRoot, project, inventoryRows, manifestRows) {
  invariant(inventoryRows.length === project.upstreamEntries, `${project.name} upstream inventory row count changed`);
  const inventoryByUpstream = new Map();
  const inventoryCurrentPaths = new Set();

  for (const row of inventoryRows) {
    invariant(row.type === 'text' || row.type === 'binary', `Invalid inventory type for ${row.upstream_path}`);
    invariant(row.upstream_path !== '' && row.current_path !== '', `${project.name} inventory has an empty path`);
    invariant(/^[a-f0-9]{64}$/.test(row.upstream_sha256), `Invalid upstream SHA-256: ${row.upstream_path}`);
    invariant(!inventoryByUpstream.has(row.upstream_path), `Duplicate inventory upstream path: ${row.upstream_path}`);
    invariant(!inventoryCurrentPaths.has(row.current_path), `Duplicate inventory current path: ${row.current_path}`);
    inventoryByUpstream.set(row.upstream_path, row);
    inventoryCurrentPaths.add(row.current_path);
  }

  const manifestByUpstream = new Map();
  for (const row of manifestRows) {
    const inventory = inventoryByUpstream.get(row.upstream_path);
    invariant(inventory, `Manifest path is absent from pinned inventory: ${row.upstream_path}`);
    invariant(!manifestByUpstream.has(row.upstream_path), `Duplicate manifest upstream path: ${row.upstream_path}`);
    invariant(row.type === inventory.type, `Manifest type differs from inventory: ${row.upstream_path}`);
    invariant(
      row.current_path === path.posix.join(project.currentRoot, inventory.current_path),
      `Manifest current path differs from inventory: ${row.upstream_path}`
    );
    invariant(
      row.upstream_sha256 === inventory.upstream_sha256,
      `Manifest upstream SHA-256 differs from pinned Git blob: ${row.upstream_path}`
    );
    manifestByUpstream.set(row.upstream_path, row);
  }

  for (const inventory of inventoryRows) {
    const repositoryPath = path.posix.join(project.currentRoot, inventory.current_path);
    const absolute = resolveRepositoryPath(repoRoot, repositoryPath);
    const manifest = manifestByUpstream.get(inventory.upstream_path);
    if (!fs.existsSync(absolute)) {
      invariant(!manifest, `Deleted upstream file remains in manifest: ${inventory.upstream_path}`);
      continue;
    }
    invariant(fs.statSync(absolute).isFile(), `Mapped upstream path is not a file: ${repositoryPath}`);
    const modified = sha256File(absolute, inventory.type) !== inventory.upstream_sha256;
    invariant(
      modified === Boolean(manifest),
      modified
        ? `Modified upstream file is missing from the manifest: ${repositoryPath}`
        : `Byte-identical upstream file is incorrectly listed as modified: ${repositoryPath}`
    );
  }
}

function verifyRepository(repoRoot = REPO_ROOT) {
  for (const project of PROJECTS) {
    const inventoryPath = resolveRepositoryPath(repoRoot, project.inventory);
    invariant(
      sha256NormalizedTextFile(inventoryPath) === project.inventorySha256,
      `${project.name} pinned upstream inventory digest changed`
    );
    const { metadata: inventoryMetadata, rows: inventoryRows } = parseInventory(inventoryPath);
    const inventoryMetadataText = inventoryMetadata.join('\n');
    for (const expected of [
      `# Source: ${project.source}`,
      `# Tag: ${project.tag}`,
      `# Commit: ${project.commit}`,
      `# Upstream LICENSE SHA-256: ${project.licenseSha256}`,
    ]) {
      invariant(inventoryMetadataText.includes(expected), `Missing inventory metadata: ${expected}`);
    }

    const manifestPath = resolveRepositoryPath(repoRoot, project.manifest);
    const { metadata, rows } = parseManifest(manifestPath);
    const metadataText = metadata.join('\n');
    for (const expected of [
      `# Upstream project: ${project.name}`,
      `# Source: ${project.source}`,
      `# Tag: ${project.tag}`,
      `# Commit: ${project.commit}`,
      `# Upstream LICENSE SHA-256: ${project.licenseSha256}`,
    ]) {
      invariant(metadataText.includes(expected), `Missing manifest metadata: ${expected}`);
    }
    verifyInventoryCoverage(repoRoot, project, inventoryRows, rows);
    verifyManifestRows(repoRoot, project, rows);
  }

  const licenses = [
    [
      'LICENSE',
      'Copyright 2025 AionUi (aionui.com)\nModifications Copyright 2026 WINK GO contributors.',
      'a515d5a76da6c082f0d3d33a597bf82e32ecdac8841ed1783ac081ebd6d62ebf',
    ],
    [
      'backend/LICENSE',
      'Copyright 2025 AionUi (aionui.com)\nModifications Copyright 2026 WINK GO contributors.',
      'a515d5a76da6c082f0d3d33a597bf82e32ecdac8841ed1783ac081ebd6d62ebf',
    ],
    [
      'backend/agent-runtime/LICENSE',
      'Copyright 2026 iOfficeAI\n   Modifications Copyright 2026 WINK GO contributors.',
      '9ff7efda502098c7d8029a7f17e1b4e0e837a91d78c7add23a93d3ec0c08c7d4',
    ],
  ];
  for (const [licensePath, requiredText, normalizedUpstreamHash] of licenses) {
    const text = fs.readFileSync(resolveRepositoryPath(repoRoot, licensePath), 'utf8').replaceAll('\r\n', '\n');
    invariant(text.includes(requiredText), `Upstream copyright missing from ${licensePath}`);
    const upstreamText = text.replace(/^\s*Modifications Copyright 2026 WINK GO contributors\.\n/m, '');
    invariant(
      crypto.createHash('sha256').update(upstreamText).digest('hex') === normalizedUpstreamHash,
      `Apache license body differs from the pinned upstream in ${licensePath}`
    );
  }

  for (const legalPath of ['NOTICE', 'THIRD_PARTY_NOTICES.md']) {
    const text = fs.readFileSync(resolveRepositoryPath(repoRoot, legalPath), 'utf8');
    for (const project of PROJECTS) {
      invariant(text.includes(project.source), `${legalPath} lacks ${project.name} source`);
      invariant(text.includes(project.commit), `${legalPath} lacks ${project.name} commit`);
      invariant(text.includes(project.tag), `${legalPath} lacks ${project.name} tag`);
      invariant(text.includes(project.manifest), `${legalPath} lacks ${project.name} manifest reference`);
    }
  }

  const skillRoot = 'backend/crates/winkgo-app/assets/builtin-skills/auto-inject/skill-creator';
  const initSkill = fs.readFileSync(resolveRepositoryPath(repoRoot, `${skillRoot}/scripts/init_skill.py`), 'utf8');
  invariant(
    initSkill.includes('Modified from Anthropic skill-creator by WINK GO contributors in 2026.'),
    'skill-creator init_skill.py lacks its direct upstream modification notice'
  );
  const modifications = fs.readFileSync(resolveRepositoryPath(repoRoot, `${skillRoot}/MODIFICATIONS.md`), 'utf8');
  invariant(
    modifications.includes('`scripts/init_skill.py`: six upstream example lines were replaced'),
    'skill-creator init_skill.py changes are not documented'
  );
  invariant(
    !modifications.includes('\n- `scripts/init_skill.py`\n'),
    'skill-creator init_skill.py is still incorrectly listed as unchanged'
  );

  return {
    projects: PROJECTS.length,
    modifiedFiles: PROJECTS.reduce((total, project) => total + project.rows, 0),
    inlineNotices: PROJECTS.reduce((total, project) => total + project.inline, 0),
    manifestOnly: PROJECTS.reduce((total, project) => total + project.manifestOnly, 0),
  };
}

if (require.main === module) {
  try {
    const result = verifyRepository();
    process.stdout.write(
      `PASS: ${result.projects} upstreams, ${result.modifiedFiles} modified files, ` +
        `${result.inlineNotices} inline notices, ${result.manifestOnly} manifest-only records.\n`
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  PROJECTS,
  parseInventory,
  parseManifest,
  resolveRepositoryPath,
  verifyInventoryCoverage,
  verifyManifestRows,
  verifyRepository,
};
