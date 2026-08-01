import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

const {
  getActionsArtifactName,
  getActionsArtifactMissingMessage,
  prepareWinkGoCore,
} = require('../../../packages/shared-scripts/src/prepare-winkgo-core');

const posixFakeToolchainIt = process.platform === 'win32' ? it.skip : it;

function writeFile(filePath: string, contents = 'x') {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeExecutable(filePath: string, contents: string) {
  writeFile(filePath, contents);
  chmodSync(filePath, 0o755);
}

function createFakeToolchain(root: string, { curlFails = false } = {}) {
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });

  writeExecutable(
    join(binDir, 'curl'),
    curlFails
      ? '#!/usr/bin/env bash\nexit 1\n'
      : `#!/usr/bin/env bash
set -euo pipefail
out=''
while [[ $# -gt 0 ]]; do
  if [[ "$1" == '-o' ]]; then
    shift
    out="$1"
  fi
  shift || true
done
if [[ -z "$out" ]]; then
  printf '{}'
  exit 0
fi
mkdir -p "$(dirname "$out")"
printf 'archive' > "$out"
`
  );
  writeExecutable(join(binDir, 'wget'), '#!/usr/bin/env bash\nexit 1\n');
  writeExecutable(
    join(binDir, 'gh'),
    `#!/usr/bin/env bash
cat <<'JSON'
{"artifacts":[{"id":123,"name":"winkgo_core-manual-linux-x64","archive_download_url":"https://example.invalid/artifact.zip"}]}
JSON
`
  );
  writeExecutable(
    join(binDir, 'unzip'),
    `#!/usr/bin/env bash
set -euo pipefail
out=''
while [[ $# -gt 0 ]]; do
  if [[ "$1" == '-d' ]]; then
    shift
    out="$1"
  fi
  shift || true
done
mkdir -p "$out"
printf 'archive' > "$out/winkgo_core-v0.1.46-x86_64-unknown-linux-gnu.tar.gz"
`
  );
  writeExecutable(
    join(binDir, 'tar'),
    `#!/usr/bin/env bash
set -euo pipefail
out=''
while [[ $# -gt 0 ]]; do
  if [[ "$1" == '-C' ]]; then
    shift
    out="$1"
  fi
  shift || true
done
mkdir -p "$out"
cat > "$out/winkgo_core" <<'SH'
#!/usr/bin/env bash
# pdf/SKILL.md
# name: pdf
# pdf/SOURCE.md
# pdf-toolkit/SKILL.md
# name: pdf-toolkit
# This original skill is distributed under the Apache License 2.0.
exit 0
SH
chmod +x "$out/winkgo_core"
`
  );

  return binDir;
}

afterEach(() => {
  delete process.env.WINKGO_BACKEND_RUN_ID;
  delete process.env.WINKGO_BACKEND_LOCAL_BINARY;
  rmSync(join(tmpdir(), 'winkgo_core-prepare', 'v0.1.46'), { recursive: true, force: true });
  rmSync(join(tmpdir(), 'winkgo_core-prepare-actions', '123'), { recursive: true, force: true });
});

describe('prepare-winkgo-core GitHub Actions artifact resolver', () => {
  it.each([
    ['win32', 'x64', 'winkgo_core-manual-windows-x64'],
    ['win32', 'arm64', 'winkgo_core-manual-windows-arm64'],
    ['darwin', 'x64', 'winkgo_core-manual-macos-x64'],
    ['darwin', 'arm64', 'winkgo_core-manual-macos-arm64'],
    ['linux', 'x64', 'winkgo_core-manual-linux-x64'],
    ['linux', 'arm64', 'winkgo_core-manual-linux-arm64'],
  ])('maps %s-%s to %s', (platform, arch, artifactName) => {
    expect(getActionsArtifactName(platform, arch)).toBe(artifactName);
  });

  it('explains which WinkGoCore manual artifact is missing for the requested platform', () => {
    expect(
      getActionsArtifactMissingMessage({
        runId: '27319522909',
        platform: 'win32',
        arch: 'x64',
        expectedArtifactName: 'winkgo_core-manual-windows-x64',
        availableArtifactNames: ['winkgo_core-manual-macos-arm64', 'winkgo_core-manual-linux-x64'],
      })
    ).toBe(
      [
        'WinkGoCore run 27319522909 does not contain artifact [ winkgo_core-manual-windows-x64 ] required for [ win32-x64 ].',
        'Available artifacts: winkgo_core-manual-macos-arm64, winkgo_core-manual-linux-x64.',
        'Re-run WinkGoCore Manual Build with platform [ windows-x64 ] or all.',
      ].join(' ')
    );
  });

  // These cases execute a temporary POSIX shell-script winkgo_core binary. Windows
  // coverage for contract rejection lives in the verifier/local-bundle tests.
  posixFakeToolchainIt('hard fails Actions artifact input when prepared managed resources lack contract', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'winkgo-actions-gate-'));
    const fakeBin = createFakeToolchain(tmp);
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${delimiter}${previousPath || ''}`;
    process.env.WINKGO_BACKEND_RUN_ID = '123';

    try {
      expect(() =>
        prepareWinkGoCore({
          projectRoot: join(tmp, 'project'),
          platform: 'linux',
          arch: 'x64',
          version: 'v0.1.46',
        })
      ).toThrow(/managed-resources\/manifest\.json/);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  posixFakeToolchainIt('hard fails GitHub release download input when prepared managed resources lack contract', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'winkgo-download-gate-'));
    const fakeBin = createFakeToolchain(tmp);
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${delimiter}${previousPath || ''}`;

    try {
      expect(() =>
        prepareWinkGoCore({
          projectRoot: join(tmp, 'project'),
          platform: 'linux',
          arch: 'x64',
          version: 'v0.1.46',
        })
      ).toThrow(/managed-resources\/manifest\.json/);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  posixFakeToolchainIt('hard fails local binary fallback when prepared managed resources lack contract', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'winkgo-local-binary-gate-'));
    const localBinary = join(tmp, 'winkgo_core');
    writeExecutable(
      localBinary,
      [
        '#!/usr/bin/env bash',
        '# pdf/SKILL.md',
        '# name: pdf',
        '# pdf/SOURCE.md',
        '# pdf-toolkit/SKILL.md',
        '# name: pdf-toolkit',
        '# This original skill is distributed under the Apache License 2.0.',
        'exit 0',
        '',
      ].join('\n')
    );
    const fakeBin = createFakeToolchain(tmp, { curlFails: true });
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${delimiter}${previousPath || ''}`;
    process.env.WINKGO_BACKEND_LOCAL_BINARY = localBinary;

    try {
      expect(() =>
        prepareWinkGoCore({
          projectRoot: join(tmp, 'project'),
          platform: 'linux',
          arch: 'x64',
          version: 'v0.1.46',
        })
      ).toThrow(/managed-resources\/manifest\.json/);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
