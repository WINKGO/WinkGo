#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_FILE_RE = /^(\d{3})_[a-z0-9_]+\.sql$/;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

function parseSemver(value, label) {
  const match = typeof value === 'string' ? SEMVER_RE.exec(value) : null;
  if (!match) throw new Error(`${label} is not a valid semantic version: ${String(value)}`);
  return match.slice(1, 4).map(Number);
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function normalizedSha384(filePath) {
  const source = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return crypto.createHash('sha384').update(source, 'utf8').digest('hex');
}

function readMigrationLock(migrationDir) {
  const lockPath = path.join(migrationDir, 'migration-lock.json');
  if (!fs.existsSync(lockPath)) {
    throw new Error(`Database migration lock is missing: ${lockPath}`);
  }

  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    throw new Error(`Database migration lock is invalid JSON: ${lockPath}: ${error.message}`);
  }

  if (
    lock?.schemaVersion !== 1 ||
    typeof lock.minimumAppVersion !== 'string' ||
    !Array.isArray(lock.migrations) ||
    lock.migrations.length === 0
  ) {
    throw new Error(`Database migration lock has an unsupported schema: ${lockPath}`);
  }
  return lock;
}

function verifyDatabaseMigrations(repoRoot = path.resolve(__dirname, '..')) {
  const migrationDir = path.join(repoRoot, 'backend', 'crates', 'winkgo-db', 'migrations');
  if (!fs.existsSync(migrationDir)) {
    throw new Error(`Database migration directory is missing: ${migrationDir}`);
  }

  const lock = readMigrationLock(migrationDir);
  const packagePath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packagePath)) {
    throw new Error(`Application package metadata is missing: ${packagePath}`);
  }
  const packageMetadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const appVersion = parseSemver(packageMetadata.version, 'package.json version');
  const minimumAppVersion = parseSemver(lock.minimumAppVersion, 'migration minimumAppVersion');
  if (compareSemver(appVersion, minimumAppVersion) < 0) {
    throw new Error(
      `Application version ${packageMetadata.version} is older than database migration release floor ${lock.minimumAppVersion}`
    );
  }
  const diskFiles = fs
    .readdirSync(migrationDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MIGRATION_FILE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const diskFileSet = new Set(diskFiles);
  const lockedFileSet = new Set();
  const versions = [];
  const seenVersions = new Set();

  for (const entry of lock.migrations) {
    const version = Number(entry?.version);
    const file = typeof entry?.file === 'string' ? entry.file : '';
    const expectedChecksum = typeof entry?.sha384 === 'string' ? entry.sha384.toLowerCase() : '';
    const match = MIGRATION_FILE_RE.exec(file);

    if (!Number.isSafeInteger(version) || !match || Number(match[1]) !== version) {
      throw new Error(`Database migration lock entry is invalid: ${JSON.stringify(entry)}`);
    }
    if (!/^[a-f0-9]{96}$/.test(expectedChecksum)) {
      throw new Error(`Database migration ${file} has an invalid locked checksum`);
    }
    if (seenVersions.has(version)) {
      throw new Error(`Database migration version ${version} is duplicated in migration-lock.json`);
    }
    if (lockedFileSet.has(file)) {
      throw new Error(`Database migration file ${file} is duplicated in migration-lock.json`);
    }

    seenVersions.add(version);
    lockedFileSet.add(file);
    versions.push(version);

    const migrationPath = path.join(migrationDir, file);
    if (!diskFileSet.has(file) || !fs.existsSync(migrationPath)) {
      throw new Error(`Database migration ${file} is missing; refusing to build an update that strands existing users`);
    }
    const actualChecksum = normalizedSha384(migrationPath);
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Database migration ${file} checksum changed; shipped migrations are immutable (expected ${expectedChecksum}, got ${actualChecksum})`
      );
    }
  }

  const unlockedFiles = diskFiles.filter((file) => !lockedFileSet.has(file));
  if (unlockedFiles.length > 0) {
    throw new Error(
      `Database migration lock does not include ${unlockedFiles.join(', ')}; update migration-lock.json before building`
    );
  }

  const sortedVersions = [...versions].sort((left, right) => left - right);
  if (!versions.every((version, index) => version === sortedVersions[index])) {
    throw new Error('Database migrations in migration-lock.json must be sorted by version');
  }

  return {
    count: versions.length,
    versions,
    latestVersion: versions.at(-1),
    minimumAppVersion: lock.minimumAppVersion,
  };
}

if (require.main === module) {
  try {
    const result = verifyDatabaseMigrations();
    console.log(
      `Database migration audit passed: ${result.count} locked migrations, latest version ${result.latestVersion}`
    );
  } catch (error) {
    console.error(`Database migration audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  normalizedSha384,
  verifyDatabaseMigrations,
};
