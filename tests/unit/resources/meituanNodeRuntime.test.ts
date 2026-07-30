import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const SKILL_ROOT = path.resolve(
  process.cwd(),
  'resources/winkgo/provider-skills/meituan-life-assistant/mtunion-product-ai-all-guide'
);
const RUN_SCRIPT = path.join(SKILL_ROOT, 'scripts', 'run.js');
const RUNTIME_SCRIPT = path.join(SKILL_ROOT, 'scripts', 'node-runtime.js');
type MeituanRuntime = {
  getDeviceToken: (
    authFile: string,
    options?: { now?: () => number; random?: () => number }
  ) => { success: boolean; device_token: string };
  mapProductSearchResponse: (
    response: { status: number; data: unknown; raw?: string },
    options: { page: number; pageSize: number; maxDistanceKm: number }
  ) => {
    success: boolean;
    productList: Array<{ productId: string; poiId: string; distanceText: string }>;
  };
};
const hasBundledRuntime = fs.existsSync(RUN_SCRIPT) && fs.existsSync(RUNTIME_SCRIPT);
const runtime = (hasBundledRuntime ? require(RUNTIME_SCRIPT) : null) as MeituanRuntime | null;
const describeBundledRuntime = hasBundledRuntime ? describe : describe.skip;

const temporaryDirectories: string[] = [];

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'winkgo-meituan-node-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describeBundledRuntime('bundled Meituan Node.js runtime', () => {
  it('initializes without Python, npm, or PATH lookup', () => {
    const result = spawnSync(process.execPath, [RUN_SCRIPT, 'init'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: '',
        XIAOMEI_AUTH_FILE: path.join(createTemporaryDirectory(), 'auth.json'),
      },
      windowsHide: true,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      ok: true,
      runtime: 'node',
      zero_external_dependencies: true,
      cliguard_available: true,
    });
  });

  it('persists a stable device token locally', () => {
    const authFile = path.join(createTemporaryDirectory(), 'auth.json');
    const first = runtime!.getDeviceToken(authFile, {
      now: () => 1_700_000_000_000,
      random: () => 0.5,
    });
    const second = runtime!.getDeviceToken(authFile, {
      now: () => 1_800_000_000_000,
      random: () => 0.9,
    });

    expect(first.device_token).toMatch(/^[a-f0-9]{32}$/);
    expect(second.device_token).toBe(first.device_token);
  });

  it('keeps API result compatibility and filters distant products', () => {
    const result = runtime!.mapProductSearchResponse(
      {
        status: 200,
        data: {
          code: 200,
          success: true,
          data: {
            productList: [
              { productId: 101, poiId: 201, distanceText: '358m' },
              { productId: 102, poiId: 202, distanceText: '7.2km' },
            ],
          },
        },
      },
      { page: 1, pageSize: 10, maxDistanceKm: 6 }
    );

    expect(result.success).toBe(true);
    expect(result.productList).toEqual([{ productId: '101', poiId: '201', distanceText: '358m' }]);
  });

  it('contains no external Python or npm bootstrap path', () => {
    const source = fs.readFileSync(RUN_SCRIPT, 'utf8');
    expect(source).not.toMatch(/\bpython(?:3)?\b/i);
    expect(source).not.toContain('runPython');
    expect(source).not.toContain('npm install');
    expect(source).not.toContain('NPM_NOT_FOUND');
  });
});
