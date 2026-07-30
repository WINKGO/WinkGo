import { afterEach, describe, expect, it } from 'vitest';
import { createCipheriv } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildWinkGoFfmpegArguments,
  runWinkGoFormatConversion,
  safeWinkGoFormatOutputStem,
  winkGoFormatPresetAcceptsPath,
} from '@process/services/WinkGoFormatConverterService';

const temporaryRoots: string[] = [];
const HEADER_KEY = Buffer.from('hzHRAmso5kInbaxW');
const u32 = (value: number): Buffer => {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value);
  return result;
};

const createTemporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'winkgo-format-'));
  temporaryRoots.push(root);
  return root;
};

const createSyntheticNcm = (payload: Buffer): Buffer => {
  const streamKey = Buffer.from('WINK-GO-NCM-TEST');
  const cipher = createCipheriv('aes-128-ecb', HEADER_KEY, null);
  cipher.setAutoPadding(true);
  const encryptedKey = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from('neteasecloudmusic'), streamKey])),
    cipher.final(),
  ]).map((value) => value ^ 0x64);
  const keyBox = Uint8Array.from({ length: 256 }, (_, index) => index);
  let cursor = 0;
  for (let index = 0; index < 256; index += 1) {
    cursor = (keyBox[index] + cursor + streamKey[index % streamKey.length]) & 0xff;
    const next = keyBox[index];
    keyBox[index] = keyBox[cursor];
    keyBox[cursor] = next;
  }
  const encryptedPayload = Buffer.from(payload);
  for (let index = 0; index < encryptedPayload.length; index += 1) {
    const first = (index + 1) & 0xff;
    const second = (keyBox[first] + first) & 0xff;
    const keyIndex = (keyBox[second] + keyBox[first]) & 0xff;
    encryptedPayload[index] ^= keyBox[keyIndex];
  }
  return Buffer.concat([
    Buffer.from('CTENFDAM\0\0'),
    u32(encryptedKey.length),
    encryptedKey,
    u32(0),
    Buffer.alloc(5),
    u32(0),
    u32(0),
    encryptedPayload,
  ]);
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WINK GO format converter', () => {
  it('accepts only the extensions supported by each original workbench preset', () => {
    expect(winkGoFormatPresetAcceptsPath('ncm_to_mp3', 'song.NCM')).toBe(true);
    expect(winkGoFormatPresetAcceptsPath('video_compress', 'clip.mkv')).toBe(true);
    expect(winkGoFormatPresetAcceptsPath('audio_to_mp3', 'notes.docx')).toBe(false);
  });

  it('sanitizes Windows output names and tells FFmpeg never to overwrite', () => {
    expect(safeWinkGoFormatOutputStem('bad:name?.ncm')).toBe('bad_name_');
    const argumentsList = buildWinkGoFfmpegArguments('video_compress', 'input.mkv', 'output.mp4');
    expect(argumentsList).toContain('-n');
    expect(argumentsList).toContain('veryfast');
    expect(argumentsList).not.toContain('-y');
  });

  it('decodes an NCM MP3 stream in fixed-size chunks and preserves an existing output', async () => {
    const root = await createTemporaryRoot();
    const outputFolder = path.join(root, 'output');
    const input = path.join(root, 'song.ncm');
    const existingOutput = path.join(outputFolder, 'song.mp3');
    const payload = Buffer.concat([
      Buffer.from('ID3\x04\0\0\0\0\0\0WINK-GO-TEST-AUDIO'),
      Buffer.from(Array.from({ length: 150_000 }, (_, index) => index & 0xff)),
    ]);
    await writeFile(input, createSyntheticNcm(payload));
    await mkdir(outputFolder, { recursive: true });
    await writeFile(existingOutput, 'existing');

    const progress: number[] = [];
    const report = await runWinkGoFormatConversion(
      {
        jobId: 'ncm-test',
        preset: 'ncm_to_mp3',
        paths: [input],
        outputFolder,
      },
      (event) => progress.push(event.percent)
    );

    expect(report.items[0]).toMatchObject({ success: true, sourceName: 'song.ncm' });
    expect(path.basename(report.items[0].outputPath!)).toBe('song (2).mp3');
    expect(await readFile(existingOutput, 'utf8')).toBe('existing');
    expect(await readFile(report.items[0].outputPath!)).toEqual(payload);
    expect(progress).toEqual(expect.arrayContaining([6, 24, 62, 100]));
  });
});
