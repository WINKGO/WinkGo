#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

const { createHash } = require('node:crypto');
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} = require('node:fs');
const path = require('node:path');

const EXECUTABLE_NAME = 'SparkBot-MCP-Hub-v1.1.0.exe';
const INTEGRITY_FILE = 'winkgo-runtime-integrity.json';

const normalizeManifestPath = (value) => {
  const normalized = String(value || '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '');
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe Runtime integrity path: ${value}`);
  }
  return normalized;
};

const sha256File = (filePath) => createHash('sha256').update(readFileSync(filePath)).digest('hex');

const replaceDirectory = (directoryPath) => {
  rmSync(directoryPath, { recursive: true, force: true });
  if (existsSync(directoryPath)) {
    // Some Windows filesystem filters report a successful recursive removal
    // while keeping the old tree visible. An atomic rename detaches that stale
    // payload so the customer staging path can still be rebuilt from scratch.
    const quarantinePath = `${directoryPath}.stale-${process.pid}-${Date.now()}`;
    renameSync(directoryPath, quarantinePath);
    try {
      rmSync(quarantinePath, { recursive: true, force: true });
    } catch {
      // The quarantined path is outside the packaged source and cannot leak
      // into the installer. A later workspace cleanup may remove it.
    }
  }
  mkdirSync(directoryPath, { recursive: true });
};

const listRelativeFiles = (root, directory = root, result = []) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      listRelativeFiles(root, absolutePath, result);
      continue;
    }
    if (!entry.isFile()) continue;
    result.push(path.relative(root, absolutePath).replaceAll('\\', '/'));
  }
  return result;
};

const readAndValidateIntegrity = (sourceRoot, options = {}) => {
  const integrityPath = path.join(sourceRoot, INTEGRITY_FILE);
  if (!existsSync(integrityPath)) throw new Error(`Runtime integrity manifest is missing: ${integrityPath}`);
  const manifest = JSON.parse(readFileSync(integrityPath, 'utf8'));
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Runtime integrity manifest does not contain any files.');
  }
  const files = manifest.files.map((entry) => {
    const relativePath = normalizeManifestPath(entry?.path);
    const sourcePath = path.join(sourceRoot, ...relativePath.split('/'));
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      throw new Error(`Runtime package file is missing: ${relativePath}`);
    }
    const size = statSync(sourcePath).size;
    if (size !== Number(entry?.size)) {
      throw new Error(`Runtime package size mismatch: ${relativePath}`);
    }
    const actualHash = sha256File(sourcePath);
    if (!entry?.sha256 || actualHash.toLowerCase() !== String(entry.sha256).toLowerCase()) {
      throw new Error(`Runtime package hash mismatch: ${relativePath}`);
    }
    return { relativePath, sourcePath, size };
  });
  if (!files.some(({ relativePath }) => relativePath === EXECUTABLE_NAME)) {
    throw new Error(`Runtime integrity manifest does not include ${EXECUTABLE_NAME}.`);
  }
  if (options.rejectUnexpected !== false) {
    const sealedPaths = new Set(files.map(({ relativePath }) => relativePath));
    sealedPaths.add(INTEGRITY_FILE);
    const unexpectedFiles = listRelativeFiles(sourceRoot).filter((relativePath) => !sealedPaths.has(relativePath));
    if (unexpectedFiles.length > 0) {
      throw new Error(`Runtime package contains unsealed file(s): ${unexpectedFiles.sort().join(', ')}`);
    }
  }
  return { integrityPath, files };
};

const prepareWinkGoRuntimePackage = ({ sourceRoot, destinationRoot }) => {
  const resolvedSource = path.resolve(sourceRoot);
  const resolvedDestination = path.resolve(destinationRoot);
  // A trusted build source may contain local logs or other build-only files.
  // Only sealed files are copied into the customer staging tree.
  const { integrityPath, files } = readAndValidateIntegrity(resolvedSource, { rejectUnexpected: false });

  if (resolvedSource !== resolvedDestination) {
    replaceDirectory(resolvedDestination);
    for (const { relativePath, sourcePath } of files) {
      const destinationPath = path.join(resolvedDestination, ...relativePath.split('/'));
      mkdirSync(path.dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
    }
    copyFileSync(integrityPath, path.join(resolvedDestination, INTEGRITY_FILE));
  }

  // Validate the exact staging tree, not only its source, so a partial copy can
  // never reach electron-builder.
  readAndValidateIntegrity(resolvedDestination);
  return {
    sourceRoot: resolvedSource,
    destinationRoot: resolvedDestination,
    copiedFiles: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  };
};

const resolveSourceRoot = (projectRoot, explicitRoot) => {
  const candidates = [];
  if (explicitRoot?.trim()) {
    const resolved = path.resolve(explicitRoot.trim());
    candidates.push(resolved, path.join(resolved, 'SparkBot-MCP-Hub-v1.1.0-release'));
  }
  candidates.push(path.join(projectRoot, 'resources', 'winkgo-runtime'));
  return candidates.find((candidate) => existsSync(path.join(candidate, INTEGRITY_FILE))) || '';
};

const main = () => {
  const projectRoot = path.resolve(__dirname, '..');
  const destinationRoot = path.join(projectRoot, 'resources', 'winkgo-runtime');
  const sourceRoot = resolveSourceRoot(projectRoot, process.env.WINKGO_BUNDLED_RUNTIME_DIR || '');
  if (!sourceRoot) {
    throw new Error(
      'WINK GO Runtime source is unavailable. Set WINKGO_BUNDLED_RUNTIME_DIR to the trusted bundled-runtime directory before packaging.'
    );
  }
  const result = prepareWinkGoRuntimePackage({ sourceRoot, destinationRoot });
  console.log(
    `Prepared WINK GO Runtime: ${result.copiedFiles} files, ${(result.totalBytes / 1024 / 1024).toFixed(1)} MiB.`
  );
};

module.exports = { prepareWinkGoRuntimePackage, readAndValidateIntegrity, resolveSourceRoot };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Failed to prepare WINK GO Runtime: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
