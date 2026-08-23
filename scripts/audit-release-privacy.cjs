#!/usr/bin/env node

/**
 * WINK GO release privacy gate.
 *
 * Scans tracked source files, release inputs, unpacked applications, or a
 * final Windows NSIS installer. Final-installer mode extracts
 * NSIS -> app-*.zip -> app.asar and verifies that the installer ASAR is
 * identical to out/win-unpacked.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  findRestrictedLegacyPdfSkillMarkersInBuffer,
  findRestrictedLegacyPdfSkillMarkersInFile,
  inspectCorePdfSkillCompliance,
  isRestrictedLegacyPdfSkillPath,
} = require('../packages/shared-scripts/src/verify-bundled-winkgo-core-resources');

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
const packedRootArgument = readArgument('--packed-root');
const mode = finalExeArgument
  ? 'final-exe'
  : argv.includes('--packed')
    ? 'packed'
    : argv.includes('--source')
      ? 'source'
      : argv.includes('--stage-ui')
        ? 'stage-ui'
        : 'stage';

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
    id: 'legacy-bundled-aioncore',
    pattern: /\bbundled-aioncore\b/i,
  },
  {
    id: 'legacy-aionui-web-host',
    pattern: /@aionui[\\/]web-host\b/i,
  },
  {
    id: 'legacy-aionui-runtime-env',
    pattern: /\bAIONUI_[A-Z0-9_]+\b/,
  },
  {
    id: 'retired-winkgo-github-account',
    pattern: /\b(?:https?:\/\/)?(?:api\.)?github\.com\/(?:repos\/)?xuweihafeichangniu-lab(?:[/?#\s"'`]|$)/i,
  },
  {
    id: 'unexpected-winkgo-github-repository',
    // WINKGO/WinkGo is canonical. Keep the historical wink-go alias valid for
    // already-published metadata while blocking private or retired repositories.
    pattern:
      /\b(?:https?:\/\/)?(?:api\.)?github\.com\/(?:repos\/)?WINKGO\/(?!(?:winkgo|wink-go)(?:\.git)?(?=[/?#\s"'`]|$))[a-z0-9_.-]+(?=[/?#\s"'`]|$)/i,
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
    // Compiled TLS/PEM parsers legitimately contain the BEGIN/END marker
    // strings. A real PEM key has a newline-delimited base64 body between
    // those markers, so require the complete structure before blocking.
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/=]{16,}\r?\n)+-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
];

const stageRoots = [
  'out/main',
  'out/preload',
  'out/renderer',
  'public',
  'resources/winkgo',
  'resources/hub',
  'resources/bundled-winkgo-core',
];
const stageUiRoots = stageRoots.filter((root) => root !== 'resources/bundled-winkgo-core');

const packedRoots = [
  'out/win-unpacked/resources',
  'out/win-x64-unpacked/resources',
  'out/win-arm64-unpacked/resources',
  'out/mac',
  'out/mac-arm64',
  'out/mac-x64',
  'out/mac-universal',
  'out/linux-unpacked',
  'out/linux-x64-unpacked',
  'out/linux-arm64-unpacked',
];

function getAuditRoots(auditMode) {
  return auditMode === 'packed' ? packedRoots : auditMode === 'stage-ui' ? stageUiRoots : stageRoots;
}

const legacyRuntimeRuleIds = new Set([
  'legacy-bundled-aioncore',
  'legacy-aionui-web-host',
  'legacy-aionui-runtime-env',
]);
const legacyRuntimeRules = contentRules.filter((rule) => legacyRuntimeRuleIds.has(rule.id));
const nativeCompilerBinaryExtensions = new Set(['.dll', '.exe', '.node']);
const verifiedUpstreamInventoryDigests = new Map([
  ['docs/vendor/aionui-upstream-inventory.tsv', '024032e60a71224fabb01ce7da5243be18c67653348af5b8e256344fcde9763e'],
  ['docs/vendor/aioncore-upstream-inventory.tsv', '77756f9dda2f3694351abe7c0a39a9a968f8fadde77fe28b71fde469f3d225cd'],
  ['docs/vendor/aionrs-upstream-inventory.tsv', '1642312db6a3e7623b46edee63d429ada8b1c479367eac9ec991037562d44b07'],
]);

function isVerifiedUpstreamInventory(filePath) {
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  const expectedDigest = verifiedUpstreamInventoryDigests.get(relative);
  if (!expectedDigest || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;

  const bytes = fs.readFileSync(filePath);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== expectedDigest) return false;
  const text = bytes.toString('utf8');
  return (
    text.includes('# Canonical upstream inventory for ') &&
    text.includes('# Commit: ') &&
    text.includes('type\tupstream_path\tcurrent_path\tupstream_sha256')
  );
}

function isLegalAttributionFile(filePath) {
  const basename = path.basename(filePath).toLowerCase();
  return (
    /^licen[cs]e(?:\..+)?$/.test(basename) ||
    /^notice(?:\..+)?$/.test(basename) ||
    /^third[-_]party[-_](?:notices?|licenses?)(?:\..+)?$/.test(basename)
  );
}

function shouldSkipContentRule(filePath, ruleId) {
  // Attribution documents may need to name an upstream package or historical
  // runtime. That legal record is not evidence that the runtime ships.
  if (legacyRuntimeRuleIds.has(ruleId) && isLegalAttributionFile(filePath)) return true;
  // The hash-pinned upstream inventories are provenance evidence and can
  // legitimately record retired runtime paths. Copies or modified inventories
  // are not exempt because isVerifiedUpstreamInventory fails closed.
  if (legacyRuntimeRuleIds.has(ruleId) && isVerifiedUpstreamInventory(filePath)) return true;

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

function isExcludedBundledCoreBuildInput(filePath, baseRoot = projectRoot) {
  const relative = path.relative(baseRoot, filePath).replace(/\\/g, '/');
  return /(^|\/)(?:resources\/)?bundled-winkgo-core\/[^/]+\/(?:\.prepare-data(?:\/|$)|managed-resources\/node\/[^/]+\/(?:lib\/)?node_modules\/npm\/(?:docs|man)(?:\/|$)|managed-resources\/node\/[^/]+\/(?:lib\/)?node_modules\/npm\/\.npmrc$)/i.test(
    relative
  );
}

function legacyRuntimePathViolation(filePath, baseRoot = projectRoot) {
  const relative = path.relative(baseRoot, filePath);
  const parts = relative.toLowerCase().split(/[\\/]/);
  if (isLegalAttributionFile(filePath)) return '';

  const bundledAionCorePart = parts.find((part) => /^bundled-aioncore(?:[.@]|$)/.test(part));
  if (bundledAionCorePart) return `legacy-bundled-aioncore-path:${bundledAionCorePart}`;

  if (parts.some((part, index) => part === '@aionui' && parts[index + 1] === 'web-host')) {
    return 'legacy-aionui-web-host-path:@aionui/web-host';
  }
  return '';
}

function forbiddenManagedExternalCliPathViolation(filePath, baseRoot = projectRoot) {
  const relative = path.relative(baseRoot, filePath).replace(/\\/g, '/').toLowerCase();
  if (!/(^|\/)managed-resources\//.test(relative)) return '';
  if (
    /(^|\/)cli\/(claude|codex)(\/|$)/.test(relative) ||
    /(^|\/)node_modules\/@(anthropic-ai\/claude-code|openai\/codex)(-|\/|$)/.test(relative) ||
    /(^|\/)(claude|codex|codex-code-mode-host|codex-command-runner|codex-windows-sandbox-setup)(\.exe)?$/.test(
      relative
    ) ||
    /(^|\/)codex-(path|resources)(\/|$)/.test(relative)
  ) {
    return 'forbidden-bundled-external-cli';
  }
  return '';
}

function physicalPathViolation(filePath, baseRoot = projectRoot, auditMode = mode) {
  const legacyRuntimeViolation = legacyRuntimePathViolation(filePath, baseRoot);
  if (legacyRuntimeViolation) return legacyRuntimeViolation;
  const relative = path.relative(baseRoot, filePath).replace(/\\/g, '/');
  if (isRestrictedLegacyPdfSkillPath(relative)) return 'restricted-legacy-pdf-skill-path';
  const managedCliViolation = forbiddenManagedExternalCliPathViolation(filePath, baseRoot);
  if (managedCliViolation) return managedCliViolation;

  const parts = relative.toLowerCase().split(/[\\/]/);
  const basename = path.basename(relative).toLowerCase();
  if (forbiddenFileNames.has(basename)) return `private-state-file:${basename}`;
  if (/\.(?:key|pem|pfx|p12)$/i.test(basename)) return `private-key-file:${basename}`;
  const forbiddenPart = parts.find((part) => forbiddenPathParts.has(part));
  return forbiddenPart ? `browser-profile-directory:${forbiddenPart}` : '';
}

const forbiddenManagedExternalCliContentRules = [
  { id: 'forbidden-bundled-claude-package', pattern: /@anthropic-ai\/claude-code|Claude Code/ },
  { id: 'forbidden-bundled-codex-package', pattern: /@openai\/codex|OpenAI Codex/ },
];

function scanForbiddenManagedExternalCliContent(filePath, baseRoot) {
  const relative = path.relative(baseRoot, filePath).replace(/\\/g, '/').toLowerCase();
  if (!/(^|\/)managed-resources\//.test(relative) || /(^|\/)managed-resources\/node\//.test(relative)) {
    return [];
  }
  return scanFileContentWithRules(filePath, forbiddenManagedExternalCliContentRules);
}

function scanFileContentWithRules(filePath, rules) {
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
      for (const rule of rules) {
        if (shouldSkipContentRule(filePath, rule.id)) continue;
        if (rule.pattern.test(text)) findings.add(rule.id);
      }
      // Private keys are commonly several kilobytes long and may straddle a
      // scan chunk boundary. Keep enough overlap to match one complete PEM.
      tail = text.slice(-16384);
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return [...findings];
}

function scanFileContent(filePath) {
  const findings = scanFileContentWithRules(filePath, contentRules);
  const restrictedPdfFindings = findRestrictedLegacyPdfSkillMarkersInFile(filePath).filter(
    (ruleId) => !(isVerifiedUpstreamInventory(filePath) && ruleId.startsWith('restricted-pdf-'))
  );
  return [...new Set([...findings, ...restrictedPdfFindings])];
}

function listSourceFiles(sourceRoot = projectRoot) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: sourceRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `Unable to enumerate tracked and untracked non-ignored source files: ${detail || 'git ls-files failed'}`
    );
  }

  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) => {
      const normalized = relativePath.replace(/\\/g, '/');
      return (
        normalized !== 'scripts/audit-release-privacy.cjs' && !/(^|\/)(?:tests?|__tests__)(?:\/|$)/i.test(normalized)
      );
    })
    .map((relativePath) => path.join(sourceRoot, relativePath))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function isAllowedTrackedSourcePathFinding(filePath, rule) {
  if (rule !== 'private-state-file:.npmrc') return false;
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  if (relative !== '.npmrc') return false;

  // The tracked root .npmrc is intentionally comment-only documentation. Any
  // future active npm setting makes the source gate fail closed.
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .every((line) => !line.trim() || line.trimStart().startsWith('#'));
}

function auditSource() {
  const files = listSourceFiles();
  const violations = [];
  for (const filePath of files) {
    const pathViolation = physicalPathViolation(filePath, projectRoot, 'source');
    if (pathViolation && !isAllowedTrackedSourcePathFinding(filePath, pathViolation)) {
      violations.push({ filePath, rule: pathViolation });
      continue;
    }
    for (const rule of scanFileContentWithRules(filePath, legacyRuntimeRules)) {
      violations.push({ filePath, rule });
    }
    for (const rule of findRestrictedLegacyPdfSkillMarkersInFile(filePath)) {
      if (isVerifiedUpstreamInventory(filePath)) continue;
      violations.push({ filePath, rule });
    }
  }
  return { files, violations };
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
    (legacyRuntimeRuleIds.has(rule) && isLegalAttributionFile(memberName)) ||
    (rule === 'private-key' && normalized === 'node_modules/jose/dist/webapi/key/import.js') ||
    (rule === 'login-session-token' && /node_modules\/zod\/src\/.*\/tests\//.test(normalized))
  );
}

function isAllowedPackedFileFinding(filePath, rule) {
  if (mode === 'stage' || rule !== 'private-key') return false;
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return /\/managed-resources\/node\/[^/]+\/node_modules\/npm\/node_modules\/@npmcli\/config\/lib\/definitions\/definitions\.js$/.test(
    normalized
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

    const rawContent = asar.extractFile(filePath, memberName);
    const content = rawContent.toString('latin1').replace(/\0/g, '');
    for (const rule of contentRules) {
      if (rule.pattern.test(content) && !isAllowedArchiveFinding(memberName, rule.id)) {
        violations.push({ filePath, rule: rule.id, label: memberLabel });
      }
    }
    for (const rule of findRestrictedLegacyPdfSkillMarkersInBuffer(rawContent)) {
      if (rule) {
        violations.push({ filePath, rule, label: memberLabel });
      }
    }
  }
  return violations;
}

function isBundledWinkGoCoreBinary(filePath) {
  return /[\\/]bundled-winkgo-core[\\/][^\\/]+[\\/]winkgo_core(?:\.exe)?$/i.test(filePath);
}

function auditAbsoluteRoots(roots, baseRoot = projectRoot) {
  const violations = [];
  // Mirror electron-builder's bundled Core filters so stage mode audits the
  // exact release inputs rather than preparation-only files.
  const files = roots
    .flatMap((root) => walkFiles(root))
    .filter((filePath) => !isExcludedBundledCoreBuildInput(filePath, baseRoot));
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
    if (isBundledWinkGoCoreBinary(filePath)) {
      const compliance = inspectCorePdfSkillCompliance(filePath);
      if (compliance.restricted.length > 0) {
        violations.push({
          filePath,
          rule: 'restricted-legacy-pdf-skill',
          label: `${path.relative(baseRoot, filePath)} (${compliance.restricted.join(', ')})`,
        });
      }
      if (compliance.missing.length > 0) {
        violations.push({
          filePath,
          rule: 'missing-original-pdf-toolkit',
          label: `${path.relative(baseRoot, filePath)} (${compliance.missing.join(', ')})`,
        });
      }
    }
    for (const rule of scanForbiddenManagedExternalCliContent(filePath, baseRoot)) {
      violations.push({ filePath, rule });
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
        'download=https://github.com/WINKGO/private/releases',
        'device_id=63f7ac91-89e8-4b3c-88f3-87ef85916d55',
      ].join('\n')
    );
    const findings = scanFileContent(unsafeFile);
    const expected = [
      'mainland-phone-number',
      'developer-windows-profile',
      'unexpected-winkgo-github-repository',
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
    const forbiddenCli = path.join(root, 'managed-resources', 'cli', 'codex', 'codex.exe');
    if (forbiddenManagedExternalCliPathViolation(forbiddenCli, root) !== 'forbidden-bundled-external-cli') {
      throw new Error('privacy audit self-test did not block a managed external CLI path');
    }
    const sourceManagedCli = path.join(root, 'resources', 'managed-resources', 'cli', 'claude', 'claude.exe');
    if (physicalPathViolation(sourceManagedCli, root, 'source') !== 'forbidden-bundled-external-cli') {
      throw new Error('privacy audit source self-test did not block a managed external CLI');
    }
    const sourceKnowledgeCanvas = path.join(root, 'public', 'knowledge-canvas', 'index.html');
    if (physicalPathViolation(sourceKnowledgeCanvas, root, 'source') !== '') {
      throw new Error('privacy audit source self-test rejected the restored Knowledge Canvas');
    }
    const sourceProviderSkill = path.join(root, 'resources', 'winkgo', 'provider-skills', 'vendor-skill');
    if (physicalPathViolation(sourceProviderSkill, root, 'source') !== '') {
      throw new Error('privacy audit source self-test rejected an allowed WINK GO provider skill');
    }
    const legacyPdfPath = path.join(root, 'backend', 'assets', 'builtin-skills', 'pdf', 'LICENSE.txt');
    if (physicalPathViolation(legacyPdfPath, root, 'source') !== 'restricted-legacy-pdf-skill-path') {
      throw new Error('privacy audit self-test did not block the legacy PDF license path');
    }
    const inventoryRoot = path.join(root, 'source-inventory');
    fs.mkdirSync(inventoryRoot);
    fs.writeFileSync(path.join(inventoryRoot, '.gitignore'), 'ignored.txt\n');
    fs.writeFileSync(path.join(inventoryRoot, 'tracked.txt'), 'tracked');
    fs.writeFileSync(path.join(inventoryRoot, 'untracked.txt'), 'untracked');
    fs.writeFileSync(path.join(inventoryRoot, 'ignored.txt'), 'ignored');
    const initResult = spawnSync('git', ['init', '-q'], { cwd: inventoryRoot, encoding: 'utf8', windowsHide: true });
    const addResult = spawnSync('git', ['add', '.gitignore', 'tracked.txt'], {
      cwd: inventoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (initResult.status !== 0 || addResult.status !== 0) {
      throw new Error('privacy audit self-test could not create a source inventory fixture');
    }
    const inventoriedNames = listSourceFiles(inventoryRoot).map((filePath) => path.basename(filePath));
    if (!inventoriedNames.includes('tracked.txt') || !inventoriedNames.includes('untracked.txt')) {
      throw new Error('privacy audit source self-test omitted tracked or untracked non-ignored files');
    }
    if (inventoriedNames.includes('ignored.txt')) {
      throw new Error('privacy audit source self-test included a gitignored file');
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

  console.log(`WINK GO privacy audit (${label}) passed: ${result.files.length} file(s) scanned.`);
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

  if (mode === 'source') {
    return printResult(mode, auditSource());
  }

  if (mode === 'packed' && packedRootArgument) {
    const packedRoot = path.resolve(packedRootArgument);
    if (!fs.existsSync(packedRoot) || !fs.statSync(packedRoot).isDirectory()) {
      throw new Error(`Packed privacy audit root does not exist or is not a directory: ${packedRoot}`);
    }
    return printResult(mode, auditAbsoluteRoots([packedRoot], projectRoot));
  }

  return printResult(mode, audit(getAuditRoots(mode)));
}

module.exports = {
  auditFinalExe,
  compareInstallerAsar,
  findNestedAppArchive,
  getAuditRoots,
  isExcludedBundledCoreBuildInput,
  listSourceFiles,
  physicalPathViolation,
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
