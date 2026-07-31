import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const audit = require('../../../scripts/security/audit-dependencies.cjs') as {
  extractBraceExpansionVersions: (lockfileContents: string) => string[];
  validateBraceExpansionVersions: (lockfileContents: string) => string[];
};

const lockRecord = (key: string, version: string): string =>
  `"${key}": ["brace-expansion@${version}", "", {}, "sha512-test"]`;

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
});
