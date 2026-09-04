import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const audit = require('../../../scripts/security/audit-dependencies.cjs') as {
  EXPECTED_SECURITY_PATCHES: Readonly<Record<string, string>>;
  extractBraceExpansionVersions: (lockfileContents: string) => string[];
  extractResolvedPackageVersion: (lockfileContents: string, packageName: string) => string;
  validateBraceExpansionVersions: (lockfileContents: string) => string[];
  validateSecurityPatchVersions: (lockfileContents: string) => Record<string, string>;
};

const lockRecord = (key: string, version: string): string =>
  `"${key}": ["brace-expansion@${version}", "", {}, "sha512-test"]`;

const packageLockRecord = (name: string, version: string): string =>
  `"${name}": ["${name}@${version}", "", {}, "sha512-test"]`;

describe('dependency security audit', () => {
  it('accepts only the reviewed patched brace-expansion maintenance releases', () => {
    const lockfile = [
      lockRecord('brace-expansion', '1.1.18'),
      lockRecord('@electron/universal/minimatch/brace-expansion', '2.1.4'),
      lockRecord('@ts-morph/common/minimatch/brace-expansion', '5.0.9'),
    ].join('\n');

    expect(audit.validateBraceExpansionVersions(lockfile)).toEqual(['1.1.18', '2.1.4', '5.0.9']);
  });

  it('rejects a downgrade hidden by the advisory exception', () => {
    const lockfile = [
      lockRecord('brace-expansion', '1.1.17'),
      lockRecord('@electron/universal/minimatch/brace-expansion', '2.1.4'),
      lockRecord('@ts-morph/common/minimatch/brace-expansion', '5.0.9'),
    ].join('\n');

    expect(() => audit.validateBraceExpansionVersions(lockfile)).toThrow(/Unexpected brace-expansion versions/);
  });

  it('rejects a lockfile without a resolved brace-expansion record', () => {
    expect(audit.extractBraceExpansionVersions('')).toEqual([]);
    expect(() => audit.validateBraceExpansionVersions('')).toThrow(/contains no resolved brace-expansion/);
  });

  it('accepts the reviewed qs, fast-uri, and xmldom security releases', () => {
    const lockfile = Object.entries(audit.EXPECTED_SECURITY_PATCHES)
      .map(([name, version]) => packageLockRecord(name, version))
      .join('\n');

    expect(audit.validateSecurityPatchVersions(lockfile)).toEqual(audit.EXPECTED_SECURITY_PATCHES);
  });

  it('rejects a vulnerable transitive package downgrade', () => {
    const lockfile = [
      packageLockRecord('@xmldom/xmldom', '0.9.12'),
      packageLockRecord('fast-uri', '3.1.5'),
      packageLockRecord('qs', '6.16.0'),
    ].join('\n');

    expect(audit.extractResolvedPackageVersion(lockfile, 'fast-uri')).toBe('3.1.5');
    expect(() => audit.validateSecurityPatchVersions(lockfile)).toThrow(/Unexpected fast-uri version/);
  });
});
