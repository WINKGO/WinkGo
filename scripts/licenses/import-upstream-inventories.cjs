#!/usr/bin/env node
/**
 * Imports the path mapping produced by the one-time derivative-work audit and
 * replaces checkout-dependent hashes with hashes of the exact pinned Git
 * blobs. The checked-in inventories then let offline CI detect newly modified
 * upstream files that were previously byte-identical.
 *
 * Usage:
 *   node scripts/licenses/import-upstream-inventories.cjs \
 *     --evidence-dir <dir> \
 *     --aionui-repo <dir> \
 *     --aioncore-repo <dir> \
 *     --aionrs-repo <dir>
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PROJECTS } = require('./apply-upstream-attribution.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INVENTORY_COLUMNS = ['type', 'upstream_path', 'current_path', 'upstream_sha256'];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function option(args, name) {
  const index = args.indexOf(name);
  invariant(index !== -1 && args[index + 1], `Missing required option: ${name}`);
  return path.resolve(args[index + 1]);
}

function parseTsv(tsvPath) {
  const lines = fs
    .readFileSync(tsvPath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean);
  const header = lines.shift().split('\t');
  return lines.map((line) => {
    const values = line.split('\t');
    return Object.fromEntries(header.map((key, index) => [key, values[index] ?? '']));
  });
}

function git(repo, args, encoding = null) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
}

function sha256(bytes, type = 'binary') {
  const comparable = type === 'text' ? Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'), 'utf8') : bytes;
  return crypto.createHash('sha256').update(comparable).digest('hex');
}

function gitBlobs(repo, commit, paths) {
  const specs = paths.map((upstreamPath) => `${commit}:${upstreamPath}`);
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd: repo,
    input: `${specs.join('\n')}\n`,
    maxBuffer: 512 * 1024 * 1024,
    windowsHide: true,
  });
  const blobs = [];
  let offset = 0;

  for (const spec of specs) {
    const headerEnd = output.indexOf(0x0a, offset);
    invariant(headerEnd !== -1, `Missing git cat-file header for ${spec}`);
    const header = output.subarray(offset, headerEnd).toString('utf8');
    invariant(!header.endsWith(' missing'), `Pinned Git blob is missing: ${spec}`);
    const match = header.match(/^[a-f0-9]+ blob ([0-9]+)$/);
    invariant(match, `Unexpected git cat-file header for ${spec}: ${header}`);
    const size = Number(match[1]);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    invariant(contentEnd < output.length && output[contentEnd] === 0x0a, `Truncated Git blob: ${spec}`);
    blobs.push(output.subarray(contentStart, contentEnd));
    offset = contentEnd + 1;
  }
  invariant(offset === output.length, 'Unexpected trailing data from git cat-file --batch');
  return blobs;
}

function inventoryHeader(project) {
  return [
    `# Canonical upstream inventory for ${project.name}.`,
    `# Source: ${project.source}`,
    `# Tag: ${project.tag}`,
    `# Commit: ${project.commit}`,
    `# Upstream LICENSE SHA-256: ${project.licenseSha256}`,
    '# SHA-256 values are calculated from pinned Git blobs, not a platform checkout.',
    '# current_path records the audited rename mapping relative to this upstream root.',
    INVENTORY_COLUMNS.join('\t'),
  ];
}

function main() {
  const args = process.argv.slice(2);
  const evidenceDir = option(args, '--evidence-dir');
  const repoById = new Map([
    ['aionui-v2.1.41', option(args, '--aionui-repo')],
    ['aioncore-v0.1.52', option(args, '--aioncore-repo')],
    ['aionrs-v0.2.7', option(args, '--aionrs-repo')],
  ]);

  for (const project of PROJECTS) {
    const upstreamRepo = repoById.get(project.id);
    invariant(fs.statSync(upstreamRepo).isDirectory(), `Not a directory: ${upstreamRepo}`);
    const head = git(upstreamRepo, ['rev-parse', 'HEAD'], 'utf8').trim();
    invariant(head === project.commit, `${project.name} checkout is at ${head}, expected ${project.commit}`);

    const evidencePath = path.join(evidenceDir, `${project.id}-files.tsv`);
    const evidence = parseTsv(evidencePath)
      .filter((row) => row.upstream_path !== '')
      .sort((left, right) => left.upstream_path.localeCompare(right.upstream_path, 'en'));
    const blobs = gitBlobs(
      upstreamRepo,
      project.commit,
      evidence.map((row) => row.upstream_path)
    );
    const seenUpstream = new Set();
    const seenCurrent = new Set();
    const output = inventoryHeader(project);

    for (const [index, row] of evidence.entries()) {
      invariant(row.type === 'text' || row.type === 'binary', `Invalid type for ${row.upstream_path}`);
      invariant(!seenUpstream.has(row.upstream_path), `Duplicate upstream path: ${row.upstream_path}`);
      invariant(!seenCurrent.has(row.current_path), `Duplicate current path: ${row.current_path}`);
      seenUpstream.add(row.upstream_path);
      seenCurrent.add(row.current_path);

      output.push([row.type, row.upstream_path, row.current_path, sha256(blobs[index], row.type)].join('\t'));
    }

    const licenseRow = evidence.findIndex((row) => row.upstream_path === 'LICENSE');
    invariant(licenseRow !== -1, `${project.name} inventory has no LICENSE`);
    const licenseHash = sha256(blobs[licenseRow], 'text');
    invariant(
      licenseHash === project.licenseSha256,
      `${project.name} canonical LICENSE hash is ${licenseHash}, expected ${project.licenseSha256}`
    );

    const destination = path.join(REPO_ROOT, ...project.inventory.split('/'));
    fs.writeFileSync(destination, `${output.join('\n')}\n`, 'utf8');
    process.stdout.write(`Wrote ${project.inventory}: ${evidence.length} pinned upstream files.\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
