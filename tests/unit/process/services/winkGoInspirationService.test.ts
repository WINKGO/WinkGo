import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
  },
}));

import { resolveMeituanSkillRoot } from '@/process/services/WinkGoInspirationService';

const temporaryDirectories: string[] = [];

const makeSkillRoot = async (withRunner: boolean): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'winkgo-meituan-skill-'));
  temporaryDirectories.push(root);
  if (withRunner) {
    const scripts = path.join(root, 'scripts');
    await mkdir(scripts, { recursive: true });
    await writeFile(path.join(scripts, 'run.js'), 'process.stdout.write("{}")\n', 'utf8');
  }
  return root;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('resolveMeituanSkillRoot', () => {
  it('finds the Meituan skill shipped with WINK GO resources', () => {
    const bundled = path.join(
      process.cwd(),
      'resources',
      'winkgo',
      'provider-skills',
      'meituan-life-assistant',
      'mtunion-product-ai-all-guide'
    );

    expect(resolveMeituanSkillRoot([bundled])).toBe(bundled);
  });

  it('uses the first bundled skill containing the executable runner', async () => {
    const missing = await makeSkillRoot(false);
    const bundled = await makeSkillRoot(true);

    expect(resolveMeituanSkillRoot([missing, bundled])).toBe(bundled);
  });

  it('rejects stale or incomplete customer paths', async () => {
    const incomplete = await makeSkillRoot(false);

    expect(resolveMeituanSkillRoot([incomplete, path.join(incomplete, 'missing')])).toBeNull();
  });
});
