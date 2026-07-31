#!/usr/bin/env node
// Modified from AionUI by WINK GO contributors in 2026.

/**
 * Simplified build script for WinkGo
 * Coordinates electron-vite (bundling) and electron-builder (packaging)
 *
 * Features:
 * - Incremental builds: use --skip-vite to skip Vite compilation if out/ exists
 * - Skip native rebuild: use --skip-native to skip native module rebuilding
 * - Packaging only: use --pack-only to skip electron-builder distributable creation
 * - Release-safe editions: defaults to Free; Pro requires --edition pro --allow-pro-dev locally
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// DMG retry logic for macOS: detects DMG creation failures by checking artifacts
// (.app exists but .dmg missing) and retries only the DMG step using
// electron-builder --prepackaged with the .app path (not the parent directory).
// This preserves full DMG styling (window size, icon positions, background)
// Background: GitHub Actions macos-14 runners occasionally suffer from transient
// "Device not configured" hdiutil errors (electron-builder#8415, actions/runner-images#12323).
const DMG_RETRY_MAX = 3;
const DMG_RETRY_DELAY_SEC = 30;

// Incremental build: hash of source files to detect changes
const INCREMENTAL_CACHE_FILE = 'out/.build-hash';
const VITE_EDITION_MARKER_FILE = 'out/.winkgo-vite-build.json';
const VITE_EDITION_MARKER_SCHEMA_VERSION = 1;
const DEBUG_AUTO_UPDATE_CURRENT_VERSION_ENV = 'WINKGO_DEBUG_AUTO_UPDATE_CURRENT_VERSION';

function patchElectronBuilderNsisInstaller() {
  const rootDir = path.resolve(__dirname, '..');
  // Resolve app-builder-lib inside THIS repo first. require.resolve walks up
  // parent directories, so in a git worktree (whose bun install has no
  // top-level node_modules/app-builder-lib) it would escape to the main
  // checkout's copy and patch the wrong file.
  let appBuilderDir = '';
  const directDir = path.join(rootDir, 'node_modules', 'app-builder-lib');
  if (fs.existsSync(path.join(directDir, 'package.json'))) {
    appBuilderDir = directDir;
  } else {
    const bunModulesDir = path.join(rootDir, 'node_modules', '.bun');
    if (fs.existsSync(bunModulesDir)) {
      const candidates = fs
        .readdirSync(bunModulesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('app-builder-lib@'))
        .map((entry) => path.join(bunModulesDir, entry.name, 'node_modules', 'app-builder-lib'))
        .filter((candidate) => fs.existsSync(path.join(candidate, 'package.json')))
        .sort();
      appBuilderDir = candidates[0] || '';
    }
  }
  if (!appBuilderDir) {
    try {
      appBuilderDir = path.dirname(require.resolve('app-builder-lib/package.json'));
    } catch (error) {
      console.warn(`Warning: app-builder-lib is not resolvable; skipping NSIS template patch: ${error.message}`);
      return;
    }
  }

  const installUtilPath = path.join(appBuilderDir, 'templates', 'nsis', 'include', 'installUtil.nsh');
  if (!fs.existsSync(installUtilPath)) {
    console.warn(`Warning: electron-builder NSIS installUtil.nsh not found: ${installUtilPath}`);
    return;
  }

  const original = fs.readFileSync(installUtilPath, 'utf8');
  let patched = original;

  const retryPrompt = [
    '    ${if} $R5 > 5',
    '      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY OneMoreAttempt',
    '      Return',
    '    ${endIf}',
  ].join('\n');
  const retryHandoff = [
    '    ${if} $R5 > 5',
    '      DetailPrint `Previous uninstaller did not finish after retry limit; deferring to customUnInstallCheck.`',
    '      Return',
    '    ${endIf}',
  ].join('\n');

  if (patched.includes(retryPrompt)) {
    patched = patched.replace(retryPrompt, retryHandoff);
  } else if (!patched.includes(retryHandoff)) {
    throw new Error(
      'electron-builder NSIS uninstall retry prompt template changed; update patchElectronBuilderNsisInstaller.'
    );
  }

  const oneMoreAttemptLabel = '  OneMoreAttempt:\n';
  if (patched.includes(oneMoreAttemptLabel)) {
    patched = patched.replace(oneMoreAttemptLabel, '');
  }

  const copiedUninstallerExec = `ExecWait '"$uninstallerFileNameTemp" /S /KEEP_APP_DATA $0 _?=$installationDir' $R0`;
  const copiedUninstallerExecWithLog = `ExecWait '"$uninstallerFileNameTemp" /S /KEEP_APP_DATA $0 --installer-log="$WinkGoSessionLogPath" --installer-session="$WinkGoSessionId" _?=$installationDir' $R0`;
  const copiedUninstallerExecWithBrandedLog =
    /ExecWait '"\$uninstallerFileNameTemp" \/S \/KEEP_APP_DATA \$0 --installer-log="\$[A-Za-z0-9_]+SessionLogPath"(?: --installer-session="\$[A-Za-z0-9_]+SessionId")? _\?=\$installationDir' \$R0/;
  if (patched.includes(copiedUninstallerExec)) {
    patched = patched.replace(copiedUninstallerExec, copiedUninstallerExecWithLog);
  } else if (copiedUninstallerExecWithBrandedLog.test(patched)) {
    patched = patched.replace(copiedUninstallerExecWithBrandedLog, copiedUninstallerExecWithLog);
  } else if (
    patched.includes(
      `ExecWait '"$uninstallerFileNameTemp" /S /KEEP_APP_DATA $0 --installer-log="$WinkGoSessionLogPath" _?=$installationDir' $R0`
    )
  ) {
    patched = patched.replace(
      `ExecWait '"$uninstallerFileNameTemp" /S /KEEP_APP_DATA $0 --installer-log="$WinkGoSessionLogPath" _?=$installationDir' $R0`,
      copiedUninstallerExecWithLog
    );
  } else if (!patched.includes(copiedUninstallerExecWithLog)) {
    throw new Error(
      'electron-builder copied-uninstaller ExecWait template changed; update patchElectronBuilderNsisInstaller.'
    );
  }

  const uninstallerCopySource = [
    '  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\\old-uninstaller.exe"',
    '  !insertmacro copyFile "$uninstallerFileName" "$uninstallerFileNameTemp"',
  ].join('\n');
  const bundledUninstallerOverride = [
    '  ${if} ${FileExists} "$PLUGINSDIR\\WINK-GO-fixed-uninstaller.exe"',
    '    DetailPrint `WINK-GO bundled uninstaller override source.`',
    '    StrCpy $uninstallerFileName "$PLUGINSDIR\\WINK-GO-fixed-uninstaller.exe"',
    '  ${endIf}',
  ].join('\n');
  const bundledUninstallerCopySource = [
    bundledUninstallerOverride,
    '',
    '  StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\\old-uninstaller.exe"',
    '  !insertmacro copyFile "$uninstallerFileName" "$uninstallerFileNameTemp"',
  ].join('\n');

  const bundledOverridePattern =
    /  \$\{if\} \$\{FileExists\} "\$PLUGINSDIR\\(?:WINK-GO|WinkGo)-fixed-uninstaller\.exe"\r?\n[\s\S]*?  \$\{endIf\}\r?\n\r?\n/g;
  patched = patched.replace(bundledOverridePattern, '');

  if (patched.includes(uninstallerCopySource)) {
    patched = patched.replace(uninstallerCopySource, bundledUninstallerCopySource);
  } else {
    throw new Error(
      'electron-builder old-uninstaller copy template changed; update patchElectronBuilderNsisInstaller.'
    );
  }

  const inPlaceUninstallerExec = `ExecWait '"$uninstallerFileName" /S /KEEP_APP_DATA $0 _?=$installationDir' $R0`;
  const inPlaceUninstallerExecWithLog = `ExecWait '"$uninstallerFileName" /S /KEEP_APP_DATA $0 --installer-log="$WinkGoSessionLogPath" --installer-session="$WinkGoSessionId" _?=$installationDir' $R0`;
  const inPlaceUninstallerExecWithBrandedLog =
    /ExecWait '"\$uninstallerFileName" \/S \/KEEP_APP_DATA \$0 --installer-log="\$[A-Za-z0-9_]+SessionLogPath"(?: --installer-session="\$[A-Za-z0-9_]+SessionId")? _\?=\$installationDir' \$R0/;
  if (patched.includes(inPlaceUninstallerExec)) {
    patched = patched.replace(inPlaceUninstallerExec, inPlaceUninstallerExecWithLog);
  } else if (inPlaceUninstallerExecWithBrandedLog.test(patched)) {
    patched = patched.replace(inPlaceUninstallerExecWithBrandedLog, inPlaceUninstallerExecWithLog);
  } else if (
    patched.includes(
      `ExecWait '"$uninstallerFileName" /S /KEEP_APP_DATA $0 --installer-log="$WinkGoSessionLogPath" _?=$installationDir' $R0`
    )
  ) {
    patched = patched.replace(
      `ExecWait '"$uninstallerFileName" /S /KEEP_APP_DATA $0 --installer-log="$WinkGoSessionLogPath" _?=$installationDir' $R0`,
      inPlaceUninstallerExecWithLog
    );
  } else if (!patched.includes(inPlaceUninstallerExecWithLog)) {
    throw new Error(
      'electron-builder in-place uninstaller ExecWait template changed; update patchElectronBuilderNsisInstaller.'
    );
  }

  if (patched !== original) {
    fs.writeFileSync(installUtilPath, patched);
    console.log('Patched electron-builder NSIS uninstall failure handoff.');
  }
}

function walkFiles(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === '.git') continue;
      walkFiles(fullPath, acc);
    } else if (entry.isFile()) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function computeSourceHash() {
  const hash = crypto.createHash('md5');
  const rootDir = path.resolve(__dirname, '..');
  hash.update(`winkgo-edition:${process.env.WINKGO_EDITION || 'free'}:`);
  const filesToHash = [
    'package.json',
    'package-lock.json',
    'bun.lock',
    'tsconfig.json',
    'packages/desktop/electron.vite.config.ts',
    'packages/desktop/electron-builder.yml',
    'packages/desktop/electron-builder.free.yml',
    'packages/desktop/electron-builder.pro.yml',
    'justfile',
  ];

  for (const file of filesToHash) {
    const filePath = path.resolve(rootDir, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath);
      hash.update(file + ':');
      hash.update(content);
    }
  }

  const hashDirs = ['packages/desktop/src', 'packages', 'public', 'scripts'];
  for (const dir of hashDirs) {
    const dirPath = path.resolve(rootDir, dir);
    if (!fs.existsSync(dirPath)) continue;

    const files = walkFiles(dirPath)
      .map((file) => path.relative(rootDir, file).replace(/\\/g, '/'))
      .sort();

    for (const relPath of files) {
      const absolutePath = path.resolve(rootDir, relPath);
      const stat = fs.statSync(absolutePath);
      hash.update(relPath + ':');
      hash.update(String(stat.size));
      hash.update(String(stat.mtimeMs));
    }
  }

  return hash.digest('hex');
}

function loadCachedHash() {
  try {
    const cacheFile = path.resolve(__dirname, '..', INCREMENTAL_CACHE_FILE);
    if (fs.existsSync(cacheFile)) {
      return fs.readFileSync(cacheFile, 'utf8').trim();
    }
  } catch {}
  return null;
}

function saveCurrentHash(hash) {
  try {
    const cacheFile = path.resolve(__dirname, '..', INCREMENTAL_CACHE_FILE);
    const viteDir = path.dirname(cacheFile);
    if (!fs.existsSync(viteDir)) {
      fs.mkdirSync(viteDir, { recursive: true });
    }
    fs.writeFileSync(cacheFile, hash);
  } catch {}
}

function readViteEditionMarker() {
  const markerPath = path.resolve(__dirname, '..', VITE_EDITION_MARKER_FILE);
  if (!fs.existsSync(markerPath)) {
    return { valid: false, reason: `missing ${VITE_EDITION_MARKER_FILE}` };
  }

  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (
      marker?.schemaVersion !== VITE_EDITION_MARKER_SCHEMA_VERSION ||
      (marker?.edition !== 'free' && marker?.edition !== 'pro')
    ) {
      return { valid: false, reason: `invalid ${VITE_EDITION_MARKER_FILE}` };
    }
    return { valid: true, marker };
  } catch (error) {
    return {
      valid: false,
      reason: `unreadable ${VITE_EDITION_MARKER_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function saveViteEditionMarker(edition, sourceHash) {
  const markerPath = path.resolve(__dirname, '..', VITE_EDITION_MARKER_FILE);
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(
    markerPath,
    `${JSON.stringify(
      {
        schemaVersion: VITE_EDITION_MARKER_SCHEMA_VERSION,
        edition,
        sourceHash,
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

function describeViteEditionMarker(markerResult) {
  if (!markerResult.valid) {
    return markerResult.reason;
  }
  return `"${markerResult.marker.edition}"`;
}

function viteBuildExists() {
  const outDir = path.resolve(__dirname, '../out');
  const mainDir = path.join(outDir, 'main');
  const rendererDir = path.join(outDir, 'renderer');

  return (
    fs.existsSync(path.join(mainDir, 'index.js')) &&
    fs.existsSync(path.join(outDir, 'preload', 'index.js')) &&
    validateRendererBuildOutput(rendererDir).valid
  );
}

function collectHtmlAssetRefs(html, htmlDirRelative) {
  const refs = [];
  const attrRe = /\b(?:src|href)=["']([^"']+)["']/g;
  for (const match of html.matchAll(attrRe)) {
    const rawRef = match[1];
    if (!rawRef || rawRef.startsWith('http:') || rawRef.startsWith('https:') || rawRef.startsWith('data:')) continue;
    if (!rawRef.startsWith('./') && !rawRef.startsWith('../')) continue;

    const normalized = path
      .normalize(path.join(htmlDirRelative, rawRef.split(/[?#]/)[0]))
      .replace(/\\/g, '/')
      .replace(/^\.\//, '');
    if (normalized.startsWith('assets/')) {
      refs.push(normalized);
    }
  }
  return refs;
}

function walkHtmlFiles(dir, baseDir = dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtmlFiles(fullPath, baseDir, acc);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      acc.push({
        fullPath,
        relativePath: path.relative(baseDir, fullPath).replace(/\\/g, '/'),
      });
    }
  }
  return acc;
}

function validateRendererBuildOutput(rendererDir) {
  const problems = [];
  const indexHtmlPath = path.join(rendererDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    return { valid: false, problems: ['Renderer build output is incomplete: missing out/renderer/index.html'] };
  }

  const htmlFiles = walkHtmlFiles(rendererDir);
  if (htmlFiles.length === 0) {
    return { valid: false, problems: ['Renderer build output is incomplete: no HTML files under out/renderer'] };
  }

  const assetRefs = new Set();
  for (const htmlFile of htmlFiles) {
    const html = fs.readFileSync(htmlFile.fullPath, 'utf8');
    if (/src=["'][^"']*\.tsx(?:[?#][^"']*)?["']/.test(html)) {
      problems.push(`Renderer build output is incomplete: ${htmlFile.relativePath} still references TypeScript source`);
    }

    const htmlDirRelative = path.dirname(htmlFile.relativePath);
    const baseRelative = htmlDirRelative === '.' ? '' : htmlDirRelative;
    for (const ref of collectHtmlAssetRefs(html, baseRelative)) {
      assetRefs.add(ref);
    }
  }

  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  if (!/<div\s+id=["']root["']/.test(indexHtml)) {
    problems.push('Renderer build output is incomplete: index.html is missing #root');
  }
  if (!/<script\b[^>]*type=["']module["'][^>]*\bsrc=["']\.\/assets\/[^"']+\.js["']/.test(indexHtml)) {
    problems.push('Renderer build output is incomplete: index.html has no bundled module script');
  }

  if (assetRefs.size === 0) {
    problems.push('Renderer build output is incomplete: no bundled renderer asset references found');
  }

  for (const ref of [...assetRefs].sort()) {
    if (!fs.existsSync(path.join(rendererDir, ref))) {
      problems.push(`Renderer build output is incomplete: missing referenced asset ${ref}`);
    }
  }

  return { valid: problems.length === 0, problems };
}

function validateViteBuildOutput() {
  const outDir = path.resolve(__dirname, '../out');
  const problems = [];

  for (const relPath of ['main/index.js', 'preload/index.js']) {
    if (!fs.existsSync(path.join(outDir, relPath))) {
      problems.push(`Vite build output is incomplete: missing out/${relPath}`);
    }
  }

  const rendererValidation = validateRendererBuildOutput(path.join(outDir, 'renderer'));
  problems.push(...rendererValidation.problems);

  return { valid: problems.length === 0, problems };
}

function shouldSkipViteBuild(skipViteFlag, forceFlag, expectedEdition) {
  if (forceFlag) return false;
  const editionMarker = readViteEditionMarker();
  if (skipViteFlag) {
    if (!editionMarker.valid || editionMarker.marker.edition !== expectedEdition) {
      throw new Error(
        `Refusing --skip-vite: expected "${expectedEdition}" Vite output, but found ${describeViteEditionMarker(
          editionMarker
        )}. Rebuild without --skip-vite.`
      );
    }
    return true;
  }

  // Auto-detect: skip if build exists and hash matches
  const currentHash = computeSourceHash();
  const cachedHash = loadCachedHash();
  const markerMatches =
    editionMarker.valid &&
    editionMarker.marker.edition === expectedEdition &&
    editionMarker.marker.sourceHash === currentHash;

  if (cachedHash && currentHash === cachedHash && markerMatches && viteBuildExists()) {
    console.log('📦 Incremental build: Vite output unchanged, skipping compilation');
    return true;
  }

  if (cachedHash && currentHash === cachedHash && !markerMatches) {
    console.warn(
      `Incremental build cache matched but the Vite edition marker is stale or mismatched (${describeViteEditionMarker(
        editionMarker
      )}); rebuilding.`
    );
  }

  if (cachedHash && currentHash === cachedHash) {
    const validation = validateViteBuildOutput();
    if (!validation.valid) {
      console.warn('Incremental build cache matched but output is incomplete; rebuilding.');
      for (const problem of validation.problems.slice(0, 5)) {
        console.warn(`   ${problem}`);
      }
    }
  }

  return false;
}

function cleanupDiskImages() {
  try {
    // Detach all mounted disk images that may block subsequent DMG creation:
    // hdiutil info → grep device paths → force detach each
    const result = spawnSync(
      'sh',
      [
        '-c',
        "hdiutil info 2>/dev/null | grep /dev/disk | awk '{print $1}' | xargs -I {} hdiutil detach {} -force 2>/dev/null",
      ],
      { stdio: 'ignore' }
    );
    if (result.status !== 0) {
      console.log(`   ℹ️  Disk image cleanup exit code: ${result.status}`);
    }
    return result.status === 0;
  } catch (error) {
    console.log(`   ℹ️  Disk image cleanup failed: ${error.message}`);
    return false;
  }
}

// Find the .app directory from electron-builder output
function findAppDir(outDir) {
  const candidates = ['mac', 'mac-arm64', 'mac-x64', 'mac-universal'];
  for (const dir of candidates) {
    const fullPath = path.join(outDir, dir);
    if (fs.existsSync(fullPath)) {
      const hasApp = fs.readdirSync(fullPath).some((f) => f.endsWith('.app'));
      if (hasApp) return fullPath;
    }
  }
  return null;
}

// Check if DMG exists in output directory
function dmgExists(outDir) {
  try {
    return fs.readdirSync(outDir).some((f) => f.endsWith('.dmg'));
  } catch {
    return false;
  }
}

function tryRemoveDir(targetDir) {
  if (!fs.existsSync(targetDir)) return true;
  try {
    fs.rmSync(targetDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 300,
    });
    return true;
  } catch (error) {
    console.log(`❌ Failed to remove ${targetDir}: ${error.message}`);
    return false;
  }
}

function isProcessRunningWindows(imageName) {
  if (process.platform !== 'win32') return false;
  try {
    const result = execSync(`tasklist /FI "IMAGENAME eq ${imageName}"`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.toString().toLowerCase().includes(imageName.toLowerCase());
  } catch {
    return false;
  }
}

function killWindowsProcesses(imageNames) {
  if (process.platform !== 'win32') return;
  for (const name of imageNames) {
    try {
      execSync(`taskkill /F /IM ${name}`, { stdio: 'ignore' });
    } catch {}
  }
}

function formatExecError(error) {
  return [error?.message, error?.stdout?.toString?.(), error?.stderr?.toString?.()].filter(Boolean).join('\n').trim();
}

function escapeNsisDefineValue(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '$\\"');
}

function writeGeneratedSentryDsnInclude(projectRoot) {
  const generatedInclude = path.join(projectRoot, 'resources/windows/support/_sentry-dsn.generated.nsh');
  fs.mkdirSync(path.dirname(generatedInclude), { recursive: true });
  fs.writeFileSync(
    generatedInclude,
    `!define WINKGO_SENTRY_DSN "${escapeNsisDefineValue(process.env.SENTRY_DSN || '')}"\n`
  );
}

function isValidPackageVersion(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    value
  );
}

function applyDebugAutoUpdateVersionOverride(packageJsonPath) {
  const debugAutoUpdateCurrentVersion = process.env[DEBUG_AUTO_UPDATE_CURRENT_VERSION_ENV]?.trim();
  if (!debugAutoUpdateCurrentVersion) {
    return () => {};
  }
  if (!isValidPackageVersion(debugAutoUpdateCurrentVersion)) {
    throw new Error(`${DEBUG_AUTO_UPDATE_CURRENT_VERSION_ENV} must be a valid semver version`);
  }

  const originalPackageJsonText = fs.readFileSync(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(originalPackageJsonText);
  const originalPackageVersion = packageJson.version;
  if (originalPackageVersion === debugAutoUpdateCurrentVersion) {
    console.log(`Debug auto-update build version already set to ${debugAutoUpdateCurrentVersion}`);
    return () => {};
  }

  packageJson.version = debugAutoUpdateCurrentVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(
    `Debug auto-update build version override: ${originalPackageVersion} -> ${debugAutoUpdateCurrentVersion}`
  );

  return () => {
    if (fs.readFileSync(packageJsonPath, 'utf8') !== originalPackageJsonText) {
      fs.writeFileSync(packageJsonPath, originalPackageJsonText);
      console.log(`Restored package.json version to ${originalPackageVersion}`);
    }
  };
}

// Create macOS distributables using electron-builder --prepackaged with .app path.
// This preserves DMG styling and still emits the zip required by MacUpdater.
function createMacArtifactsWithPrepackaged(appDir, targetArch, configPath) {
  const appName = fs.readdirSync(appDir).find((f) => f.endsWith('.app'));
  if (!appName) throw new Error(`No .app found in ${appDir}`);
  const appPath = path.join(appDir, appName);

  execSync(
    `bunx electron-builder --config ${configPath} --mac dmg zip --${targetArch} --prepackaged "${appPath}" --publish=never`,
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    }
  );
}

function buildWithDmgRetry(cmd, targetArch, configPath = 'packages/desktop/electron-builder.yml') {
  const isMac = process.platform === 'darwin';
  const outDir = path.resolve(__dirname, '../out');

  try {
    execSync(cmd, { stdio: 'inherit', shell: process.platform === 'win32' });
    return;
  } catch (error) {
    // On non-macOS or if .app doesn't exist, just throw
    const appDir = isMac ? findAppDir(outDir) : null;
    if (!appDir || dmgExists(outDir)) throw error;

    // .app exists but no .dmg → DMG creation failed
    console.log('\n🔄 Build failed during DMG creation (.app exists, .dmg missing)');
    console.log('   Retrying macOS distributable creation with --prepackaged...');

    for (let attempt = 1; attempt <= DMG_RETRY_MAX; attempt++) {
      cleanupDiskImages();
      spawnSync('sleep', [String(DMG_RETRY_DELAY_SEC)]);

      try {
        console.log(`\n📀 DMG retry attempt ${attempt}/${DMG_RETRY_MAX}...`);
        createMacArtifactsWithPrepackaged(appDir, targetArch, configPath);
        console.log('✅ macOS distributables created successfully on retry');
        return;
      } catch (retryError) {
        console.log(`   ⚠️  DMG retry ${attempt}/${DMG_RETRY_MAX} failed`);
        cleanupDiskImages();
        if (attempt === DMG_RETRY_MAX) {
          console.log(`   ❌ DMG creation failed after ${DMG_RETRY_MAX} retries`);
          throw retryError;
        }
      }
    }
  }
}

// Clean stale Windows packaging outputs from previous runs
function cleanupWindowsPackOutput() {
  const outDir = path.resolve(__dirname, '../out');
  if (!fs.existsSync(outDir)) return;

  const removed = [];
  const winUnpackedDirRe = /^win(?:-[a-z0-9]+)?-unpacked$/i;
  const winArtifactFileRe = /-win-[^.]+\.(?:exe|msi|zip|7z)$/i;
  const winkGoInstallerFileRe = /^WINK-GO-(?:Free|Pro)-Setup-.+-(?:x64|arm64|ia32)\.exe$/i;

  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    const fullPath = path.join(outDir, entry.name);

    if (entry.isDirectory() && winUnpackedDirRe.test(entry.name)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      removed.push(entry.name);
      continue;
    }

    if (entry.isFile() && (winArtifactFileRe.test(entry.name) || winkGoInstallerFileRe.test(entry.name))) {
      fs.rmSync(fullPath, { force: true });
      removed.push(entry.name);
    }
  }

  if (removed.length > 0) {
    console.log(`🧹 Cleaned stale Windows outputs: ${removed.join(', ')}`);
  }
}

function auditFinalWindowsInstallers(buildEdition, targetArch) {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const escapedVersion = String(packageJson.version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedArch = String(targetArch).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const editionLabel = buildEdition === 'pro' ? 'Pro' : 'Free';
  const artifactPrefix = buildEdition === 'pro' ? 'WINK-GO-Pro' : 'WINK-GO-Free';
  const installerPattern = new RegExp(`^${artifactPrefix}-Setup-${escapedVersion}-${escapedArch}\\.exe$`, 'i');
  const outDir = path.resolve(__dirname, '..', 'out');
  const installers = fs
    .readdirSync(outDir)
    .filter((name) => installerPattern.test(name))
    .map((name) => path.join(outDir, name));

  if (!installers.length) {
    throw new Error(`No final ${editionLabel} Windows installer was found for privacy auditing.`);
  }

  for (const installerPath of installers) {
    const auditResult = spawnSync(process.execPath, ['scripts/audit-release-privacy.cjs', '--exe', installerPath], {
      cwd: path.resolve(__dirname, '..'),
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (auditResult.error || auditResult.status !== 0) {
      throw new Error(
        `Final installer privacy audit failed for ${path.basename(installerPath)}: ${
          auditResult.error?.message || `exit ${auditResult.status}`
        }`
      );
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const archList = ['x64', 'arm64', 'ia32', 'armv7l'];

// Check for special flags
const skipVite = args.includes('--skip-vite');
const skipNative = args.includes('--skip-native');
const packOnly = args.includes('--pack-only');
const forceBuild = args.includes('--force');
const allowProDev = args.includes('--allow-pro-dev');
const editionArgIndex = args.findIndex((arg) => arg === '--edition');
const editionArgValue =
  editionArgIndex >= 0 ? args[editionArgIndex + 1] : args.find((arg) => arg.startsWith('--edition='))?.split('=')[1];
const requestedEdition = String(editionArgValue || process.env.WINKGO_EDITION || 'free')
  .trim()
  .toLowerCase();
const isCiEnvironment = /^(1|true|yes)$/i.test(String(process.env.CI || '').trim());
if (requestedEdition !== 'free' && requestedEdition !== 'pro') {
  throw new Error(`Unsupported WINK GO edition "${requestedEdition}". Use --edition free or --edition pro.`);
}
const buildEdition = requestedEdition;
if (
  buildEdition === 'pro' &&
  (String(editionArgValue || '')
    .trim()
    .toLowerCase() !== 'pro' ||
    !allowProDev ||
    isCiEnvironment)
) {
  throw new Error(
    'Pro builds are development-only. Use --edition pro --allow-pro-dev explicitly on a local development machine.'
  );
}
process.env.WINKGO_EDITION = buildEdition;
process.env.WINKGO_ALLOW_PRO_DEV_BUILD = buildEdition === 'pro' ? '1' : '0';
const builderConfigPath = `packages/desktop/electron-builder.${buildEdition}.yml`;

const builderArgs = args
  .filter((arg, index) => {
    // Filter out 'auto', architecture flags, and special flags
    if (arg === 'auto') return false;
    if (arg === '--skip-vite' || arg === '--skip-native' || arg === '--pack-only' || arg === '--force') return false;
    if (arg === '--allow-pro-dev') return false;
    if (
      arg === '--edition' ||
      (editionArgIndex >= 0 && index === editionArgIndex + 1) ||
      arg.startsWith('--edition=')
    ) {
      return false;
    }
    if (archList.includes(arg)) return false;
    if (arg.startsWith('--') && archList.includes(arg.slice(2))) return false;
    return true;
  })
  .join(' ');

// Get target architecture from electron-builder.yml
function getTargetArchFromConfig(platform) {
  try {
    const configPath = path.resolve(__dirname, '../packages/desktop/electron-builder.yml');
    const content = fs.readFileSync(configPath, 'utf8');

    const platformRegex = new RegExp(`^${platform}:\\s*$`, 'm');
    const platformMatch = content.match(platformRegex);
    if (!platformMatch) return null;

    const platformStartIndex = platformMatch.index;
    const afterPlatform = content.slice(platformStartIndex + platformMatch[0].length);
    const nextPlatformMatch = afterPlatform.match(/^[a-zA-Z][a-zA-Z0-9]*:/m);
    const platformBlock = nextPlatformMatch
      ? content.slice(platformStartIndex, platformStartIndex + platformMatch[0].length + nextPlatformMatch.index)
      : content.slice(platformStartIndex);

    const archMatch = platformBlock.match(/arch:\s*\[\s*([a-z0-9_]+)/i);
    return archMatch ? archMatch[1].trim() : null;
  } catch (error) {
    return null;
  }
}

// Determine target architecture
const buildMachineArch = process.arch;
let targetArch;
let multiArch = false;

// Check if multiple architectures are specified (support both --x64 and x64 formats)
const rawArchArgs = args
  .filter((arg) => {
    if (archList.includes(arg)) return true;
    if (arg.startsWith('--') && archList.includes(arg.slice(2))) return true;
    return false;
  })
  .map((arg) => (arg.startsWith('--') ? arg.slice(2) : arg));

// Remove duplicates to avoid treating "x64 --x64" as multiple architectures
const archArgs = [...new Set(rawArchArgs)];

if (archArgs.length > 1) {
  // Multiple unique architectures specified - let electron-builder handle it
  multiArch = true;
  targetArch = archArgs[0]; // Use first arch for webpack build
  console.log(`🔨 Multi-architecture build detected: ${archArgs.join(', ')}`);
} else if (args[0] === 'auto') {
  if (archArgs.length === 1) {
    targetArch = archArgs[0];
  } else {
    // Auto mode: detect from electron-builder.yml
    let detectedPlatform = null;
    if (builderArgs.includes('--linux')) detectedPlatform = 'linux';
    else if (builderArgs.includes('--mac')) detectedPlatform = 'mac';
    else if (builderArgs.includes('--win')) detectedPlatform = 'win';

    const configArch = detectedPlatform ? getTargetArchFromConfig(detectedPlatform) : null;
    targetArch = configArch || buildMachineArch;
  }
} else {
  // Explicit architecture or default to build machine
  targetArch = archArgs[0] || buildMachineArch;
}

console.log(`🔨 Building for architecture: ${targetArch}`);
console.log(`🧩 WINK GO edition: ${buildEdition === 'pro' ? 'Pro' : 'Free'}`);
console.log(`📋 Builder arguments: ${builderArgs || '(none)'}`);
if (skipVite) console.log('⚡ --skip-vite: Will skip Vite compilation if output exists');
if (skipNative) console.log('⚡ --skip-native: Will skip native module rebuilding');
if (packOnly) console.log('⚡ --pack-only: Will skip electron-builder distributable creation');
if (forceBuild) console.log('⚡ --force: Force full rebuild');

const packageJsonPath = path.resolve(__dirname, '../package.json');
let restorePackageVersionOverride = () => {};
let buildFailed = false;

try {
  restorePackageVersionOverride = applyDebugAutoUpdateVersionOverride(packageJsonPath);

  // 1. Ensure package.json main entry is correct for electron-vite
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (packageJson.main !== './out/main/index.js') {
    packageJson.main = './out/main/index.js';
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  }

  // 2. Check if we can skip Vite build (incremental build)
  const skipViteBuild = shouldSkipViteBuild(skipVite, forceBuild, buildEdition);

  if (!skipViteBuild) {
    // Run electron-vite to build all bundles (main + preload + renderer)
    console.log(`📦 Building ${targetArch}...`);
    execSync(`bunx electron-vite build --config packages/desktop/electron.vite.config.ts`, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        ELECTRON_BUILDER_ARCH: targetArch,
        WINKGO_EDITION: buildEdition,
      },
    });

    // Save both the source hash and edition identity after a successful build.
    // `--skip-vite` must never package stale Pro renderer output into Free.
    const sourceHash = computeSourceHash();
    saveCurrentHash(sourceHash);
    saveViteEditionMarker(buildEdition, sourceHash);
  } else {
    console.log('📦 Using cached Vite build output');
  }

  // Re-bundle builtin MCP server as a fully self-contained CJS bundle so it can
  // be executed by an external `node` process (no Electron ASAR support available).
  // electron-vite's externalizeDepsPlugin leaves npm packages as require() calls
  // which the standalone node process cannot resolve from inside app.asar.unpacked.
  // Uses a dedicated script (build-mcp-servers.js) to avoid shell-quoting issues
  // with special characters in esbuild --define values.
  console.log('📦 Bundling builtin MCP servers (self-contained)...');
  execSync(`node "${path.join(__dirname, 'build-mcp-servers.js')}"`, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  // 3. Verify electron-vite output
  const outDir = path.resolve(__dirname, '../out');
  if (!fs.existsSync(outDir)) {
    throw new Error('electron-vite did not generate out/ directory');
  }

  // 4. Validate output structure. This must reject source-only renderer shells;
  // otherwise local fast builds can package a white-screen app.
  const viteOutputValidation = validateViteBuildOutput();
  if (!viteOutputValidation.valid) {
    throw new Error(`Vite build output is incomplete:\n${viteOutputValidation.problems.join('\n')}`);
  }

  // A pack-only run deliberately skips backend resource preparation. Audit
  // the renderer/main/static outputs it did prepare, then stop before Core.
  if (packOnly) {
    execSync('node scripts/audit-release-privacy.cjs --stage-ui', {
      stdio: 'inherit',
      env: process.env,
    });
    console.log('✅ Package completed! (skipped distributable creation)');
    return;
  }

  // 5. Prepare winkgo_core binary (for packaged runtime usage)
  const { prepareWinkGoCore } = require('../packages/shared-scripts/src/prepare-winkgo-core.js');
  const { resolveWinkGoCoreVersion } = require('./resolveWinkGoCoreVersion.js');
  const projectRoot = path.resolve(__dirname, '..');
  writeGeneratedSentryDsnInclude(projectRoot);
  prepareWinkGoCore({
    projectRoot,
    platform: process.platform,
    arch: targetArch,
    version: resolveWinkGoCoreVersion(projectRoot),
  });

  // 6. Prepare hub resources (index.json + extension zips for offline fallback)
  execSync('node scripts/prepareHubResources.js', { stdio: 'inherit', env: process.env });

  // Privacy gate 1/2: inspect the exact Vite/static/backend inputs after every
  // generated release resource has been refreshed for this build.
  execSync('node scripts/audit-release-privacy.cjs --stage', {
    stdio: 'inherit',
    env: process.env,
  });

  // 6. 运行 electron-builder 生成分发包（DMG/ZIP/EXE等）
  // Run electron-builder to create distributables (DMG/ZIP/EXE, etc.)
  // Always disable auto-publish to avoid electron-builder's implicit tag-based publishing
  // Publishing is handled by a separate release job in CI
  const publishArg = '--publish=never';

  // Set compression level based on environment
  // 7za -mx accepts numeric values: 0 (store) to 9 (ultra)
  // CI builds use 9 (maximum) for smallest size
  // Local builds use 7 (normal) for 30-50% faster ASAR packing
  const isCI = process.env.CI === 'true';
  if (!process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL) {
    process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = isCI ? '9' : '7';
  }
  console.log(
    `📦 Compression level: ${process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL} (${isCI ? 'CI build' : 'local build'})`
  );

  // 根据模式添加架构标志
  // Add arch flags based on mode
  let archFlag = '';
  if (multiArch) {
    // 多架构模式：将所有架构标志传递给 electron-builder
    // Multi-arch mode: pass all arch flags to electron-builder
    archFlag = archArgs.map((arch) => `--${arch}`).join(' ');
    console.log(`🚀 Packaging for multiple architectures: ${archArgs.join(', ')}...`);
  } else {
    // 单架构模式：使用确定的目标架构
    // Single arch mode: use the determined target arch
    archFlag = `--${targetArch}`;
    console.log(`🚀 Creating distributables for ${targetArch}...`);
  }

  // 为 Windows 构建添加架构检测脚本
  // Add architecture detection scripts for Windows builds
  // 使用 .onVerifyInstDir 避免与 electron-builder 冲突
  // Use .onVerifyInstDir to avoid conflicts with electron-builder
  let nsisInclude = '';
  if (builderArgs.includes('--win') || builderArgs.includes('--all')) {
    if (!multiArch) {
      // 单架构构建：添加对应架构的检测脚本
      // Single-arch build: Add architecture-specific detection script
      if (targetArch === 'arm64') {
        const arm64Script = 'resources/windows/windows-installer-arm64.nsh';
        if (fs.existsSync(path.resolve(__dirname, '..', arm64Script))) {
          nsisInclude += ` --config.nsis.include="${arm64Script}"`;
          console.log(`📋 Including Windows ARM64 architecture check script`);
        }
        nsisInclude += ' --config.nsis.useZip=true';
        console.log('📋 Using ZIP payload for Windows ARM64 NSIS installer');
      } else if (targetArch === 'x64') {
        const x64Script = 'resources/windows/windows-installer-x64.nsh';
        if (fs.existsSync(path.resolve(__dirname, '..', x64Script))) {
          nsisInclude += ` --config.nsis.include="${x64Script}"`;
          console.log(`📋 Including Windows x64 architecture check script`);
        }
      }
    }
    // 多架构构建：暂不支持架构检测脚本
    // Multi-arch builds: Architecture detection not supported yet
  }

  if (process.platform === 'win32' && builderArgs.includes('--win')) {
    const winUnpackedDir = path.join(outDir, 'win-unpacked');
    let cleaned = tryRemoveDir(winUnpackedDir);
    if (!cleaned) {
      const winkGoRunning = isProcessRunningWindows('WINK-GO.exe') || isProcessRunningWindows('WinkGo.exe');
      const electronRunning = isProcessRunningWindows('electron.exe');
      if (winkGoRunning || electronRunning) {
        console.log('⚠️  Detected running WINK GO/Electron process. Attempting to close...');
        killWindowsProcesses(['WINK-GO.exe', 'WinkGo.exe', 'electron.exe']);
        cleaned = tryRemoveDir(winUnpackedDir);
        if (!cleaned) {
          console.log('⚠️  Directory still locked. Please close any running WINK GO/Electron processes and retry.');
        }
      }
    }
  }

  const isWindowsBuild = builderArgs.includes('--win') || builderArgs.includes('--all');
  if (isWindowsBuild) {
    patchElectronBuilderNsisInstaller();
    cleanupWindowsPackOutput();
  }

  const builderCommand = `bunx electron-builder --config ${builderConfigPath} ${builderArgs} ${archFlag} ${nsisInclude} ${publishArg}`;
  try {
    buildWithDmgRetry(builderCommand, targetArch, builderConfigPath);
  } catch (error) {
    const winExePath = path.join(outDir, 'win-unpacked', 'WINK-GO.exe');
    const firstError = formatExecError(error);
    const canRetryWithoutExecutableEdit =
      process.platform === 'win32' && isWindowsBuild && process.env.CI !== 'true' && fs.existsSync(winExePath);

    if (!canRetryWithoutExecutableEdit) {
      throw error;
    }

    console.log('⚠️  Windows local build failed after WINK-GO.exe was produced.');
    if (firstError) {
      console.log('   First failure summary:');
      console.log(
        firstError
          .split(/\r?\n/)
          .slice(0, 6)
          .map((line) => `   ${line}`)
          .join('\n')
      );
    }
    console.log('   Retrying local build with win.signAndEditExecutable=false...');
    console.log('   This fallback is intended for transient rcedit / file-lock failures on developer machines.');
    killWindowsProcesses(['WINK-GO.exe', 'WinkGo.exe', 'electron.exe']);
    cleanupWindowsPackOutput();

    try {
      buildWithDmgRetry(`${builderCommand} --config.win.signAndEditExecutable=false`, targetArch, builderConfigPath);
    } catch (retryError) {
      const retryFailure = formatExecError(retryError);
      throw new Error(
        [
          'Windows local retry with win.signAndEditExecutable=false also failed.',
          'First failure:',
          firstError || String(error),
          'Retry failure:',
          retryFailure || String(retryError),
        ].join('\n')
      );
    }
  }

  // Privacy gate 2/3: inspect electron-builder's unpacked application payload.
  execSync('node scripts/audit-release-privacy.cjs --packed', {
    stdio: 'inherit',
    env: process.env,
  });

  if (isWindowsBuild) {
    // Privacy gate 3/3: inspect the final NSIS archive and prove that its
    // embedded app.asar is identical to the just-audited win-unpacked ASAR.
    auditFinalWindowsInstallers(buildEdition, targetArch);
    execSync('node scripts/generate-winkgo-update-manifest.js', {
      stdio: 'inherit',
      env: process.env,
    });
  }

  console.log('✅ Build completed!');
} catch (error) {
  buildFailed = true;
  console.error('❌ Build failed:', error.message);
  process.exitCode = 1;
} finally {
  try {
    restorePackageVersionOverride();
  } catch (restoreError) {
    console.error('❌ Failed to restore package.json version:', restoreError.message);
    if (!buildFailed) {
      process.exitCode = 1;
    }
  }
}
