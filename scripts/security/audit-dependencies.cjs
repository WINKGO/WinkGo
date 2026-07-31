const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const EXPECTED_BRACE_EXPANSION_VERSIONS = Object.freeze(['1.1.18', '2.1.4', '5.0.9']);
const BRACE_EXPANSION_ADVISORY = 'GHSA-mh99-v99m-4gvg';

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

  console.log(`Validated brace-expansion lockfile versions: ${versions.join(', ')}`);
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
  extractBraceExpansionVersions,
  validateBraceExpansionVersions,
};
