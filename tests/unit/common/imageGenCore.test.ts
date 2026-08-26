/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { tmpdir } from 'node:os';
import { executeImageGeneration, processImageUri, saveGeneratedImage } from '@/common/chat/imageGenCore';

let cleanupDirs: string[] = [];

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const DATA_URL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function createWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'winkgo-image-gen-test-'));
  cleanupDirs.push(dir);
  return dir;
}

function createImageFile(dir: string, name: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, PNG_1X1);
  return filePath;
}

function createNonImageFile(dir: string, name: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, 'hello world');
  return filePath;
}

afterEach(() => {
  for (const directory of cleanupDirs) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
  cleanupDirs = [];
});

describe('processImageUri workspace boundary', () => {
  it('passes through an HTTP URL without filesystem access', async () => {
    await expect(processImageUri('https://example.com/photo.png', '/nonexistent')).resolves.toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/photo.png', detail: 'auto' },
    });
  });

  it('resolves relative and @-prefixed images inside the workspace', async () => {
    const workspace = createWorkspace();
    createImageFile(workspace, 'test.png');

    const relative = await processImageUri('test.png', workspace);
    const mentioned = await processImageUri('@test.png', workspace);

    expect(relative?.image_url.url).toContain('base64');
    expect(mentioned?.image_url.url).toContain('base64');
  });

  it.each(['../../../etc/passwd', '..'])('blocks parent traversal: %s', async (candidate) => {
    const workspace = createWorkspace();
    await expect(processImageUri(candidate, workspace)).rejects.toThrow('Path traversal blocked');
  });

  it('blocks an absolute path outside the workspace', async () => {
    const workspace = createWorkspace();
    const outside = createWorkspace();
    const outsideImage = createImageFile(outside, 'secret.png');
    await expect(processImageUri(outsideImage, workspace)).rejects.toThrow('Path traversal blocked');
  });

  it('allows an absolute path inside the workspace', async () => {
    const workspace = createWorkspace();
    const image = createImageFile(workspace, 'inside.png');
    await expect(processImageUri(image, workspace)).resolves.toMatchObject({ type: 'image_url' });
  });

  it('rejects non-image and missing files inside the workspace', async () => {
    const workspace = createWorkspace();
    createNonImageFile(workspace, 'notes.txt');
    await expect(processImageUri('notes.txt', workspace)).rejects.toThrow('not a supported image type');
    await expect(processImageUri('missing.png', workspace)).rejects.toThrow('Image file not found');
  });

  it('allows normalized dot segments that remain inside the workspace', async () => {
    const workspace = createWorkspace();
    const subdirectory = join(workspace, 'subdir');
    mkdirSync(subdirectory);
    createImageFile(subdirectory, 'image.png');
    await expect(processImageUri('subdir/../subdir/image.png', workspace)).resolves.toMatchObject({
      type: 'image_url',
    });
  });

  it.skipIf(process.platform === 'win32')(
    'blocks a file symlink inside the workspace that escapes outside',
    async () => {
      const workspace = createWorkspace();
      const outside = createWorkspace();
      const secret = createImageFile(outside, 'secret.png');
      symlinkSync(secret, join(workspace, 'linked.png'));
      await expect(processImageUri('linked.png', workspace)).rejects.toThrow('Path traversal blocked');
    }
  );

  it('blocks a directory symlink inside the workspace that escapes outside', async () => {
    const workspace = createWorkspace();
    const outside = createWorkspace();
    createImageFile(outside, 'secret.png');
    symlinkSync(outside, join(workspace, 'linked-dir'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(processImageUri('linked-dir/secret.png', workspace)).rejects.toThrow('Path traversal blocked');
  });

  it.skipIf(process.platform === 'win32')('allows a symlink that stays inside the workspace', async () => {
    const workspace = createWorkspace();
    const image = createImageFile(workspace, 'real.png');
    symlinkSync(image, join(workspace, 'alias.png'));
    await expect(processImageUri('alias.png', workspace)).resolves.toMatchObject({ type: 'image_url' });
  });
});

describe('saveGeneratedImage', () => {
  it('saves into the resolved workspace directory', async () => {
    const workspace = createWorkspace();
    const subdirectory = join(workspace, 'sub');
    mkdirSync(subdirectory);

    const filePath = await saveGeneratedImage(DATA_URL_PNG, join(subdirectory, '..', 'sub', '.'));

    expect(filePath.startsWith(pathResolve(workspace))).toBe(true);
    expect(filePath).toMatch(/img-\d+\.png$/);
  });
});

describe('executeImageGeneration workspace validation', () => {
  const provider = {
    id: 'test',
    name: 'test',
    platform: 'openai',
    base_url: '',
    api_key: 'sk-test',
    use_model: 'dall-e-3',
  };

  it('rejects a non-existent workspace before making an API call', async () => {
    const result = await executeImageGeneration({ prompt: 'a cat' }, provider, '/nonexistent/workspace');
    expect(result.success).toBe(false);
    expect(result.text).toContain('not found');
  });

  it('rejects a workspace path that is a file', async () => {
    const workspace = createWorkspace();
    const filePath = createImageFile(workspace, 'not-a-dir.png');
    const result = await executeImageGeneration({ prompt: 'a cat' }, provider, filePath);
    expect(result.success).toBe(false);
    expect(result.text).toContain('not a directory');
  });
});
