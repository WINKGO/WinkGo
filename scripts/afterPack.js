// Modified from AionUI by WINK GO contributors in 2026.
const { Arch } = require('builder-util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  normalizeArch,
  rebuildSingleModule,
  verifyModuleBinary,
  getModulesToRebuild,
} = require('./rebuildNativeModules');
const {
  verifyBundledWinkGoCoreResources,
} = require('../packages/shared-scripts/src/verify-bundled-winkgo-core-resources');

/**
 * afterPack hook for electron-builder
 * Rebuilds native modules for cross-architecture builds
 */

function resolveResourcesDir(electronPlatformName, appOutDir, packager) {
  if (electronPlatformName !== 'darwin') return path.join(appOutDir, 'resources');

  const appName = packager?.appInfo?.productFilename || 'WINK GO';
  return path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
}

function verifyBundledResources(resourcesDir, electronPlatformName, targetArch) {
  const result = verifyBundledWinkGoCoreResources({
    resourcesDir,
    electronPlatformName,
    targetArch,
  });

  if (result.missing.length > 0) {
    console.error(`   Missing bundled resources: ${result.missing.join(', ')}`);
    throw new Error(`Packaged app is missing required bundled resource(s): ${result.missing.join(', ')}`);
  }

  if (electronPlatformName === 'win32') {
    const nativeDropPath = path.join(resourcesDir, 'native', 'winkgo_native_drop.node');
    if (!fs.existsSync(nativeDropPath) || fs.statSync(nativeDropPath).size < 1024) {
      throw new Error(`WINK GO native drop addon is missing or incomplete: ${nativeDropPath}`);
    }
    console.log(`   ✓ WINK GO native drop verified for ${targetArch}`);
  }

  console.log(`   ✓ Bundled resources verified for ${result.runtimeKey} (${result.checked.length} checks)`);
}

function verifyBuiltinMcpScripts(resourcesDir) {
  const unpackedMainDir = path.join(resourcesDir, 'app.asar.unpacked', 'out', 'main');
  const requiredScripts = ['builtin-mcp-image-gen.js', 'builtin-mcp-browser.js', 'builtin-mcp-browser-skills.js'];
  const missing = requiredScripts.filter((fileName) => {
    const scriptPath = path.join(unpackedMainDir, fileName);
    return !fs.existsSync(scriptPath) || fs.statSync(scriptPath).size === 0;
  });

  if (missing.length > 0) {
    throw new Error(`Packaged app is missing required builtin MCP script(s): ${missing.join(', ')}`);
  }

  console.log(`   ✓ Builtin MCP scripts verified (${requiredScripts.length} checks)`);
}

function verifyLegalDocuments(resourcesDir) {
  const requiredLegalDocuments = {
    LICENSE: ['Apache License'],
    NOTICE: ['AionUi', 'WINK GO'],
    'THIRD_PARTY_NOTICES.md': ['AionUi', 'Apache License 2.0'],
    'THIRD_PARTY_DEPENDENCIES.json': ['"schemaVersion": 1', '"npmPackages"', '"cargoPackages"'],
    'THIRD_PARTY_LICENSES.txt': ['WINKGO THIRD-PARTY LICENSE TEXT ARCHIVE', 'Packages:'],
    'vendor/wry-0.55.1/LICENSE-APACHE': ['Apache License', 'Version 2.0'],
    'vendor/wry-0.55.1/LICENSE-MIT': ['MIT License', 'Tauri Programme'],
    'vendor/wry-0.55.1/SOURCE.md': ['Wry', 'a5bf203a1c8dbb3583588382538d6521655222a8'],
    'vendor/wry-0.55.1/MODIFICATIONS.md': ['WINK GO modifications', 'N-API'],
    'PRIVACY.md': ['Privacy Policy', '1394748660@qq.com'],
    'TERMS.md': ['Terms of Service', '1394748660@qq.com'],
  };
  const invalid = [];
  for (const [fileName, requiredMarkers] of Object.entries(requiredLegalDocuments)) {
    const documentPath = path.join(resourcesDir, 'legal', fileName);
    if (!fs.existsSync(documentPath) || fs.statSync(documentPath).size === 0) {
      invalid.push(fileName);
      continue;
    }
    const content = fs.readFileSync(documentPath, 'utf8');
    if (requiredMarkers.some((marker) => !content.includes(marker))) invalid.push(fileName);
  }
  if (invalid.length > 0) {
    throw new Error(`Packaged app has missing or invalid legal document(s): ${invalid.join(', ')}`);
  }
  console.log(`   ✓ Legal documents verified (${Object.keys(requiredLegalDocuments).length} checks)`);
}

function fileContainsAnyMarker(filePath, markers) {
  const descriptor = fs.openSync(filePath, 'r');
  const chunkSize = 1024 * 1024;
  const maxMarkerLength = Math.max(...markers.map((marker) => marker.length));
  const buffer = Buffer.alloc(chunkSize);
  let carry = Buffer.alloc(0);
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, chunkSize, null);
      if (bytesRead === 0) return false;
      const combined = Buffer.concat([carry, buffer.subarray(0, bytesRead)]).toString('latin1');
      if (markers.some((marker) => combined.includes(marker))) return true;
      carry = Buffer.from(combined.slice(-(maxMarkerLength - 1)), 'latin1');
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function verifyNoRuntimeSharpLibvips(resourcesDir) {
  const forbiddenPath = /(?:^|[\\/])node_modules[\\/](?:sharp|@img[\\/]sharp-)|libvips(?:-42)?\.(?:dll|so|dylib)$/i;
  const forbiddenMarkers = [
    'node_modules/sharp/',
    'node_modules\\sharp\\',
    'node_modules/@img/sharp-',
    'node_modules\\@img\\sharp-',
    'libvips-42.dll',
    'libvips.so',
    'libvips.dylib',
  ];
  const pending = [resourcesDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const relativePath = path.relative(resourcesDir, entryPath);
      if (forbiddenPath.test(relativePath)) {
        throw new Error(`Packaged app contains build-only sharp/libvips payload: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && (entry.name === 'app.asar' || forbiddenPath.test(entry.name))) {
        if (fileContainsAnyMarker(entryPath, forbiddenMarkers)) {
          throw new Error(`Packaged app contains build-only sharp/libvips marker: ${relativePath}`);
        }
      }
    }
  }
  console.log('   ✓ Build-only sharp/libvips payload is absent');
}

function pruneOtherBundledRuntimes(resourcesDir, electronPlatformName, targetArch) {
  const runtimeRoot = path.join(resourcesDir, 'bundled-winkgo-core');
  const currentRuntimeKey = `${electronPlatformName}-${targetArch}`;
  if (!fs.existsSync(runtimeRoot)) return;

  for (const entry of fs.readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === currentRuntimeKey) continue;
    if (!/^(win32|darwin|linux)-(x64|arm64)$/.test(entry.name)) continue;

    const staleRuntimeDir = path.join(runtimeRoot, entry.name);
    fs.rmSync(staleRuntimeDir, { recursive: true, force: true });
    console.log(`   ✓ Removed non-target bundled runtime ${entry.name}`);
  }
}

function pruneBundledRuntimeDocumentation(resourcesDir, electronPlatformName, targetArch) {
  const managedResourcesRoot = path.join(
    resourcesDir,
    'bundled-winkgo-core',
    `${electronPlatformName}-${targetArch}`,
    'managed-resources',
    'node'
  );
  if (!fs.existsSync(managedResourcesRoot)) return;

  for (const runtimeEntry of fs.readdirSync(managedResourcesRoot, { withFileTypes: true })) {
    if (!runtimeEntry.isDirectory()) continue;
    const npmRoot = path.join(managedResourcesRoot, runtimeEntry.name, 'node_modules', 'npm');
    if (!fs.existsSync(npmRoot)) continue;

    for (const relativeTarget of ['.npmrc', 'docs', 'man']) {
      fs.rmSync(path.join(npmRoot, relativeTarget), { recursive: true, force: true });
    }
    console.log(`   ✓ Removed non-runtime npm metadata from ${runtimeEntry.name}`);
  }
}

function pruneNativeBuildIntermediates(moduleRoot, moduleName) {
  if (moduleName !== 'better-sqlite3') return;

  const buildDir = path.join(moduleRoot, 'build');
  const releaseDir = path.join(buildDir, 'Release');
  const binaryPath = path.join(releaseDir, 'better_sqlite3.node');
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Cannot prune ${moduleName} build intermediates: runtime binary is missing`);
  }

  const binaryMode = fs.statSync(binaryPath).mode;
  const quarantineRoot = fs.mkdtempSync(path.join(path.resolve(process.cwd(), 'out'), '.winkgo-native-build-'));
  const quarantinedBuild = path.join(quarantineRoot, 'build');
  try {
    // Moving the compiler tree out of win-unpacked is atomic on the same
    // volume and remains reliable on Windows hosts where antivirus/file-index
    // hooks can make recursive deletion appear successful without removing
    // every project or tlog file.
    fs.renameSync(buildDir, quarantinedBuild);
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.copyFileSync(path.join(quarantinedBuild, 'Release', 'better_sqlite3.node'), binaryPath);
    fs.chmodSync(binaryPath, binaryMode);
  } finally {
    fs.rmSync(quarantineRoot, { recursive: true, force: true });
  }

  console.log(`     ✓ Removed ${moduleName} compiler intermediates; kept only the runtime binary`);
}

module.exports = async function afterPack(context) {
  const { arch, electronPlatformName, appOutDir, packager } = context;
  const targetArch = normalizeArch(typeof arch === 'string' ? arch : Arch[arch] || process.arch);
  const buildArch = normalizeArch(os.arch());

  console.log(`\n🔧 afterPack hook started`);
  console.log(`   Platform: ${electronPlatformName}, Build arch: ${buildArch}, Target arch: ${targetArch}`);

  const isCrossCompile = buildArch !== targetArch;
  const forceRebuild = process.env.FORCE_NATIVE_REBUILD === 'true';
  const needsSameArchRebuild = electronPlatformName === 'win32'; // 只有 Windows 需要同架构重建以匹配 Electron ABI | Only Windows needs same-arch rebuild to match Electron ABI
  // Linux 使用预编译二进制，避免 GLIBC 版本依赖 | Linux uses prebuilt binaries which are GLIBC-independent

  const resourcesDir = resolveResourcesDir(electronPlatformName, appOutDir, packager);
  console.log(`   Checking resources directory: ${resourcesDir}`);
  if (fs.existsSync(resourcesDir)) {
    const resourcesContents = fs.readdirSync(resourcesDir);
    console.log(`   Contents: ${resourcesContents.join(', ')}`);

    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
    if (fs.existsSync(unpackedDir)) {
      const unpackedContents = fs.readdirSync(unpackedDir);
      console.log(`   app.asar.unpacked contents: ${unpackedContents.join(', ')}`);

      const nodeModulesDir = path.join(unpackedDir, 'node_modules');
      if (fs.existsSync(nodeModulesDir)) {
        const modulesContents = fs.readdirSync(nodeModulesDir);
        console.log(`   node_modules contents: ${modulesContents.slice(0, 10).join(', ')}...`);
      } else {
        console.warn(`   ⚠️  node_modules not found in app.asar.unpacked`);
      }
    } else {
      console.warn(`   ⚠️  app.asar.unpacked not found`);
    }

    verifyBundledResources(resourcesDir, electronPlatformName, targetArch);
    verifyBuiltinMcpScripts(resourcesDir);
    verifyLegalDocuments(resourcesDir);
    verifyNoRuntimeSharpLibvips(resourcesDir);
    // Keep every capability for the target machine, but do not make an x64
    // customer unpack the unused ARM64 runtime (or vice versa).
    pruneOtherBundledRuntimes(resourcesDir, electronPlatformName, targetArch);
    // npm documentation and its empty repository-level .npmrc are not used by
    // the embedded runtime. Removing them reduces the installer and prevents
    // package metadata from looking like customer configuration.
    pruneBundledRuntimeDocumentation(resourcesDir, electronPlatformName, targetArch);
  } else {
    throw new Error(`resources directory not found: ${resourcesDir}`);
  }

  if (!isCrossCompile && !needsSameArchRebuild && !forceRebuild) {
    console.log(`   ✓ Same architecture, rebuild skipped (set FORCE_NATIVE_REBUILD=true to override)\n`);
    return;
  }

  // Note: Previously there was an optimization to skip macOS cross-compilation,
  // but this caused incorrect architecture binaries (arm64) to be included in x64 builds.
  // Now we always rebuild native modules for cross-compilation to ensure correctness.
  // The rebuild process uses prebuild-install first (fast), falling back to source compilation only when needed.

  if (isCrossCompile) {
    console.log(`   ⚠️  Cross-compilation detected (${buildArch} → ${targetArch}), will rebuild native modules`);
    if (electronPlatformName === 'darwin') {
      console.log(`   💡 Using prebuild-install for faster cross-architecture build`);
    }
  } else if (needsSameArchRebuild || forceRebuild) {
    console.log(`   ℹ️  Rebuilding native modules for platform requirements (force=${forceRebuild})`);
  }

  console.log(`\n🔧 Checking native modules (${electronPlatformName}-${targetArch})...`);
  console.log(`   appOutDir: ${appOutDir}`);

  const electronVersion =
    packager?.info?.electronVersion ??
    packager?.config?.electronVersion ??
    require('../package.json').devDependencies?.electron?.replace(/^\D*/, '');

  const nodeModulesDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');

  // Modules that need to be rebuilt for cross-compilation
  // Use platform-specific module list (Windows skips node-pty due to cross-compilation issues)
  const modulesToRebuild = getModulesToRebuild(electronPlatformName);
  console.log(`   Modules to rebuild: ${modulesToRebuild.join(', ')}`);

  // For cross-compilation, clean up build artifacts from the wrong architecture
  // This prevents node-gyp-build from loading incorrect binaries
  if (isCrossCompile) {
    console.log(`\n🧹 Cleaning up wrong-architecture build artifacts...`);
    for (const moduleName of modulesToRebuild) {
      const moduleRoot = path.join(nodeModulesDir, moduleName);
      if (!fs.existsSync(moduleRoot)) continue;

      // Remove build/ directory (contains wrong-arch compiled binaries)
      const buildDir = path.join(moduleRoot, 'build');
      if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/build/`);
      }

      // Remove bin/ directory (might contain wrong-arch binaries)
      const binDir = path.join(moduleRoot, 'bin');
      if (fs.existsSync(binDir)) {
        fs.rmSync(binDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/bin/`);
      }
    }

    // Also clean up architecture-specific packages that shouldn't be included
    // Remove packages for the opposite architecture of the target
    const wrongArchSuffix = targetArch === 'arm64' ? 'x64' : 'arm64';
    console.log(`\n🧹 Removing ${wrongArchSuffix}-specific optional dependencies (target: ${targetArch})...`);

    if (fs.existsSync(nodeModulesDir)) {
      const allModules = fs.readdirSync(nodeModulesDir);
      for (const module of allModules) {
        const modulePath = path.join(nodeModulesDir, module);

        // Handle scoped packages (e.g., @lydell, @napi-rs)
        if (module.startsWith('@') && fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
          const scopedPackages = fs.readdirSync(modulePath);
          for (const pkg of scopedPackages) {
            if (pkg.includes(`-${wrongArchSuffix}`) || pkg.includes(`-${electronPlatformName}-${wrongArchSuffix}`)) {
              const pkgPath = path.join(modulePath, pkg);
              if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isDirectory()) {
                fs.rmSync(pkgPath, { recursive: true, force: true });
                console.log(`   ✓ Removed ${module}/${pkg}`);
              }
            }
          }
        }
        // Handle regular packages
        else if (
          module.includes(`-${wrongArchSuffix}`) ||
          module.includes(`-${electronPlatformName}-${wrongArchSuffix}`)
        ) {
          if (fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
            fs.rmSync(modulePath, { recursive: true, force: true });
            console.log(`   ✓ Removed ${module}`);
          }
        }
      }
    }
  }

  const failedModules = [];

  for (const moduleName of modulesToRebuild) {
    const moduleRoot = path.join(nodeModulesDir, moduleName);

    if (!fs.existsSync(moduleRoot)) {
      console.warn(`   ⚠️  ${moduleName} not found, skipping`);
      continue;
    }

    console.log(`   ✓ Found ${moduleName}, rebuilding for ${targetArch}...`);

    // For Windows, prefer prebuild-install first (faster and more reliable in CI)
    // electron-rebuild can hang on "Searching dependency tree" in some CI environments
    // prebuild-install will fall back to electron-rebuild internally if no prebuilt binary exists
    const forceRebuildFromSource = false; // Always try prebuild-install first

    const success = rebuildSingleModule({
      moduleName,
      moduleRoot,
      platform: electronPlatformName,
      arch: targetArch,
      electronVersion,
      projectRoot: path.resolve(__dirname, '..'),
      buildArch: buildArch, // Pass build architecture for cross-compile detection
      forceRebuild: forceRebuildFromSource, // Always try prebuild-install first, fallback to rebuild
    });

    if (success) {
      console.log(`     ✓ Rebuild completed`);
    } else {
      console.error(`     ✗ Rebuild failed`);
      failedModules.push(moduleName);
      continue;
    }

    const verified = verifyModuleBinary(moduleRoot, moduleName);
    if (verified) {
      console.log(`     ✓ Binary verification passed`);
      pruneNativeBuildIntermediates(moduleRoot, moduleName);
    } else {
      console.error(`     ✗ Binary verification failed`);
      failedModules.push(moduleName);
    }

    console.log(''); // Empty line between modules
  }

  if (failedModules.length > 0) {
    throw new Error(`Failed to rebuild modules for ${electronPlatformName}-${targetArch}: ${failedModules.join(', ')}`);
  }

  console.log(`✅ All native modules rebuilt successfully for ${targetArch}\n`);
};
