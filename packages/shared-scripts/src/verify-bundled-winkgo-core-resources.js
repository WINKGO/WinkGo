const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FORBIDDEN_MANAGED_CLI_NAMES = new Set(['claude', 'codex']);
const FORBIDDEN_MANAGED_CLI_PACKAGE_MARKERS = ['@anthropic-ai/claude-code', '@openai/codex'];
const FORBIDDEN_MANAGED_CLI_PATH =
  /(?:^|\/)(?:cli\/(?:claude|codex)(?:\/|$)|node_modules\/@(?:anthropic-ai\/claude-code|openai\/codex)(?:[-/]|$)|claude(?:\.exe)?$|codex(?:\.exe)?$|codex-code-mode-host(?:\.exe)?$|codex-command-runner(?:\.exe)?$|codex-windows-sandbox-setup(?:\.exe)?$|codex-path(?:\/|$)|codex-resources(?:\/|$))/i;
const ORIGINAL_PDF_TOOLKIT_MARKERS = [
  {
    id: 'pdf-toolkit-skill-path',
    value: ['pdf-toolkit', '/SKILL.md'].join(''),
  },
  {
    id: 'pdf-toolkit-skill-name',
    value: ['name: pdf', '-toolkit'].join(''),
  },
  {
    id: 'pdf-toolkit-apache-license',
    value: ['This original skill is distributed under the ', 'Apache License 2.0.'].join(''),
  },
];
const RESTRICTED_LEGACY_PDF_SKILL_MARKERS = [
  {
    id: 'restricted-pdf-skill-path',
    value: ['pdf', '/SKILL.md'].join(''),
  },
  {
    id: 'restricted-pdf-license-path',
    value: ['pdf', '/LICENSE.txt'].join(''),
  },
];

// SHA-256 values identify exact legacy files without retaining their
// redistribution-restricted prose in this repository. The set covers both the
// pinned upstream AionCore files and the previously published derivative cache.
const RESTRICTED_LEGACY_PDF_FILE_SHA256 = new Set([
  '0a7a87b00f6197a261ec06496532c039435d976359ed0a9ee8513de642ecf274',
  '79f6d8f5b427252fa3b1c11ecdbdb6bf610b944f7530b4de78f770f38741cfaa',
  '15fd89bd38c6c43df3225e036eea5ce1217c7d8279ebd20a4502e224b8d37c14',
  '850afad5baf232d5d0712c98cc57e09969e7e5a05cd72e339b1923a22a05d682',
  '7a0a9a66d3edb216cbe6b240dd5b0ebac7502f4f5ce5b59949eccaf051632333',
  '56c4f47a57cf6e4772204ad6c5f480088b987e56f2feec32da2729884560c305',
  '6a40b32a66d9fd0acb490464316c3d0c36e48f0d890d4c719378708109b15698',
  'b4e14c9c71c8e2bc333a57f30f65fd403ccf54a85c50a2e7f6911978b3620109',
  '7f4ca473573890aafbc70ef9dadc27084c5951eb0fe526f7c6e38819a898cd90',
  '67d492bffd2c45521a3c3f9f69822057acffca3a5bfdcae50d0e2753a09c3434',
  'e9bbe4832befd54052d08908d6b00bf1e18b191f8ec6f2f6d8a69ddf84f5b90f',
  'a688309219c0be8d731b07acf3292784966b5c863b6a5e99136275072a2ee5b5',
  'db4c3ac1508a24d38765a2dade223d6c8e2ecd234be89aaaabd1ea2f9f8c7267',
  '59a94796276f68f49a55a56651d1ee5d3b5b1f290f0e572f9e679286914566ef',
  '37158bd0a2c2e4a652faacf8e0b48eb9b4ffd2cfa81b72a11f1e657487217a53',
  '6f8bd7f4d8ec5cb52b7a59ccb9e8c14c2a4ba529cb5adfc5e0bc676892b8ca79',
  'e8b205bab25202a0f1443c3773d56a2e90bd9d2d4d61235a8f659016faf85f2e',
  'e7b6cb8dad02afc17ed35aa2bbf64d81a2ccadf146bd126ba8db8170f2a41161',
  '92b2d9675a6753816576804b01ffdfc73a5f7acee32f0b06aed77284e097d220',
  '3274833b69576acc8274bcf3085d0296321739d8c9e819cf150305344639c735',
  '93b9773859c0496bed472887e0df2a81493e40899f3b7acd8cc626c09876e22f',
  'acaae610f34003772b282ff53577ec1869f8c88d5d6ee29274de5befdc1c84bc',
  '21c2c81f3c8c420df998c85c7f5496e64267527cc919128152b70f87b1bb83e4',
  '4097edd52bc2d51ec8a048a398f7ec7e418d4797178a00e78a328f852ad28d96',
  '3362362a994db4672e64add7a56482a21a4767f898e6732ee029fb89591018d6',
  '25b6599f8942471b29019071addc71de2bf009edd0bda88650601d9d4f33cf7c',
  '8c5c95a5a99949dc6b178543512c4507f72df7a92a189d604558235cc83e4fe0',
  'ca855e47acbe3a75ab28bec7c020d1b6effa24e0c7dd8fc38efcd5d279acefe0',
]);

function backendBinaryName(platform) {
  return platform === 'win32' ? 'winkgo_core.exe' : 'winkgo_core';
}

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function bundledPath(runtimeKey, ...parts) {
  return normalize(path.join('bundled-winkgo-core', runtimeKey, ...parts));
}

function isFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function isDirectory(dirPath) {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function findByteMarkersInBuffer(buffer, markers) {
  return markers.filter((marker) => buffer.indexOf(Buffer.from(marker.value, 'utf8')) >= 0).map((marker) => marker.id);
}

function findByteMarkersInFile(filePath, markers) {
  if (!isFile(filePath) || fs.statSync(filePath).size === 0) return [];

  const encodedMarkers = markers.map((marker) => ({
    id: marker.id,
    value: Buffer.from(marker.value, 'utf8'),
  }));
  const maxMarkerLength = Math.max(...encodedMarkers.map((marker) => marker.value.length));
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const findings = new Set();
  let carry = Buffer.alloc(0);
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      const combined = Buffer.concat([carry, buffer.subarray(0, bytesRead)]);
      for (const marker of encodedMarkers) {
        if (combined.indexOf(marker.value) >= 0) findings.add(marker.id);
      }
      carry = Buffer.from(combined.subarray(Math.max(0, combined.length - maxMarkerLength + 1)));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return [...findings];
}

function findRestrictedLegacyPdfSkillMarkersInBuffer(buffer) {
  const findings = findByteMarkersInBuffer(buffer, RESTRICTED_LEGACY_PDF_SKILL_MARKERS);
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  if (RESTRICTED_LEGACY_PDF_FILE_SHA256.has(digest)) findings.push('restricted-pdf-known-file-sha256');
  return findings;
}

function findRestrictedLegacyPdfSkillMarkersInFile(filePath) {
  const findings = findByteMarkersInFile(filePath, RESTRICTED_LEGACY_PDF_SKILL_MARKERS);
  if (!isFile(filePath) || fs.statSync(filePath).size === 0) return findings;

  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  if (RESTRICTED_LEGACY_PDF_FILE_SHA256.has(hash.digest('hex'))) {
    findings.push('restricted-pdf-known-file-sha256');
  }
  return findings;
}

function isRestrictedLegacyPdfSkillPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  return /(?:^|\/)builtin-skills\/pdf(?:\/|$)/i.test(normalized);
}

function findRestrictedLegacyPdfSkillPaths(rootDir) {
  if (!isDirectory(rootDir)) return [];

  const findings = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const relativePath = normalize(path.relative(rootDir, entryPath));
      if (isRestrictedLegacyPdfSkillPath(relativePath)) {
        findings.push(relativePath);
        if (entry.isDirectory()) continue;
      }
      if (entry.isDirectory()) pending.push(entryPath);
    }
  }
  return findings;
}

function findForbiddenManagedExternalCliArtifacts(rootDir) {
  if (!isDirectory(rootDir)) return [];

  const findings = [];
  const pending = [rootDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const relativePath = normalize(path.relative(rootDir, entryPath));
      if (FORBIDDEN_MANAGED_CLI_PATH.test(relativePath)) {
        findings.push({ path: relativePath, marker: 'forbidden_managed_cli_path' });
        if (entry.isDirectory()) continue;
      }
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const size = fs.statSync(entryPath).size;
      if (size > 2 * 1024 * 1024) continue;
      const contents = fs.readFileSync(entryPath);
      for (const marker of FORBIDDEN_MANAGED_CLI_PACKAGE_MARKERS) {
        if (contents.indexOf(Buffer.from(marker, 'utf8')) >= 0) {
          findings.push({ path: relativePath, marker });
        }
      }
    }
  }
  return findings;
}

function inspectCorePdfSkillCompliance(binaryPath) {
  if (!isFile(binaryPath)) {
    return {
      restricted: [],
      missing: ORIGINAL_PDF_TOOLKIT_MARKERS.map((marker) => marker.id),
    };
  }

  const findings = new Set([
    ...findRestrictedLegacyPdfSkillMarkersInFile(binaryPath),
    ...findByteMarkersInFile(binaryPath, ORIGINAL_PDF_TOOLKIT_MARKERS),
  ]);
  return {
    restricted: [...findings].filter((id) => id.startsWith('restricted-pdf-')),
    missing: ORIGINAL_PDF_TOOLKIT_MARKERS.filter((marker) => !findings.has(marker.id)).map((marker) => marker.id),
  };
}

function assertCorePdfSkillCompliance(binaryPath) {
  const result = inspectCorePdfSkillCompliance(binaryPath);
  if (result.restricted.length > 0) {
    throw new Error(
      `WINK GO Core contains the removed restricted Anthropic PDF Skill (${result.restricted.join(', ')}): ${binaryPath}`
    );
  }
  if (result.missing.length > 0) {
    throw new Error(
      `WINK GO Core is missing the required original pdf-toolkit markers (${result.missing.join(', ')}): ${binaryPath}`
    );
  }
  return result;
}

function addFailure(failures, missing, checked, failure) {
  if (failure.path) checked.push(failure.path);
  failures.push(failure);
  if (failure.path) {
    missing.push(
      failure.reason === 'missing_file' || failure.reason === 'missing_directory'
        ? failure.path
        : `${failure.path}<${failure.reason}>`
    );
  }
}

function requireRelativePath(baseDir, runtimeKey, parts, checked, missing, failures) {
  const relativePath = bundledPath(runtimeKey, ...parts);
  checked.push(relativePath);

  if (!isFile(path.join(baseDir, ...parts))) {
    const failure = { component: 'winkgo_core', reason: 'missing_file', path: relativePath };
    failures.push(failure);
    missing.push(relativePath);
  }
}

function requireRelativeDirectory(baseDir, runtimeKey, parts, checked, missing, failures) {
  const relativePath = bundledPath(runtimeKey, ...parts);
  checked.push(relativePath);

  const fullPath = path.join(baseDir, ...parts);
  if (!isDirectory(fullPath)) {
    const failure = { component: 'managed-resources', reason: 'missing_directory', path: relativePath };
    failures.push(failure);
    missing.push(relativePath);
  }
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function verifyBundleManifest(baseDir, runtimeKey, electronPlatformName, targetArch, checked, missing, failures) {
  const parts = ['manifest.json'];
  const relativePath = bundledPath(runtimeKey, ...parts);
  const manifestPath = path.join(baseDir, ...parts);
  checked.push(relativePath);

  if (!isFile(manifestPath)) {
    missing.push(relativePath);
    failures.push({ component: 'bundle-manifest', reason: 'missing_file', path: relativePath });
    return;
  }

  const manifest = readManifest(manifestPath);
  if (!manifest) {
    missing.push(`${relativePath}<invalid-json>`);
    failures.push({ component: 'bundle-manifest', reason: 'invalid_json', path: relativePath });
    return;
  }

  if (manifest.platform !== electronPlatformName) {
    missing.push(`${relativePath}<platform:${electronPlatformName}>`);
    failures.push({ component: 'bundle-manifest', reason: 'runtime_key_mismatch', path: relativePath });
  }

  if (manifest.arch !== targetArch) {
    missing.push(`${relativePath}<arch:${targetArch}>`);
    failures.push({ component: 'bundle-manifest', reason: 'runtime_key_mismatch', path: relativePath });
  }
}

function readManagedResourcesContract(manifestPath) {
  try {
    return { contract: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
  } catch (error) {
    return { error };
  }
}

function validateContractRelativePath(value) {
  if (typeof value !== 'string') return false;
  if (!value || value.includes('\\') || path.isAbsolute(value)) return false;
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function joinContractPath(root, relativePath) {
  return path.join(root, ...relativePath.split('/'));
}

function contractBundledPath(runtimeKey, ...parts) {
  return bundledPath(runtimeKey, 'managed-resources', ...parts);
}

function addSchemaFailure(failures, missing, component, reason, path) {
  addFailure(failures, missing, [], { component, reason, path });
}

function stringField(value) {
  return typeof value === 'string' && value.length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function validateContractPathField(value, component, pathLabel, failures) {
  if (!validateContractRelativePath(value)) {
    failures.push({
      component,
      reason: 'invalid_contract_path',
      detail: pathLabel,
    });
    return false;
  }
  return true;
}

function verifyManagedResourcesContract(baseDir, runtimeKey, checked, missing, failures) {
  const managedRoot = path.join(baseDir, 'managed-resources');
  const relativePath = contractBundledPath(runtimeKey, 'manifest.json');
  const manifestPath = path.join(managedRoot, 'manifest.json');
  checked.push(relativePath);

  if (!isFile(manifestPath)) {
    addFailure(failures, missing, [], {
      component: 'managed-resources',
      reason: 'missing_file',
      path: relativePath,
    });
    return;
  }

  const { contract, error } = readManagedResourcesContract(manifestPath);
  if (error) {
    addFailure(failures, missing, [], {
      component: 'managed-resources',
      reason: 'invalid_json',
      path: relativePath,
    });
    return;
  }

  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', relativePath);
    return;
  }
  if (contract.schemaVersion !== 2) {
    addSchemaFailure(
      failures,
      missing,
      'managed-resources',
      typeof contract.schemaVersion === 'number' ? 'unsupported_schema_version' : 'invalid_schema',
      relativePath
    );
    return;
  }
  if (contract.runtimeKey !== runtimeKey) {
    addSchemaFailure(failures, missing, 'managed-resources', 'runtime_key_mismatch', relativePath);
    return;
  }
  if (!contract.node || typeof contract.node !== 'object' || Array.isArray(contract.node)) {
    addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', relativePath);
    return;
  }
  if (!Array.isArray(contract.clis)) {
    addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', relativePath);
    return;
  }

  verifyManagedNodeFromContract(managedRoot, runtimeKey, contract, checked, missing, failures);
  verifyManagedClisFromContract(managedRoot, runtimeKey, contract, checked, missing, failures);
}

function verifyManagedNodeFromContract(baseDir, runtimeKey, contract, checked, missing, failures) {
  const node = contract.node;
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
  if (
    !stringField(node.version) ||
    !stringField(node.root) ||
    !stringField(node.executable) ||
    !stringArray(node.requiredFiles)
  ) {
    addSchemaFailure(failures, missing, 'managed-node', 'invalid_schema', manifestPath);
    return;
  }
  const pathFields = [
    ['node.root', node.root],
    ['node.executable', node.executable],
    ...node.requiredFiles.map((entry, index) => [`node.requiredFiles[${index}]`, entry]),
  ];
  if (pathFields.some(([field, value]) => !validateContractPathField(value, 'managed-node', field, failures))) {
    return;
  }

  const expectedNpmLicense = runtimeKey.startsWith('win32-')
    ? 'node_modules/npm/LICENSE'
    : 'lib/node_modules/npm/LICENSE';
  for (const requiredLegalFile of ['LICENSE', expectedNpmLicense]) {
    if (!node.requiredFiles.includes(requiredLegalFile)) {
      failures.push({
        component: 'managed-node',
        reason: 'missing_node_legal_file',
        detail: requiredLegalFile,
        path: manifestPath,
      });
    }
  }

  for (const relativeFile of [node.executable, ...node.requiredFiles]) {
    const filePath = joinContractPath(joinContractPath(baseDir, node.root), relativeFile);
    const relativePath = contractBundledPath(runtimeKey, node.root, relativeFile);
    checked.push(relativePath);
    if (!isFile(filePath)) {
      missing.push(relativePath);
      failures.push({
        component: 'managed-node',
        reason: 'missing_file',
        version: node.version,
        runtimeKey,
        path: relativePath,
      });
    }
  }
}

function verifyManagedClisFromContract(baseDir, runtimeKey, contract, checked, missing, failures) {
  const seen = new Set();
  const validClis = [];
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');

  for (const cli of contract.clis) {
    if (!cli || typeof cli !== 'object' || Array.isArray(cli) || !stringField(cli.name)) {
      addSchemaFailure(failures, missing, 'managed-resources', 'invalid_schema', manifestPath);
      continue;
    }
    if (seen.has(cli.name)) {
      failures.push({
        component: cli.name,
        reason: 'duplicate_cli_name',
      });
      continue;
    }
    seen.add(cli.name);
    validClis.push(cli);
  }

  for (const cli of validClis) {
    if (FORBIDDEN_MANAGED_CLI_NAMES.has(cli.name.toLowerCase())) {
      failures.push({
        component: cli.name,
        reason: 'forbidden_bundled_external_cli',
        path: manifestPath,
      });
      continue;
    }
    verifyManagedCliFromContract(baseDir, runtimeKey, cli, checked, missing, failures);
  }
}

function verifyManagedCliFromContract(baseDir, runtimeKey, cli, checked, missing, failures) {
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
  const requiredStringFields = ['name', 'version', 'root', 'platformDirectory', 'executable'];
  if (requiredStringFields.some((field) => !stringField(cli[field]))) {
    addSchemaFailure(failures, missing, cli.name, 'invalid_schema', manifestPath);
    return;
  }
  // Historical schema fields remain optional for non-forbidden future managed
  // tools. Claude Code and Codex are rejected before reaching this function.
  const requiredFiles = cli.requiredFiles === undefined ? [] : cli.requiredFiles;
  const requiredDirectories = cli.requiredDirectories === undefined ? [] : cli.requiredDirectories;
  if (!stringArray(requiredFiles) || !stringArray(requiredDirectories)) {
    addSchemaFailure(failures, missing, cli.name, 'invalid_schema', manifestPath);
    return;
  }
  if (cli.platformDirectory !== runtimeKey) {
    addSchemaFailure(failures, missing, cli.name, 'runtime_key_mismatch', manifestPath);
    return;
  }

  const pathFields = [
    ['root', cli.root],
    ['executable', cli.executable],
    ...requiredFiles.map((entry, index) => [`requiredFiles[${index}]`, entry]),
    ...requiredDirectories.map((entry, index) => [`requiredDirectories[${index}]`, entry]),
  ];
  if (pathFields.some(([field, value]) => !validateContractPathField(value, cli.name, field, failures))) {
    return;
  }

  requireContractFile(baseDir, runtimeKey, cli, cli.root, cli.executable, checked, missing, failures);
  for (const requiredFile of requiredFiles) {
    requireContractFile(baseDir, runtimeKey, cli, cli.root, requiredFile, checked, missing, failures);
  }
  for (const requiredDirectory of requiredDirectories) {
    requireContractDirectory(baseDir, runtimeKey, cli, cli.root, requiredDirectory, checked, missing, failures);
  }
}

function verifyNoManagedExternalCliArtifacts(baseDir, runtimeKey, missing, failures) {
  const managedRoot = path.join(baseDir, 'managed-resources');
  for (const finding of findForbiddenManagedExternalCliArtifacts(managedRoot)) {
    const relativePath = contractBundledPath(runtimeKey, ...finding.path.split('/'));
    failures.push({
      component: 'managed-resources',
      reason: 'forbidden_bundled_external_cli',
      path: relativePath,
      detail: finding.marker,
    });
    missing.push(`${relativePath}<forbidden_bundled_external_cli:${finding.marker}>`);
  }
}

function verifyCorePdfSkillCompliance(baseDir, runtimeKey, electronPlatformName, missing, failures) {
  const binaryName = backendBinaryName(electronPlatformName);
  const binaryPath = path.join(baseDir, binaryName);
  const relativePath = bundledPath(runtimeKey, binaryName);
  if (isFile(binaryPath)) {
    const compliance = inspectCorePdfSkillCompliance(binaryPath);
    if (compliance.restricted.length > 0) {
      failures.push({
        component: 'winkgo_core',
        reason: 'restricted_legacy_pdf_skill',
        path: relativePath,
        detail: compliance.restricted,
      });
      missing.push(`${relativePath}<restricted_legacy_pdf_skill:${compliance.restricted.join('+')}>`);
    }
    if (compliance.missing.length > 0) {
      failures.push({
        component: 'winkgo_core',
        reason: 'missing_original_pdf_toolkit',
        path: relativePath,
        detail: compliance.missing,
      });
      missing.push(`${relativePath}<missing_original_pdf_toolkit:${compliance.missing.join('+')}>`);
    }
  }

  for (const legacyPath of findRestrictedLegacyPdfSkillPaths(baseDir)) {
    const bundledLegacyPath = bundledPath(runtimeKey, ...legacyPath.split('/'));
    failures.push({
      component: 'winkgo_core-bundle',
      reason: 'restricted_legacy_pdf_skill_path',
      path: bundledLegacyPath,
    });
    missing.push(`${bundledLegacyPath}<restricted_legacy_pdf_skill_path>`);
  }
}

function requireContractFile(baseDir, runtimeKey, cli, root, relativePath, checked, missing, failures) {
  const bundledRelative = contractBundledPath(runtimeKey, root, relativePath);
  checked.push(bundledRelative);
  if (!isFile(joinContractPath(joinContractPath(baseDir, root), relativePath))) {
    missing.push(bundledRelative);
    failures.push({
      component: cli.name,
      reason: 'missing_file',
      version: cli.version,
      runtimeKey,
      path: bundledRelative,
    });
  }
}

function requireContractDirectory(baseDir, runtimeKey, cli, root, relativePath, checked, missing, failures) {
  const bundledRelative = contractBundledPath(runtimeKey, root, relativePath);
  checked.push(bundledRelative);
  if (!isDirectory(joinContractPath(joinContractPath(baseDir, root), relativePath))) {
    missing.push(bundledRelative);
    failures.push({
      component: cli.name,
      reason: 'missing_directory',
      version: cli.version,
      runtimeKey,
      path: bundledRelative,
    });
  }
}

function verifyBundledWinkGoCoreResources({ resourcesDir, electronPlatformName, targetArch }) {
  const runtimeKey = `${electronPlatformName}-${targetArch}`;
  const baseDir = path.join(resourcesDir, 'bundled-winkgo-core', runtimeKey);
  const checked = [];
  const missing = [];
  const failures = [];

  requireRelativePath(baseDir, runtimeKey, [backendBinaryName(electronPlatformName)], checked, missing, failures);
  verifyCorePdfSkillCompliance(baseDir, runtimeKey, electronPlatformName, missing, failures);
  verifyBundleManifest(baseDir, runtimeKey, electronPlatformName, targetArch, checked, missing, failures);
  requireRelativeDirectory(baseDir, runtimeKey, ['managed-resources'], checked, missing, failures);
  verifyNoManagedExternalCliArtifacts(baseDir, runtimeKey, missing, failures);
  verifyManagedResourcesContract(baseDir, runtimeKey, checked, missing, failures);
  if (failures.length > 0 && missing.length === 0) {
    missing.push(`${contractBundledPath(runtimeKey, 'manifest.json')}<contract_failure>`);
  }

  return { runtimeKey, checked, missing, failures };
}

module.exports = {
  ORIGINAL_PDF_TOOLKIT_MARKERS,
  RESTRICTED_LEGACY_PDF_SKILL_MARKERS,
  assertCorePdfSkillCompliance,
  findRestrictedLegacyPdfSkillMarkersInBuffer,
  findRestrictedLegacyPdfSkillMarkersInFile,
  inspectCorePdfSkillCompliance,
  isRestrictedLegacyPdfSkillPath,
  verifyBundledWinkGoCoreResources,
};
