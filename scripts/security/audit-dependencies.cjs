const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const EXPECTED_BRACE_EXPANSION_VERSIONS = Object.freeze(['1.1.18', '2.1.4', '5.0.9']);
const BRACE_EXPANSION_ADVISORY = 'GHSA-mh99-v99m-4gvg';
const EXPECTED_SECURITY_PATCHES = Object.freeze({
  '@xmldom/xmldom': '0.9.12',
  'fast-uri': '3.1.7',
  qs: '6.16.0',
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractResolvedPackageVersion(lockfileContents, packageName) {
  const escapedName = escapeRegExp(packageName);
  const packageRecord = new RegExp(`"${escapedName}"\\s*:\\s*\\[\\s*"${escapedName}@([^"]+)"`);
  return lockfileContents.match(packageRecord)?.[1] || '';
}

function validateSecurityPatchVersions(lockfileContents) {
  const resolved = {};
  for (const [packageName, expectedVersion] of Object.entries(EXPECTED_SECURITY_PATCHES)) {
    const actualVersion = extractResolvedPackageVersion(lockfileContents, packageName);
    if (actualVersion !== expectedVersion) {
      throw new Error(
        `Unexpected ${packageName} version in bun.lock. Expected ${expectedVersion}; found ${actualVersion || 'missing'}.`
      );
    }
    resolved[packageName] = actualVersion;
  }
  return resolved;
}

function extractBraceExpansionVersions(lockfileContents) {
  const versions = [];
  const packageRecord = /"(?:[^"\r\n]*\/)?brace-expansion"\s*:\s*\[\s*"brace-expansion@([^"]+)"/g;

  for (const match of lockfileContents.matchAll(packageRecord)) {
    versions.push(match[1]);
  }

  return [...new Set(versions)].sort();
}

function validateBraceExpansionVersions(lockfileContents) {
  const actual = extractBraceExpansionVersions(lockfileContents);
  const expected = [...EXPECTED_BRACE_EXPANSION_VERSIONS].sort();

  if (actual.length === 0) {
    throw new Error('bun.lock contains no resolved brace-expansion package records.');
  }

  if (actual.length !== expected.length || actual.some((version, index) => version !== expected[index])) {
    throw new Error(
      `Unexpected brace-expansion versions in bun.lock. Expected ${expected.join(', ')}; found ${actual.join(', ')}.`
    );
  }

  return actual;
}

function main() {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  const lockfilePath = path.join(repositoryRoot, 'bun.lock');
  const lockfileContents = readFileSync(lockfilePath, 'utf8');
  const versions = validateBraceExpansionVersions(lockfileContents);
  const securityPatches = validateSecurityPatchVersions(lockfileContents);

  console.log(`Validated brace-expansion lockfile versions: ${versions.join(', ')}`);
  console.log(
    `Validated security patch versions: ${Object.entries(securityPatches)
      .map(([name, version]) => `${name}@${version}`)
      .join(', ')}.`
  );
  console.log(`Running production audit with targeted exception ${BRACE_EXPANSION_ADVISORY}.`);

  const packageManagerExecutable = process.env.npm_execpath;
  const packageManagerName = packageManagerExecutable ? path.basename(packageManagerExecutable).toLowerCase() : '';
  const bunExecutable = /^bun(?:\.exe)?$/.test(packageManagerName) ? packageManagerExecutable : 'bun';
  const result = spawnSync(bunExecutable, ['audit', '--production', `--ignore=${BRACE_EXPANSION_ADVISORY}`], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32' && bunExecutable === 'bun',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Dependency security audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_BRACE_EXPANSION_VERSIONS,
  EXPECTED_SECURITY_PATCHES,
  extractBraceExpansionVersions,
  extractResolvedPackageVersion,
  validateBraceExpansionVersions,
  validateSecurityPatchVersions,
};
