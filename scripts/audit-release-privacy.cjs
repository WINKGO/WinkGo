#!/usr/bin/env node

/**
 * WINK GO release privacy gate.
 *
 * Scans release inputs, unpacked applications, or a final Windows NSIS
 * installer. Final-installer mode extracts NSIS -> app-*.zip -> app.asar and
 * verifies that the installer ASAR is identical to out/win-unpacked.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const selfTest = argv.includes('--self-test');

function readArgument(name) {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1] || '';
  return argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}

const finalExeArgument = readArgument('--exe');
const packedAsarArgument = readArgument('--packed-asar');
const mode = finalExeArgument ? 'final-exe' : argv.includes('--packed') ? 'packed' : 'stage';

const forbiddenFileNames = new Set([
  '.env',
  '.env.local',
  '.npmrc',
  'accounts.json',
  'auth.json',
  'cookies',
  'credentials.json',
  'device-id.json',
  'device.json',
  'login data',
  'local state',
  'machine-id',
  'remote-gateway.json',
  'web data',
  'winkgo.installation.json',
  'winkgo.license.config.json',
  'winkgo.license.session.json',
  'winkgo.auth-session-policy.json',
]);

const forbiddenPathParts = new Set([
  'cache_storage',
  'code cache',
  'gpucache',
  'indexeddb',
  'local storage',
  '__pycache__',
  'session storage',
  'user data',
]);

const contentRules = [
  {
    id: 'personal-github-account',
    pattern: /\bxuweihafeichangniu-lab\b/i,
  },
  {
    id: 'developer-windows-profile',
    pattern:
      /\bC:[\\/]+Users[\\/]+(?!(?:Public|Default|Default User|All Users|me|ich|yo|moi)(?:[\\/]|$))[^\\/:\r\n]+(?:[\\/]|$)/i,
  },
  {
    id: 'developer-workspace',
    pattern: /\b[A-Z]:[\\/]+winkgo(?:[\\/]|$)/i,
  },
  {
    id: 'mainland-phone-number',
    pattern: /(?:phone|mobile|telephone|手机号|手机号码|联系电话)[^0-9\r\n]{0,48}1[3-9][0-9]{9}(?:[^0-9]|$)/i,
  },
  {
    id: 'openai-compatible-secret',
    // winkgo_core's protocol detector stores these provider-name markers next to
    // one another in its binary. The concatenated marker is not a credential.
    pattern: /\bsk-(?!(?:propertize|ant-AIzaanthropicgenerativelanguage)\b)[A-Za-z0-9_-]{32,}\b/,
  },
  {
    id: 'anthropic-secret',
    pattern: /\bsk-ant-(?:api\d+-)?[A-Za-z0-9_-]{32,}\b/,
  },
  {
    id: 'google-api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/,
  },
  {
    id: 'github-access-token',
    pattern: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  },
  {
    id: 'slack-access-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
  {
    id: 'login-session-token',
    pattern:
      /(?:access[_-]?token|refresh[_-]?token|session[_-]?(?:id|token)|authorization)[\s"'=:]{1,24}(?:Bearer\s+)?eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/i,
  },
  {
    id: 'device-identity',
    pattern:
      /(?:device[_-]?id|installation[_-]?id|machine[_-]?id|fingerprint)[\s"'=:]{1,24}[0-9a-f]{8}-[0-9a-f-]{20,}/i,
  },
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
];

const stageRoots = ['out/main', 'out/preload', 'out/renderer', 'public', 'resources/winkgo', 'resources/hub'];

const packedRoots = ['out/win-unpacked/resources', 'out/mac', 'out/linux-unpacked'];

const nativeCompilerBinaryExtensions = new Set(['.dll', '.exe', '.node']);

function shouldSkipContentRule(filePath, ruleId) {
  // Prebuilt native modules and CLI executables can retain PDB/source paths
  // from their upstream build machine. Those strings are not WINK GO user
  // state. Keep every credential, account, phone, token, device and key rule
  // active for these binaries; only suppress this single compiler-path rule.
  return (
    ruleId === 'developer-windows-profile' && nativeCompilerBinaryExtensions.has(path.extname(filePath).toLowerCase())
  );
}

function walkFiles(root, files = []) {
  if (!fs.existsSync(root)) return files;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    files.push(root);
    return files;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    // Generated Python caches are excluded by electron-builder.
    if (entry.name === '__pycache__' || entry.name.toLowerCase().endsWith('.pyc')) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(target, files);
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function physicalPathViolation(filePath, baseRoot = projectRoot) {
  const relative = path.relative(baseRoot, filePath);
  const parts = relative.toLowerCase().split(/[\\/]/);
  const basename = path.basename(relative).toLowerCase();
  if (forbiddenFileNames.has(basename)) return `private-state-file:${basename}`;
  if (/\.(?:key|pem|pfx|p12)$/i.test(basename)) return `private-key-file:${basename}`;
  const forbiddenPart = parts.find((part) => forbiddenPathParts.has(part));
  return forbiddenPart ? `browser-profile-directory:${forbiddenPart}` : '';
}

function scanFileContent(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size === 0) return [];

  const findings = new Set();
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  let tail = '';
  try {
    while (position < stat.size) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      // Removing NULs also catches UTF-16LE paths embedded in Windows binaries.
      const text = `${tail}${buffer.subarray(0, bytesRead).toString('latin1').replace(/\0/g, '')}`;
      for (const rule of contentRules) {
        if (shouldSkipContentRule(filePath, rule.id)) continue;
        if (rule.pattern.test(text)) findings.add(rule.id);
      }
      tail = text.slice(-1024);
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return [...findings];
}

function loadAsarModule() {
  try {
    return require('@electron/asar');
  } catch {
    const bunModulesRoot = path.join(projectRoot, 'node_modules', '.bun');
    const packageDir = fs
      .readdirSync(bunModulesRoot, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.startsWith('@electron+asar@'));
    if (!packageDir) throw new Error('Unable to locate @electron/asar for release privacy inspection.');
    return require(path.join(bunModulesRoot, packageDir.name, 'node_modules', '@electron', 'asar'));
  }
}

function isAllowedArchiveFinding(memberName, rule) {
  const normalized = memberName.replace(/\\/g, '/').toLowerCase();
  return (
    (rule === 'private-key' && normalized === 'node_modules/jose/dist/webapi/key/import.js') ||
    (rule === 'login-session-token' && /node_modules\/zod\/src\/.*\/tests\//.test(normalized))
  );
}

function isAllowedPackedFileFinding(filePath, rule) {
  if (mode === 'stage' || rule !== 'private-key') return false;
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return (
    /\/managed-resources\/cli\/claude\/[^/]+\/win32-x64\/claude\.exe$/.test(normalized) ||
    /\/managed-resources\/node\/[^/]+\/node_modules\/npm\/node_modules\/@npmcli\/config\/lib\/definitions\/definitions\.js$/.test(
      normalized
    )
  );
}

function scanAsarArchive(filePath, baseRoot = projectRoot) {
  const asar = loadAsarModule();
  const violations = [];
  for (const listedName of asar.listPackage(filePath)) {
    const memberName = listedName.replace(/^[\\/]+/, '');
    const entry = asar.statFile(filePath, memberName, false);
    if (entry.files || entry.unpacked) continue;

    const memberLabel = `${path.relative(baseRoot, filePath)}::${memberName}`;
    const pathViolation = physicalPathViolation(path.join(filePath, memberName), baseRoot);
    if (pathViolation) {
      violations.push({ filePath, rule: pathViolation, label: memberLabel });
      continue;
    }

    const content = asar.extractFile(filePath, memberName).toString('latin1').replace(/\0/g, '');
    for (const rule of contentRules) {
      if (rule.pattern.test(content) && !isAllowedArchiveFinding(memberName, rule.id)) {
        violations.push({ filePath, rule: rule.id, label: memberLabel });
      }
    }
  }
  return violations;
}

function auditAbsoluteRoots(roots, baseRoot = projectRoot) {
  const violations = [];
  const files = roots.flatMap((root) => walkFiles(root));
  for (const filePath of [...new Set(files)]) {
    const pathViolation = physicalPathViolation(filePath, baseRoot);
    if (pathViolation) {
      violations.push({ filePath, rule: pathViolation });
      continue;
    }
    if (path.extname(filePath).toLowerCase() === '.asar') {
      violations.push(...scanAsarArchive(filePath, baseRoot));
      continue;
    }
    for (const rule of scanFileContent(filePath)) {
      if (!isAllowedPackedFileFinding(filePath, rule)) {
        violations.push({ filePath, rule });
      }
    }
  }
  return { files, violations };
}

function audit(roots) {
  return auditAbsoluteRoots(
    roots.map((relativeRoot) => path.join(projectRoot, relativeRoot)),
    projectRoot
  );
}

function resolve7zCommand() {
  const explicit = String(process.env.WINKGO_7Z_PATH || '').trim();
  if (explicit) return explicit;

  const executableName = process.platform === 'win32' ? '7za.exe' : '7za';
  const bunModulesRoot = path.join(projectRoot, 'node_modules', '.bun');
  if (fs.existsSync(bunModulesRoot)) {
    const packageDir = fs
      .readdirSync(bunModulesRoot, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.startsWith('7zip-bin@'));
    if (packageDir) {
      const packageRoot = path.join(bunModulesRoot, packageDir.name, 'node_modules', '7zip-bin');
      const platformCandidates =
        process.platform === 'win32'
          ? [path.join(packageRoot, 'win', process.arch === 'arm64' ? 'arm64' : 'x64', executableName)]
          : [
              path.join(packageRoot, process.platform, process.arch, executableName),
              path.join(packageRoot, process.platform, 'x64', executableName),
            ];
      const bundled = platformCandidates.find((candidate) => fs.existsSync(candidate));
      if (bundled) return bundled;
    }
  }
  return '7z';
}

function run7z(args) {
  const command = resolve7zCommand();
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`7z extraction failed (${command} ${args.join(' ')}): ${detail || 'unknown error'}`);
  }
}

function findNestedAppArchive(outerRoot) {
  const archives = walkFiles(outerRoot).filter((filePath) =>
    /^app-(?:32|64|arm64)\.zip$/i.test(path.basename(filePath))
  );
  if (archives.length !== 1) {
    throw new Error(`Expected exactly one app-*.zip in final installer; found ${archives.length}.`);
  }
  return archives[0];
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function compareInstallerAsar(installerAsar, packedAsar) {
  if (!fs.existsSync(packedAsar)) {
    return {
      filePath: installerAsar,
      rule: 'missing-packed-asar-reference',
      label: `installer=${installerAsar}; packed=${packedAsar}`,
    };
  }

  const installerHash = sha256(installerAsar);
  const packedHash = sha256(packedAsar);
  if (installerHash === packedHash) return null;
  return {
    filePath: installerAsar,
    rule: 'installer-packed-asar-mismatch',
    label: `installer=${installerHash}; packed=${packedHash}; reference=${packedAsar}`,
  };
}

function auditFinalExe(exePath, packedAsarPath) {
  const resolvedExe = path.resolve(exePath);
  if (!fs.existsSync(resolvedExe) || path.extname(resolvedExe).toLowerCase() !== '.exe') {
    throw new Error(`Final NSIS installer does not exist or is not an .exe: ${resolvedExe}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'winkgo-final-exe-audit-'));
  const outerRoot = path.join(tempRoot, 'outer');
  const payloadRoot = path.join(tempRoot, 'payload');
  fs.mkdirSync(outerRoot, { recursive: true });
  fs.mkdirSync(payloadRoot, { recursive: true });

  try {
    run7z(['x', resolvedExe, `-o${outerRoot}`, '-y']);
    const nestedArchive = findNestedAppArchive(outerRoot);
    run7z(['x', nestedArchive, `-o${payloadRoot}`, '-y']);

    const installerAsar = path.join(payloadRoot, 'resources', 'app.asar');
    if (!fs.existsSync(installerAsar)) {
      throw new Error(`Final installer payload is missing resources/app.asar: ${resolvedExe}`);
    }

    const result = auditAbsoluteRoots([payloadRoot], payloadRoot);
    const packedAsar = path.resolve(
      packedAsarPath || path.join(projectRoot, 'out', 'win-unpacked', 'resources', 'app.asar')
    );
    const mismatch = compareInstallerAsar(installerAsar, packedAsar);
    if (mismatch) result.violations.unshift(mismatch);
    return result;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winkgo-privacy-audit-'));
  try {
    const unsafeFile = path.join(root, 'payload.txt');
    fs.writeFileSync(
      unsafeFile,
      [
        'user phone: 13800138000',
        'path=C:\\Users\\ReleaseEngineer\\Desktop',
        'download=https://github.com/xuweihafeichangniu-lab/private/releases',
        'device_id=63f7ac91-89e8-4b3c-88f3-87ef85916d55',
      ].join('\n')
    );
    const findings = scanFileContent(unsafeFile);
    const expected = [
      'mainland-phone-number',
      'developer-windows-profile',
      'personal-github-account',
      'device-identity',
    ];
    if (expected.some((rule) => !findings.includes(rule))) {
      throw new Error(`privacy audit self-test missed rules: ${expected.filter((rule) => !findings.includes(rule))}`);
    }

    const installerAsar = path.join(root, 'installer.asar');
    const packedAsar = path.join(root, 'packed.asar');
    fs.writeFileSync(installerAsar, 'installer');
    fs.writeFileSync(packedAsar, 'packed');
    if (compareInstallerAsar(installerAsar, packedAsar)?.rule !== 'installer-packed-asar-mismatch') {
      throw new Error('privacy audit self-test did not block mismatched installer and packed ASAR files');
    }
    console.log('WINK GO release privacy audit self-test passed.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function printResult(label, result) {
  if (!result.files.length) {
    console.error(`WINK GO privacy audit (${label}) found no release files to scan.`);
    return 1;
  }

  if (result.violations.length) {
    console.error(`WINK GO privacy audit (${label}) blocked the release:`);
    for (const violation of result.violations.slice(0, 50)) {
      console.error(`- [${violation.rule}] ${violation.label || path.relative(projectRoot, violation.filePath)}`);
    }
    if (result.violations.length > 50) {
      console.error(`- ...and ${result.violations.length - 50} more violation(s)`);
    }
    return 1;
  }

  console.log(`WINK GO privacy audit (${label}) passed: ${result.files.length} release file(s) scanned.`);
  return 0;
}

function main() {
  if (selfTest) {
    runSelfTest();
    return 0;
  }

  if (mode === 'final-exe') {
    return printResult(mode, auditFinalExe(finalExeArgument, packedAsarArgument));
  }

  const roots = mode === 'packed' ? packedRoots : stageRoots;
  return printResult(mode, audit(roots));
}

module.exports = {
  auditFinalExe,
  compareInstallerAsar,
  findNestedAppArchive,
  scanFileContent,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`WINK GO privacy audit (${mode}) failed closed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
