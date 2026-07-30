import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(__dirname, '../..');
const itWithBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0 ? it : it.skip;

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

function yamlBlock(content: string, key: string): string {
  const startMatch = content.match(new RegExp(`^${key}:\\s*$`, 'm'));
  if (!startMatch || startMatch.index === undefined) return '';

  const blockStart = startMatch.index + startMatch[0].length;
  const rest = content.slice(blockStart);
  const nextTopLevelKey = rest.search(/^[a-zA-Z][a-zA-Z0-9]*:\s*$/m);
  return nextTopLevelKey === -1 ? rest : rest.slice(0, nextTopLevelKey);
}

describe('release packaging configuration', () => {
  it('fails closed to Free for direct Vite and wrapper builds', () => {
    const viteConfig = readProjectFile('packages/desktop/electron.vite.config.ts');
    const buildScript = readProjectFile('scripts/build-with-builder.js');

    expect(viteConfig).toContain("process.env.WINKGO_EDITION || 'free'");
    expect(viteConfig).toContain('WINKGO_ALLOW_PRO_DEV_BUILD');
    expect(viteConfig).toContain('isCiEnvironment');
    expect(viteConfig).toContain("rmSync(resolve(__dirname, '../../out/.winkgo-vite-build.json')");
    expect(buildScript).toContain("process.env.WINKGO_EDITION || 'free'");
    expect(buildScript).toContain('--allow-pro-dev');
  });

  it('makes every public packaging command explicitly Free and keeps Pro development-only', () => {
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      scripts: Record<string, string>;
    };
    const directViteScripts = ['package', 'make'];
    const publicWrapperScripts = [
      'dist',
      'dist:mac',
      'dist:win',
      'dist:win:free',
      'dist:linux',
      'build-mac',
      'build-win',
      'build-deb',
      'build-mac:arm64',
      'build-mac:x64',
      'build-win:arm64',
      'build-win:x64',
      'build-win:x64:free',
      'build-win:x64:fast',
      'build',
    ];

    for (const scriptName of directViteScripts) {
      expect(packageJson.scripts[scriptName], scriptName).toContain('WINKGO_EDITION=free');
    }
    for (const scriptName of publicWrapperScripts) {
      expect(packageJson.scripts[scriptName], scriptName).toContain('--edition free');
    }

    const proEntries = Object.entries(packageJson.scripts).filter(([, command]) => command.includes('--edition pro'));
    expect(proEntries.map(([name]) => name).sort()).toEqual(['build-win:x64:pro:dev', 'dist:win:pro:dev']);
    for (const [scriptName, command] of proEntries) {
      expect(scriptName).toMatch(/:pro:dev$/);
      expect(command).toContain('--allow-pro-dev');
    }

    expect(packageJson.scripts['release:website:prepare']).toContain('WINKGO_EDITION=free');
  });

  it('pins CI, PR, and manual release builds to Free', () => {
    const workflowPaths = [
      '.github/workflows/build-and-release.yml',
      '.github/workflows/build-manual.yml',
      '.github/workflows/pr-checks.yml',
    ];

    for (const workflowPath of workflowPaths) {
      const buildLines = readProjectFile(workflowPath)
        .split(/\r?\n/)
        .filter((line) => line.includes('scripts/build-with-builder.js'));
      expect(buildLines.length, workflowPath).toBeGreaterThan(0);
      for (const line of buildLines) {
        expect(line, `${workflowPath}: ${line.trim()}`).toContain('--edition free');
      }
    }

    expect(readProjectFile('.github/workflows/pack-web-cli.yml')).toMatch(
      /WINKGO_EDITION:\s*free[\s\S]*electron-vite build/
    );
  });

  it('does not expose a publishable Pro update feed', () => {
    const proConfig = readProjectFile('packages/desktop/electron-builder.pro.yml');

    expect(proConfig).toContain('publishAutoUpdate: false');
  });

  it('rejects Pro artifacts before the public release upload step', () => {
    const workflow = readProjectFile('.github/workflows/build-and-release.yml');
    const preparationScript = readProjectFile('scripts/prepare-release-assets.sh');
    const rejectionIndex = workflow.indexOf('Reject Pro release artifacts');
    const uploadIndex = workflow.indexOf('softprops/action-gh-release@v2');

    expect(rejectionIndex).toBeGreaterThan(-1);
    expect(rejectionIndex).toBeLessThan(uploadIndex);
    expect(workflow).toContain("find release-assets -type f -iname 'WINK-GO-Pro-*'");
    expect(preparationScript).toContain('find "$ARTIFACTS_DIR" -type f -iname \'WINK-GO-Pro-*\'');
  });

  it('keeps mac zip artifacts enabled', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const macBlock = yamlBlock(config, 'mac');

    expect(macBlock).toContain('    - dmg');
    expect(macBlock).toContain('    - zip');
  });

  it('does not build Windows zip artifacts', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const winBlock = yamlBlock(config, 'win');

    expect(winBlock).toContain('    - nsis');
    expect(winBlock).not.toContain('    - zip');
  });

  it('uploads mac zip artifacts without a stale Windows zip glob', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');

    expect(workflow).toContain('out/WINK-GO-Free-*-mac-*.zip');
    expect(workflow).not.toContain('out/WinkGo-*-mac-*.zip');
  });

  it('distributes updater metadata to the Free feed embedded in packaged apps', () => {
    const freeConfig = readProjectFile('packages/desktop/electron-builder.free.yml');
    const distributionWorkflow = readProjectFile('.github/workflows/release-distribute.yml');

    expect(freeConfig).toContain('url: https://winkgo.top/releases/free');
    expect(distributionWorkflow).toContain('S3_RELEASE_PREFIX: releases/free');
    expect(distributionWorkflow).toContain('WINK-GO-Free-*');
    expect(distributionWorkflow).toContain('Refusing to publish non-Free desktop asset');
    expect(distributionWorkflow).toContain('Refusing metadata with a non-Free asset reference');
  });

  it('retries mac prepackaged builds with both dmg and zip targets', () => {
    const script = readProjectFile('scripts/build-with-builder.js');

    expect(script).toMatch(/--mac\s+dmg\s+zip\s+--\$\{targetArch\}\s+--prepackaged/);
  });

  itWithBash('fails release asset preparation when a mac zip is missing', { timeout: 30000 }, () => {
    // Keep shell arguments relative on Windows. Git Bash mangles native
    // absolute paths such as C:\... when they are passed as ordinary argv.
    const tempDir = mkdtempSync(resolve(projectRoot, '.tmp-winkgo-release-assets-'));
    const tempName = basename(tempDir);
    const artifactsDir = resolve(tempDir, 'build-artifacts');
    const outputDir = resolve(tempDir, 'release-assets');
    const artifactsArg = `${tempName}/build-artifacts`;
    const outputArg = `${tempName}/release-assets`;

    try {
      const env = { ...process.env, MOCK_VERSION: '1.0.0' };
      const createResult = spawnSync('bash', ['scripts/create-mock-release-artifacts.sh', artifactsArg], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });
      expect(createResult.status).toBe(0);

      const missingZip = resolve(artifactsDir, 'macos-build-arm64', 'WINK-GO-Free-1.0.0-mac-arm64.zip');
      renameSync(missingZip, `${missingZip}.missing`);

      const prepareResult = spawnSync('bash', ['scripts/prepare-release-assets.sh', artifactsArg, outputArg, '1.0.0'], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });

      expect(prepareResult.status).not.toBe(0);
      expect(`${prepareResult.stdout}\n${prepareResult.stderr}`).toContain('Missing macOS zip artifact');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  itWithBash('fails release asset preparation when any Pro artifact is present', () => {
    const tempDir = mkdtempSync(resolve(projectRoot, '.tmp-winkgo-pro-release-assets-'));
    const tempName = basename(tempDir);
    const artifactsDir = resolve(tempDir, 'build-artifacts');
    const outputDir = resolve(tempDir, 'release-assets');
    const artifactsArg = `${tempName}/build-artifacts`;
    const outputArg = `${tempName}/release-assets`;

    try {
      const env = { ...process.env, MOCK_VERSION: '1.0.0' };
      const createResult = spawnSync('bash', ['scripts/create-mock-release-artifacts.sh', artifactsArg], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });
      expect(createResult.status).toBe(0);

      const proArtifact = resolve(artifactsDir, 'windows-build-x64', 'WINK-GO-Pro-Setup-1.0.0-x64.exe');
      writeFileSync(proArtifact, '');
      const prepareResult = spawnSync('bash', ['scripts/prepare-release-assets.sh', artifactsArg, outputArg, '1.0.0'], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });

      expect(prepareResult.status).not.toBe(0);
      expect(`${prepareResult.stdout}\n${prepareResult.stderr}`).toContain('Pro release artifact is forbidden');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
