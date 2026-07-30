/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { app } from 'electron';
import { ipcBridge } from '@/common';
import type { WinkGoGeneratedImageRecoveryResult } from '@/common/adapter/ipcBridge';

const IMAGE_EVENT_TYPE = 'image_generation_end';
const VALID_CALL_ID = /^[A-Za-z0-9_-]{4,160}$/;
const MAX_BASE64_LENGTH = 80 * 1024 * 1024;
const IMAGE_EXTENSIONS = ['png', 'jpg', 'webp', 'gif'] as const;
const recoveryTasks = new Map<string, Promise<WinkGoGeneratedImageRecoveryResult>>();

type RecoveryOptions = {
  sessionsRoot?: string;
  outputRoot?: string;
};

type CodexImageGenerationEvent = {
  type?: string;
  payload?: {
    type?: string;
    call_id?: string;
    result?: string;
  };
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const inferImageExtension = (base64: string): (typeof IMAGE_EXTENSIONS)[number] | null => {
  if (base64.startsWith('iVBOR')) return 'png';
  if (base64.startsWith('/9j/')) return 'jpg';
  if (base64.startsWith('UklGR')) return 'webp';
  if (base64.startsWith('R0lGOD')) return 'gif';
  return null;
};

const normalizeBase64Result = (
  result: string
): { base64: string; extension: (typeof IMAGE_EXTENSIONS)[number] } | null => {
  const match = result.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([\s\S]+)$/);
  const base64 = match?.[2] ?? result;
  if (!base64 || base64.length > MAX_BASE64_LENGTH) return null;

  const extension = match?.[1] === 'jpeg' ? 'jpg' : match?.[1] || inferImageExtension(base64);
  if (!extension || !IMAGE_EXTENSIONS.includes(extension as (typeof IMAGE_EXTENSIONS)[number])) return null;
  return { base64, extension: extension as (typeof IMAGE_EXTENSIONS)[number] };
};

const listSessionFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];

  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    const directories: string[] = [];
    entries.sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(target);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(target);
      }
    }
    await Promise.all(directories.map(visit));
  };

  await visit(root);
  return files.toSorted((a, b) => b.localeCompare(a));
};

const findImageResult = async (sessionFile: string, callId: string): Promise<string | null> => {
  const lines = readline.createInterface({
    input: createReadStream(sessionFile, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lines) {
      if (!line.includes(callId) || !line.includes(IMAGE_EVENT_TYPE)) continue;
      try {
        const event = JSON.parse(line) as CodexImageGenerationEvent;
        if (
          event.type === 'event_msg' &&
          event.payload?.type === IMAGE_EVENT_TYPE &&
          event.payload.call_id === callId &&
          typeof event.payload.result === 'string'
        ) {
          return event.payload.result;
        }
      } catch {
        // Ignore malformed log lines and continue searching other events.
      }
    }
  } finally {
    lines.close();
  }

  return null;
};

const findCachedImage = async (outputRoot: string, callId: string): Promise<string | null> => {
  const candidates = IMAGE_EXTENSIONS.map((extension) => path.join(outputRoot, `${callId}.${extension}`));
  const matches = await Promise.all(
    candidates.map(async (candidate) => ((await pathExists(candidate)) ? candidate : null))
  );
  return matches.find((candidate): candidate is string => candidate !== null) ?? null;
};

const findImageResultInSessions = async (sessionFiles: string[], callId: string, index = 0): Promise<string | null> => {
  if (index >= sessionFiles.length) return null;
  const result = await findImageResult(sessionFiles[index], callId);
  return result ?? findImageResultInSessions(sessionFiles, callId, index + 1);
};

export async function recoverCodexGeneratedImage(
  callId: string,
  options: RecoveryOptions = {}
): Promise<WinkGoGeneratedImageRecoveryResult> {
  if (!VALID_CALL_ID.test(callId)) return { path: null, recovered: false };

  const sessionsRoot = options.sessionsRoot ?? path.join(homedir(), '.codex', 'sessions');
  const outputRoot = options.outputRoot ?? path.join(app.getPath('userData'), 'generated-images');
  const cached = await findCachedImage(outputRoot, callId);
  if (cached) return { path: cached, recovered: false };

  const rawResult = await findImageResultInSessions(await listSessionFiles(sessionsRoot), callId);
  if (!rawResult) {
    console.warn('[WinkGoImages] Generated image result was not found', { callId });
    return { path: null, recovered: false };
  }

  const image = normalizeBase64Result(rawResult);
  if (!image) {
    console.warn('[WinkGoImages] Ignored an invalid generated image result', { callId });
    return { path: null, recovered: false };
  }

  await mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, `${callId}.${image.extension}`);
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, Buffer.from(image.base64, 'base64'));
  await rename(temporaryPath, outputPath);
  console.info('[WinkGoImages] Restored generated image preview', { callId });
  return { path: outputPath, recovered: true };
}

export function initWinkGoImageBridge(): void {
  ipcBridge.winkGoImages.recoverGeneratedImage.provider(({ callId }) => {
    const existing = recoveryTasks.get(callId);
    if (existing) return existing;

    const task = recoverCodexGeneratedImage(callId).finally(() => recoveryTasks.delete(callId));
    recoveryTasks.set(callId, task);
    return task;
  });
}
