// Modified from AionUI by WINK GO contributors in 2026.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(viteConfig).toContain("const editionMarker = resolve(projectRoot, 'out/.winkgo-vite-build.json')");
    expect(viteConfig).toContain('unlinkSync(editionMarker)');
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
    expect(proEntries.map(([name]) => name).toSorted()).toEqual(['build-win:x64:pro:dev', 'dist:win:pro:dev']);
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

  it('smoke-installs the Windows PR build into a deterministic temporary directory', () => {
    const workflow = readProjectFile('.github/workflows/pr-checks.yml');

    expect(workflow).toContain('$installDir = Join-Path $env:RUNNER_TEMP "winkgo-smoke-install"');
    expect(workflow).toContain('-ArgumentList @(\'/S\', "/D=$installDir") -Wait -NoNewWindow -PassThru');
    expect(workflow).toContain('if ($installProcess.ExitCode -ne 0)');
    expect(workflow).toContain("$installedExe = Join-Path $installDir 'WINK-GO.exe'");
    expect(workflow).not.toContain('$env:LOCALAPPDATA\\\\Programs\\\\WINK GO\\\\WINK-GO.exe');
  });

  it('runs main push quality checks and restricts releases to stable v tags', () => {
    const workflow = readProjectFile('.github/workflows/build-and-release.yml');
    const releaseStart = workflow.indexOf('\n  release:');
    const releaseJob = workflow.slice(releaseStart);

    expect(workflow).toContain('branches: [main, dev]');
    expect(workflow).toContain("- 'v*'");
    expect(workflow).not.toContain("- '*'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(releaseStart).toBeGreaterThan(-1);
    expect(releaseJob).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(releaseJob).toContain("!contains(github.ref, '-dev-')");
    expect(releaseJob).not.toContain("needs.create-tag.result == 'success'");
  });

  it('audits tracked source and verifies tag, version, and source commit provenance', () => {
    const workflow = readProjectFile('.github/workflows/build-and-release.yml');

    expect(workflow).toContain('node scripts/audit-release-privacy.cjs --source');
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('EXPECTED_TAG="v${VERSION}"');
    expect(workflow).toContain('TAG_COMMIT="$(git rev-parse "${GITHUB_REF_NAME}^{commit}")"');
    expect(workflow).toContain('if [ "$SOURCE_COMMIT" != "$TAG_COMMIT" ]');
  });

  it('uses the supported Intel macOS runner for x64 builds', () => {
    for (const workflowPath of ['.github/workflows/build-and-release.yml', '.github/workflows/build-manual.yml']) {
      const workflow = readProjectFile(workflowPath);
      expect(workflow, workflowPath).toMatch(/"platform":"macos-x64","os":"macos-15-intel"/);
      expect(workflow, workflowPath).not.toMatch(/"platform":"macos-x64","os":"macos-14"/);
    }
  });

  it('passes the retired-runtime audit for tracked production source', () => {
    const result = spawnSync(process.execPath, ['scripts/audit-release-privacy.cjs', '--source'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).toContain('privacy audit (source) passed');
  }, 600_000);

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

  it('keeps the Windows OLE native addon out of signed macOS application resources', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const winBlock = yamlBlock(config, 'win');
    const macBlock = yamlBlock(config, 'mac');
    const sharedResources = config.slice(0, config.indexOf('\nwin:'));

    expect(winBlock).toContain('packages/desktop/native/winkgo_native_drop.node');
    expect(winBlock).toContain('packages/desktop/native/winkgo-native-drop/vendor/wry-0.55.1');
    expect(sharedResources).not.toContain('packages/desktop/native/winkgo_native_drop.node');
    expect(macBlock).not.toContain('winkgo_native_drop.node');
  });

  it('ships every standalone builtin MCP entry point outside app.asar', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const afterPack = readProjectFile('scripts/afterPack.js');

    for (const fileName of ['builtin-mcp-image-gen.js', 'builtin-mcp-browser.js', 'builtin-mcp-browser-skills.js']) {
      expect(config).toContain(`- 'out/main/${fileName}'`);
      expect(afterPack).toContain(fileName);
    }
    expect(afterPack).toContain('Packaged app is missing required builtin MCP script(s)');
  });

  it('ships the original Knowledge Canvas and WINK GO skill inventories', () => {
    const builderConfig = readProjectFile('packages/desktop/electron-builder.yml');
    const viteConfig = readProjectFile('packages/desktop/electron.vite.config.ts');

    expect(builderConfig).toContain('- public/**/*');
    expect(builderConfig).not.toContain("'!public/knowledge-canvas/**'");
    expect(builderConfig).not.toContain("'!knowledge-canvas/**'");
    expect(builderConfig).not.toContain("'!provider-skills/**'");
    expect(builderConfig).not.toContain("'!skills/**'");
    expect(viteConfig).not.toContain('winkgo-reject-unreviewed-knowledge-canvas');
    expect(readProjectFile('public/knowledge-canvas/index.html').length).toBeGreaterThan(100_000);
    expect(readProjectFile('scripts/audit-release-privacy.cjs')).not.toContain('restricted-bundled-skills-path');
  });

  it('ships canonical legal documents in every public distribution channel', () => {
    const desktopConfig = readProjectFile('packages/desktop/electron-builder.yml');
    const afterPack = readProjectFile('scripts/afterPack.js');
    const webPack = readProjectFile('scripts/pack-web-cli.js');
    const webSmoke = readProjectFile('scripts/smoke-test-web-cli.sh');
    const releaseWorkflow = readProjectFile('.github/workflows/build-and-release.yml');
    const distributionWorkflow = readProjectFile('.github/workflows/release-distribute.yml');

    for (const fileName of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'TERMS.md']) {
      expect(desktopConfig).toContain(`from: ${fileName}`);
      expect(afterPack).toContain(fileName);
      expect(webPack).toContain(`'${fileName}'`);
      expect(webSmoke).toContain(`legal/${fileName}`);
      expect(releaseWorkflow).toContain(`release-assets/${fileName}`);
      expect(distributionWorkflow).toContain(`--pattern "${fileName}"`);
    }

    expect(desktopConfig).toContain('to: legal/LICENSE');
    expect(desktopConfig).toContain('to: legal/PRIVACY.md');
    expect(desktopConfig).toContain('to: legal/TERMS.md');
    expect(webPack).toContain("path.join(tarballContentDir, 'legal')");
    expect(afterPack).toContain('Packaged app has missing or invalid legal document(s)');
    expect(webSmoke).toContain('grep -q "OfficeCLI" legal/THIRD_PARTY_NOTICES.md');
    expect(webSmoke).toContain('grep -q "Apache License 2.0" legal/THIRD_PARTY_NOTICES.md');
    expect(webSmoke).not.toContain('grep -q "WINK GO" legal/THIRD_PARTY_NOTICES.md');
  });

  it('ships bilingual account-service policy baselines with a review warning and contact channel', () => {
    const privacy = readProjectFile('PRIVACY.md');
    const terms = readProjectFile('TERMS.md');

    for (const policy of [privacy, terms]) {
      expect(policy).toContain('2026-07-30');
      expect(policy).toContain('1394748660@qq.com');
      expect(policy).toContain('not legal advice');
      expect(policy).toContain('执业律师');
    }
    expect(privacy).toContain('hashed fingerprint');
    expect(privacy).toContain('international transfer');
    expect(privacy).toContain('does not sell or rent personal data');
    expect(terms).toContain('Account services and the open-source license are separate');
    expect(terms).toContain('open, free, public-interest');
  });

  it('keeps package and Core license metadata aligned with Apache-2.0', () => {
    const packagePaths = [
      'package.json',
      'packages/desktop/package.json',
      'packages/shared-scripts/package.json',
      'packages/web-cli/package.json',
      'packages/web-host/package.json',
      'mobile/package.json',
    ];

    for (const packagePath of packagePaths) {
      const packageJson = JSON.parse(readProjectFile(packagePath)) as {
        license?: string;
        repository?: { url?: string };
      };
      expect(packageJson.license, packagePath).toBe('Apache-2.0');
      expect(packageJson.repository?.url, packagePath).toContain('github.com/WINKGO/wink-go.git');
    }

    expect(readProjectFile('backend/Cargo.toml')).toContain('license = "Apache-2.0"');
    expect(readProjectFile('backend/LICENSE')).toContain('Modifications Copyright 2026 WINK GO contributors.');
    const crateManifests = readdirSync(resolve(projectRoot, 'backend/crates'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `backend/crates/${entry.name}/Cargo.toml`)
      .filter((manifest) => {
        try {
          readProjectFile(manifest);
          return true;
        } catch {
          return false;
        }
      });
    expect(crateManifests).toHaveLength(24);
    for (const manifest of crateManifests) {
      expect(readProjectFile(manifest), manifest).toContain('license.workspace = true');
    }
    for (const workflow of ['backend/.github/workflows/release.yml', 'backend/.github/workflows/build-manual.yml']) {
      expect(readProjectFile(workflow), workflow).toContain('Copy-Item LICENSE');
      expect(readProjectFile(workflow), workflow).toContain('LICENSE');
    }
  });

  it('builds Docker from the supported Web CLI package and exposes its legal bundle', () => {
    const dockerfile = readProjectFile('Dockerfile');

    expect(dockerfile).toContain('node scripts/pack-web-cli.js');
    expect(dockerfile).toContain('COPY --from=builder /bundle/winkgo-web/ ./');
    expect(dockerfile).toContain('ENV WINKGO_PORT=25808');
    expect(dockerfile).toContain('CMD ["start", "--remote", "--data-dir", "/data", "--no-open"]');
    expect(dockerfile).not.toContain('build:renderer:web');
    expect(dockerfile).not.toContain('build-server.mjs');
  });

  it('cleans stale renderer chunks before every production build', () => {
    const viteConfig = readProjectFile('packages/desktop/electron.vite.config.ts');

    expect(viteConfig).toContain('emptyOutDir: true');
    expect(viteConfig).toContain('cleanRendererOutputPlugin()');
    expect(viteConfig).toContain('removeGeneratedDirectory(rendererOutput)');
  });

  it('keeps React-coupled renderer dependencies in one production vendor chunk', () => {
    const viteConfig = readProjectFile('packages/desktop/electron.vite.config.ts');

    expect(viteConfig).toContain("return 'vendor';");
    for (const splitChunk of [
      'vendor-react',
      'vendor-arco',
      'vendor-markdown',
      'vendor-highlight',
      'vendor-monaco',
      'vendor-codemirror',
      'vendor-katex',
    ]) {
      expect(viteConfig).not.toContain(`return '${splitChunk}';`);
    }
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
    const reusableBuildWorkflow = readProjectFile('.github/workflows/_build-reusable.yml');
    const releaseWorkflow = readProjectFile('.github/workflows/build-and-release.yml');
    const prepareScript = readProjectFile('scripts/prepare-release-assets.sh');
    const websiteManifestGenerator = readProjectFile('scripts/generate-winkgo-update-manifest.js');

    expect(freeConfig).toContain('url: https://winkgo.top/releases/free');
    expect(distributionWorkflow).toContain('WINKGO_RELEASE_SSH_PRIVATE_KEY');
    expect(distributionWorkflow).toContain('WINKGO_RELEASE_SSH_KNOWN_HOSTS');
    expect(distributionWorkflow).toContain('scripts/security/nginx-release-receiver.cjs validate');
    expect(distributionWorkflow).toContain('nginx-release-receiver.cjs validate-public');
    expect(distributionWorkflow).toContain('--range 0-0');
    expect(distributionWorkflow).toContain('content-length');
    expect(distributionWorkflow).not.toContain('--output "public-check/$INSTALLER"');
    expect(distributionWorkflow).toContain('publish $VERSION');
    expect(distributionWorkflow).toContain('verify_only');
    expect(distributionWorkflow).not.toContain('AWS_');
    expect(distributionWorkflow).not.toContain('aws s3');
    expect(reusableBuildWorkflow).toContain('out/winkgo-free-update.json');
    expect(reusableBuildWorkflow).toContain('out/*.sha256.txt');
    expect(prepareScript).toContain('winkgo-free-update.json');
    expect(prepareScript).toContain('WINK-GO-Free-Setup-*-x64.exe.sha256.txt');
    expect(releaseWorkflow).toContain('release-assets/winkgo-free-update.json');
    expect(releaseWorkflow).toContain('release-assets/WINK-GO-Free-Setup-*-x64.exe.sha256.txt');
    expect(websiteManifestGenerator).toContain('https://winkgo.top/releases/free/${version}/${installerName}');
    expect(websiteManifestGenerator).toContain(
      'https://github.com/WINKGO/WinkGo/releases/download/v${version}/${installerName}'
    );
  });

  it('retries mac prepackaged builds with both dmg and zip targets', () => {
    const script = readProjectFile('scripts/build-with-builder.js');

    expect(script).toMatch(/--mac\s+dmg\s+zip\s+--\$\{targetArch\}\s+--prepackaged/);
  });

  it('refuses to publish a Windows executable without the WINK GO icon', () => {
    const script = readProjectFile('scripts/build-with-builder.js');
    const privacyAudit = readProjectFile('scripts/audit-release-privacy.cjs');

    expect(script).toContain('verifyWindowsExecutableIcon');
    expect(script).toContain('verify-windows-executable-icon.js');
    expect(script).toContain('resolveWindowsUnpackedExecutable');
    expect(script).toContain('`win-${targetArch}-unpacked`');
    expect(script).toContain("'--packed-asar'");
    expect(privacyAudit).toContain("'out/win-arm64-unpacked/resources'");
    expect(privacyAudit).toContain("'out/linux-arm64-unpacked'");
    expect(script).not.toContain('Retrying local build with win.signAndEditExecutable=false');
    expect(script).not.toContain('`${builderCommand} --config.win.signAndEditExecutable=false`');
  });

  it('does not attempt to rerun an active release workflow from inside itself', () => {
    const releaseWorkflow = readProjectFile('.github/workflows/build-and-release.yml');

    expect(releaseWorkflow).not.toContain('Auto Retry on Build Failure');
    expect(releaseWorkflow).not.toContain('/actions/runs/${{ github.run_id }}/rerun');
  });

  it('builds Linux x64 release bundles against the Debian 12 glibc baseline', () => {
    const releaseWorkflow = readProjectFile('.github/workflows/build-and-release.yml');
    const manualWorkflow = readProjectFile('.github/workflows/build-manual.yml');
    const webCliWorkflow = readProjectFile('.github/workflows/pack-web-cli.yml');

    expect(releaseWorkflow).toContain('"platform":"linux-x64","os":"ubuntu-22.04"');
    expect(manualWorkflow).toContain('"platform":"linux-x64","os":"ubuntu-22.04"');
    expect(webCliWorkflow).toContain('{ platform: linux, arch: x64, os: ubuntu-22.04 }');
    expect(webCliWorkflow).toContain('image: debian:bookworm-slim');
  });

  it('uses Debian amd64 naming for Linux x64 desktop packages', () => {
    const prepareScript = readProjectFile('scripts/prepare-release-assets.sh');
    const verifyScript = readProjectFile('scripts/verify-release-assets.sh');
    const mockScript = readProjectFile('scripts/create-mock-release-artifacts.sh');
    const installScript = readProjectFile('scripts/install-ubuntu.sh');

    expect(prepareScript).toContain('WINK-GO-Free-${VERSION}-linux-${arch}.deb');
    expect(verifyScript).toContain('WINK-GO-Free-${VERSION}-linux-${arch}.deb');
    expect(prepareScript).toContain('for arch in amd64 arm64');
    expect(verifyScript).toContain('for arch in amd64 arm64');
    expect(mockScript).toContain('WINK-GO-Free-1.0.0-linux-amd64.deb');
    expect(installScript).toContain('RELEASE_ARCH="amd64"');
    expect(mockScript).not.toContain('WINK-GO-Free-1.0.0-linux-x64.deb');
  });

  it('does not let a generic notarization log line bypass the packed release audit', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');

    expect(workflow).not.toContain('grep -qiE "notariz|staple"');
    expect(workflow).toContain('failed to notarize|notarization (failed|error)');
    expect(workflow).toContain('node scripts/audit-release-privacy.cjs --packed');
    expect(workflow).toContain('rm -f out/*.dmg');
  });

  itWithBash('fails release asset preparation when a mac zip is missing', { timeout: 30000 }, () => {
    // Keep shell arguments relative on Windows. Git Bash mangles native
    // absolute paths such as C:\... when they are passed as ordinary argv.
    const tempDir = mkdtempSync(resolve(projectRoot, '.tmp-winkgo-release-assets-'));
    const tempName = basename(tempDir);
    const artifactsDir = resolve(tempDir, 'build-artifacts');
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
