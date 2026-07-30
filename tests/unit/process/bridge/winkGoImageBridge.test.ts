/**
 * @license
 * Copyright 2025 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recoverCodexGeneratedImage } from '@process/bridge/winkgo/imageBridge';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lb7nWQAAAABJRU5ErkJggg==';
const temporaryRoots: string[] = [];

const createTemporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'winkgo-image-recovery-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('recoverCodexGeneratedImage', () => {
  it('restores a completed Codex image event to a local file', async () => {
    const root = await createTemporaryRoot();
    const sessionsRoot = path.join(root, 'sessions');
    const outputRoot = path.join(root, 'output');
    await mkdir(path.join(sessionsRoot, '2026', '07', '27'), { recursive: true });
    await writeFile(
      path.join(sessionsRoot, '2026', '07', '27', 'rollout.jsonl'),
      `${JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'image_generation_end',
          call_id: 'call_image',
          status: 'completed',
          result: PNG_BASE64,
        },
      })}\n`
    );

    const result = await recoverCodexGeneratedImage('call_image', { sessionsRoot, outputRoot });

    expect(result.recovered).toBe(true);
    expect(result.path).toBe(path.join(outputRoot, 'call_image.png'));
    expect(await readFile(result.path!)).toEqual(Buffer.from(PNG_BASE64, 'base64'));
  });

  it('returns no path for an unknown call without writing output', async () => {
    const root = await createTemporaryRoot();
    const result = await recoverCodexGeneratedImage('call_missing', {
      sessionsRoot: path.join(root, 'sessions'),
      outputRoot: path.join(root, 'output'),
    });

    expect(result).toEqual({ path: null, recovered: false });
  });
});
