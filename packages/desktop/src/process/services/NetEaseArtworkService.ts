/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WinkGoMediaSnapshot } from '@/common/adapter/ipcBridge';
import { app } from 'electron';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { findNetEaseArtworkUrl, type NetEaseHistoryRow } from './NetEaseArtworkMatcher';

type SqliteDatabase = {
  prepare: (sql: string) => { all: () => NetEaseHistoryRow[] };
  close: () => void;
};

type SqliteConstructor = new (
  filename: string,
  options: { readonly: boolean; fileMustExist: boolean; timeout: number }
) => SqliteDatabase;

type CacheEntry = { expiresAt: number; url: string };

const artworkCache = new Map<string, CacheEntry>();
const SUCCESS_TTL_MS = 12 * 60 * 60 * 1000;
const MISS_TTL_MS = 5_000;

export const isNetEaseMediaSnapshot = (snapshot: Pick<WinkGoMediaSnapshot, 'appId'>): boolean =>
  /cloudmusic|netease|music\.163|com\.netease/i.test(snapshot.appId);

const resolveLibraryPath = (): string => {
  const localAppData = process.env.LOCALAPPDATA || path.join(path.dirname(app.getPath('appData')), 'Local');
  return path.join(localAppData, 'NetEase', 'CloudMusic', 'Library', 'webdb.dat');
};

const loadSqliteConstructor = (): SqliteConstructor => {
  const requireNative = createRequire(path.join(app.getAppPath(), 'package.json'));
  return requireNative('better-sqlite3') as SqliteConstructor;
};

export const resolveNetEaseArtworkUrl = (snapshot: WinkGoMediaSnapshot): string => {
  if (snapshot.coverUrl || !isNetEaseMediaSnapshot(snapshot)) return snapshot.coverUrl;

  const cacheKey = `${snapshot.appId}\u0000${snapshot.title}\u0000${snapshot.artist}`.toLocaleLowerCase();
  const cached = artworkCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const libraryPath = resolveLibraryPath();
  if (!fs.existsSync(libraryPath)) {
    artworkCache.set(cacheKey, { url: '', expiresAt: Date.now() + MISS_TTL_MS });
    return '';
  }

  let database: SqliteDatabase | undefined;
  try {
    const BetterSqlite3 = loadSqliteConstructor();
    database = new BetterSqlite3(libraryPath, { readonly: true, fileMustExist: true, timeout: 300 });
    const rows = database.prepare('SELECT jsonStr FROM historyTracks ORDER BY playtime DESC LIMIT 300').all();
    const url = findNetEaseArtworkUrl(snapshot, rows);
    artworkCache.set(cacheKey, {
      url,
      expiresAt: Date.now() + (url ? SUCCESS_TTL_MS : MISS_TTL_MS),
    });
    return url;
  } catch (error) {
    console.warn('[WinkGoWindowsRuntime] NetEase local artwork lookup failed:', error);
    artworkCache.set(cacheKey, { url: '', expiresAt: Date.now() + MISS_TTL_MS });
    return '';
  } finally {
    database?.close();
  }
};
