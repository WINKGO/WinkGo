#!/usr/bin/env node
/**
 * Bulk-applies Apache-2.0 modification notices from the checked-in,
 * commit-pinned upstream inventories and writes deterministic provenance
 * manifests.
 *
 * This is an explicit maintainer tool, not part of normal builds:
 *   node scripts/licenses/apply-upstream-attribution.cjs
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PROJECTS = [
  {
    id: 'aionui-v2.1.41',
    name: 'AionUI',
    tag: 'v2.1.41',
    commit: '2d8925fc67a97a20996fadcd2a0862b778b572ba',
    source: 'https://github.com/iOfficeAI/AionUi',
    licenseSha256: 'a515d5a76da6c082f0d3d33a597bf82e32ecdac8841ed1783ac081ebd6d62ebf',
    currentRoot: '',
    inventory: 'docs/vendor/aionui-upstream-inventory.tsv',
    manifest: 'docs/vendor/aionui-modification-manifest.tsv',
  },
  {
    id: 'aioncore-v0.1.52',
    name: 'AionCore',
    tag: 'v0.1.52',
    commit: '76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d',
    source: 'https://github.com/iOfficeAI/AionCore',
    licenseSha256: 'a515d5a76da6c082f0d3d33a597bf82e32ecdac8841ed1783ac081ebd6d62ebf',
    currentRoot: 'backend',
    inventory: 'docs/vendor/aioncore-upstream-inventory.tsv',
    manifest: 'docs/vendor/aioncore-modification-manifest.tsv',
  },
  {
    id: 'aionrs-v0.2.7',
    name: 'aionrs',
    tag: 'v0.2.7',
    commit: '445a18e1625cc68ded3a647ee99332195fbe8508',
    source: 'https://github.com/iOfficeAI/aionrs',
    licenseSha256: '9ff7efda502098c7d8029a7f17e1b4e0e837a91d78c7add23a93d3ec0c08c7d4',
    currentRoot: 'backend/agent-runtime',
    inventory: 'docs/vendor/aionrs-upstream-inventory.tsv',
    manifest: 'docs/vendor/aionrs-modification-manifest.tsv',
  },
];

const HASH_COMMENT_EXTENSIONS = new Set([
  '.gitignore',
  '.gitattributes',
  '.prettierignore',
  '.ps1',
  '.py',
  '.sh',
  '.toml',
  '.yaml',
  '.yml',
]);
const SLASH_COMMENT_EXTENSIONS = new Set(['.cjs', '.js', '.mjs', '.rs', '.ts', '.tsx']);
const MARKDOWN_EXTENSIONS = new Set(['.md']);
const CSS_EXTENSIONS = new Set(['.css']);
const HTML_EXTENSIONS = new Set(['.html']);
const NSIS_EXTENSIONS = new Set(['.nsh']);
const HASH_COMMENT_BASENAMES = new Set([
  '.gitattributes',
  '.gitignore',
  '.prettierignore',
  'CODEOWNERS',
  'Dockerfile',
  'Makefile',
  'justfile',
]);
const MANIFEST_ONLY_EXTENSIONS = new Set([
  '.json',
  '.lock',
  '.ndjson',
  '.sql',
  '.svg',
  '.txt',
  '.webmanifest',
]);

function sha256File(filePath, type = 'binary') {
  const bytes = fs.readFileSync(filePath);
  const comparable = type === 'text' ? Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'), 'utf8') : bytes;
  return crypto.createHash('sha256').update(comparable).digest('hex');
}

function parseTsv(tsvPath) {
  const lines = fs
    .readFileSync(tsvPath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (lines.length === 0) throw new Error(`TSV has no header: ${tsvPath}`);
  const header = lines.shift().split('\t');
  return lines.map((line) => {
    const values = line.split('\t');
    return Object.fromEntries(header.map((key, index) => [key, values[index] ?? '']));
  });
}

function commentStyle(relativePath, type) {
  if (type === 'binary') return null;
  const normalized = relativePath.replaceAll('\\', '/');
  const basename = path.posix.basename(normalized);
  const extension = path.posix.extname(normalized).toLowerCase();
  if (basename === 'LICENSE' || MANIFEST_ONLY_EXTENSIONS.has(extension)) return null;
  if (HASH_COMMENT_BASENAMES.has(basename) || HASH_COMMENT_EXTENSIONS.has(extension)) return 'hash';
  if (SLASH_COMMENT_EXTENSIONS.has(extension)) return 'slash';
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (CSS_EXTENSIONS.has(extension)) return 'css';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  if (NSIS_EXTENSIONS.has(extension)) return 'nsis';
  throw new Error(`Unclassified modified text file: ${relativePath}`);
}

function markerFor(projectName, style) {
  const statement = `Modified from ${projectName} by WINK GO contributors in 2026.`;
  switch (style) {
    case 'hash':
      return `# ${statement}`;
    case 'slash':
      return `// ${statement}`;
    case 'markdown':
    case 'html':
      return `<!-- ${statement} -->`;
    case 'css':
      return `/* ${statement} */`;
    case 'nsis':
      return `; ${statement}`;
    default:
      throw new Error(`Unsupported comment style: ${style}`);
  }
}

function insertionOffset(text, relativePath, style, newline) {
  const firstLineEnd = text.indexOf('\n');
  const afterFirstLine = firstLineEnd === -1 ? text.length : firstLineEnd + 1;

  if (text.startsWith('#!')) {
    let offset = afterFirstLine;
    if (style === 'hash') {
      const secondLineEnd = text.indexOf('\n', offset);
      const secondLine = text.slice(offset, secondLineEnd === -1 ? text.length : secondLineEnd).replace(/\r$/, '');
      if (/^#.*coding[:=]\s*[-\w.]+/.test(secondLine)) {
        offset = secondLineEnd === -1 ? text.length : secondLineEnd + 1;
      }
    }
    return offset;
  }

  if (style === 'markdown' && /^---\r?\n/.test(text)) {
    const frontMatter = text.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
    if (!frontMatter) throw new Error(`Unclosed Markdown front matter: ${relativePath}`);
    return frontMatter[0].length;
  }

  if (style === 'html' && /^<!doctype\s+html\b/i.test(text)) return afterFirstLine;
  if (style === 'css' && /^@charset\s+["'][^"']+["'];/.test(text)) return afterFirstLine;
  return 0;
}

function addMarker(filePath, relativePath, projectName, style) {
  const bytes = fs.readFileSync(filePath);
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hasBom ? bytes.subarray(3) : bytes;
  const text = body.toString('utf8');
  if (Buffer.from(text, 'utf8').length !== body.length) {
    throw new Error(`Text file is not valid UTF-8: ${relativePath}`);
  }
  const statement = `Modified from ${projectName} by WINK GO contributors in 2026.`;
  if (text.includes(statement)) return false;

  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const marker = markerFor(projectName, style);
  const offset = insertionOffset(text, relativePath, style, newline);
  const prefix = text.slice(0, offset);
  const suffix = text.slice(offset);
  const separator = prefix !== '' && !prefix.endsWith(newline) ? newline : '';
  const updated = `${prefix}${separator}${marker}${newline}${suffix}`;
  const output = hasBom
    ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(updated, 'utf8')])
    : Buffer.from(updated, 'utf8');
  fs.writeFileSync(filePath, output);
  return true;
}

function manifestHeader(project) {
  return [
    `# Upstream project: ${project.name}`,
    `# Source: ${project.source}`,
    `# Tag: ${project.tag}`,
    `# Commit: ${project.commit}`,
    `# Upstream LICENSE SHA-256: ${project.licenseSha256}`,
    '# Mapping: upstream_path is the original path; current_path is repository-relative after WINK GO renaming.',
    '# disposition=inline means current_path carries the required file-level modification notice.',
    '# disposition=manifest-only means comments are unsafe for that format; current_sha256 is enforced by verification.',
    'disposition\ttype\tupstream_path\tcurrent_path\tupstream_sha256\tcurrent_sha256',
  ];
}

function main() {
  let annotated = 0;
  let manifestOnly = 0;

  for (const project of PROJECTS) {
    const inventoryPath = path.join(REPO_ROOT, ...project.inventory.split('/'));
    const rows = parseTsv(inventoryPath).sort((left, right) =>
      left.upstream_path.localeCompare(right.upstream_path, 'en')
    );
    const manifestLines = manifestHeader(project);

    for (const row of rows) {
      const inventoryCurrentPath = row.current_path.replaceAll('\\', '/');
      const repoRelativePath = path.posix.join(project.currentRoot, inventoryCurrentPath);
      const absolutePath = path.join(REPO_ROOT, ...repoRelativePath.split('/'));
      if (!fs.existsSync(absolutePath)) continue;
      if (!fs.statSync(absolutePath).isFile()) throw new Error(`Mapped path is not a file: ${repoRelativePath}`);
      if (sha256File(absolutePath, row.type) === row.upstream_sha256) continue;

      const style = commentStyle(inventoryCurrentPath, row.type);
      const disposition = style === null ? 'manifest-only' : 'inline';
      if (style === null) {
        manifestOnly += 1;
      } else {
        if (addMarker(absolutePath, repoRelativePath, project.name, style)) annotated += 1;
      }
      manifestLines.push(
        [
          disposition,
          row.type,
          row.upstream_path,
          repoRelativePath,
          row.upstream_sha256,
          sha256File(absolutePath, row.type),
        ].join('\t')
      );
    }

    const manifestPath = path.join(REPO_ROOT, ...project.manifest.split('/'));
    fs.writeFileSync(manifestPath, `${manifestLines.join('\n')}\n`, 'utf8');
  }

  process.stdout.write(
    `Applied ${annotated} new inline notices; recorded ${manifestOnly} manifest-only modified files.\n`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  PROJECTS,
  commentStyle,
  markerFor,
  insertionOffset,
  sha256File,
};
