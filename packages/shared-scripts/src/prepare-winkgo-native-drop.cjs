#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MIN_NATIVE_DROP_BYTES = 1024;

function validateNativeDropBinary(binaryPath) {
  if (!fs.existsSync(binaryPath) || fs.statSync(binaryPath).size < MIN_NATIVE_DROP_BYTES) {
    throw new Error(`WINK GO native drop output is missing or incomplete: ${binaryPath}`);
  }
  return fs.statSync(binaryPath).size;
}

function resolveNativeDropPaths(projectRoot, arch, targetRoot) {
  return {
    manifestPath: path.join(projectRoot, 'packages', 'desktop', 'native', 'winkgo-native-drop', 'Cargo.toml'),
    cargoTargetRoot: targetRoot || path.join(os.tmpdir(), `winkgo-native-drop-target-${arch}`),
    outputPath: path.join(projectRoot, 'packages', 'desktop', 'native', 'winkgo_native_drop.node'),
  };
}

function prepareWinkGoNativeDrop(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..', '..', '..'));
  const platform = options.platform || process.platform;
  const arch = options.arch || process.env.WINKGO_NATIVE_DROP_ARCH || process.arch;
  const runner = options.runner || spawnSync;
  const env = options.env || process.env;

  if (platform !== 'win32') return { skipped: true, reason: 'non_windows' };
  if (arch !== process.arch) {
    throw new Error(`WINK GO native drop cross-build is not configured for ${process.arch} -> ${arch}`);
  }

  const paths = resolveNativeDropPaths(projectRoot, arch, options.targetRoot);
  if (!fs.existsSync(paths.manifestPath)) {
    throw new Error(`WINK GO native drop manifest is missing: ${paths.manifestPath}`);
  }

  const result = runner('cargo', ['build', '--release', '--locked', '--manifest-path', paths.manifestPath], {
    cwd: projectRoot,
    env: { ...env, CARGO_TARGET_DIR: paths.cargoTargetRoot },
    stdio: options.stdio || 'inherit',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`WINK GO native drop build failed: ${result.error?.message || `exit ${result.status}`}`);
  }

  const builtDll = path.join(paths.cargoTargetRoot, 'release', 'winkgo_native_drop.dll');
  validateNativeDropBinary(builtDll);
  fs.mkdirSync(path.dirname(paths.outputPath), { recursive: true });
  fs.copyFileSync(builtDll, paths.outputPath);
  const size = validateNativeDropBinary(paths.outputPath);
  console.log(`Prepared WINK GO native drop: ${paths.outputPath} (${size} bytes)`);
  return { skipped: false, outputPath: paths.outputPath, size };
}

if (require.main === module) {
  try {
    prepareWinkGoNativeDrop();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  MIN_NATIVE_DROP_BYTES,
  prepareWinkGoNativeDrop,
  resolveNativeDropPaths,
  validateNativeDropBinary,
};
