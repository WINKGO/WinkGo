/**
 * @license
 * Copyright 2026 WINK GO contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  getDownloadUrl,
  resolveGitHubRepository,
}: {
  getDownloadUrl: (assetName: string, tag: string, env?: NodeJS.ProcessEnv) => string;
  resolveGitHubRepository: (env?: NodeJS.ProcessEnv) => {
    owner: string;
    repo: string;
    repository: string;
  };
} = require('../../../packages/shared-scripts/src/prepare-winkgo-core.js');

describe('WINK GO Core repository resolution', () => {
  it('defaults every release download to the clean WINK GO repository', () => {
    expect(resolveGitHubRepository({})).toEqual({
      owner: 'xuweihafeichangniu-lab',
      repo: 'wink-go',
      repository: 'xuweihafeichangniu-lab/wink-go',
    });
    expect(getDownloadUrl('winkgo_core-v2.2.0.zip', 'v2.2.0', {})).toBe(
      'https://github.com/xuweihafeichangniu-lab/wink-go/releases/download/v2.2.0/winkgo_core-v2.2.0.zip'
    );
  });

  it('allows an explicitly controlled repository or the current GitHub Actions repository', () => {
    expect(resolveGitHubRepository({ GITHUB_REPOSITORY: 'example/winkgo-fork' }).repository).toBe(
      'example/winkgo-fork'
    );
    expect(
      resolveGitHubRepository({
        GITHUB_REPOSITORY: 'example/ignored',
        WINKGO_CORE_GITHUB_REPOSITORY: 'release-owner/release-repo',
      }).repository
    ).toBe('release-owner/release-repo');
  });

  it('fails closed for the retired repository and malformed repository values', () => {
    expect(() => resolveGitHubRepository({ GITHUB_REPOSITORY: 'xuweihafeichangniu-lab/wink' })).toThrow(
      'Refusing to prepare release resources from retired repository'
    );
    expect(() => resolveGitHubRepository({ GITHUB_REPOSITORY: 'https://github.com/example/repo' })).toThrow(
      'Invalid WINK GO GitHub repository'
    );
  });
});
