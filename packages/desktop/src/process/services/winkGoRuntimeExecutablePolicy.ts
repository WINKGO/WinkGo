/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const EXECUTABLE_NAME = 'SparkBot-MCP-Hub-v1.1.0.exe';

export type WinkGoRuntimeSearchRoots = {
  localAppData: string;
  resourcesPath: string;
  explicitRuntimeRoot?: string;
};

export type WinkGoRuntimeExecutableSource = 'explicit_bundle' | 'installed_release' | 'packaged' | 'legacy' | 'missing';

export type WinkGoRuntimeIdentity = {
  installed: boolean;
  executablePath: string;
  logPath: string;
  source: WinkGoRuntimeExecutableSource;
  legacyFallback: boolean;
  modifiedAtMs: number;
};

type RuntimeCandidate = {
  executablePath: string;
  source: Exclude<WinkGoRuntimeExecutableSource, 'missing'>;
};

export const shouldRestartWinkGoRuntimeForUpgrade = ({
  runningBuildAtMs,
  preferredRuntimeModifiedAtMs,
}: {
  runningBuildAtMs: number;
  preferredRuntimeModifiedAtMs: number;
}): boolean =>
  Number.isFinite(runningBuildAtMs) &&
  runningBuildAtMs > 0 &&
  Number.isFinite(preferredRuntimeModifiedAtMs) &&
  preferredRuntimeModifiedAtMs > runningBuildAtMs;

const explicitRuntimeExecutables = (root: string | undefined): string[] => {
  if (!root?.trim()) return [];
  const normalized = path.resolve(root);
  return [
    path.join(normalized, 'SparkBot-MCP-Hub-v1.1.0-release', EXECUTABLE_NAME),
    path.join(normalized, EXECUTABLE_NAME),
  ].filter(existsSync);
};

const installedReleaseExecutables = (root: string): string[] => {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.includes('.old-'))
    .map((entry) => path.join(root, entry.name, EXECUTABLE_NAME))
    .filter(existsSync)
    .toSorted((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
};

export const resolvePreferredWinkGoRuntimeExecutable = ({
  localAppData,
  resourcesPath,
  explicitRuntimeRoot,
}: WinkGoRuntimeSearchRoots): string | null =>
  resolvePreferredWinkGoRuntimeIdentity({ localAppData, resourcesPath, explicitRuntimeRoot }).executablePath || null;

export const resolvePreferredWinkGoRuntimeIdentity = ({
  localAppData,
  resourcesPath,
  explicitRuntimeRoot,
}: WinkGoRuntimeSearchRoots): WinkGoRuntimeIdentity => {
  const releasesRoot = path.join(localAppData, 'Wink Go', 'data', 'runtime', 'xiaozhi');
  const explicitCandidates: RuntimeCandidate[] = explicitRuntimeExecutables(explicitRuntimeRoot).map(
    (executablePath) => ({
      executablePath,
      source: 'explicit_bundle' as const,
    })
  );
  const modernCandidates: RuntimeCandidate[] = [
    ...installedReleaseExecutables(releasesRoot).map((executablePath) => ({
      executablePath,
      source: 'installed_release' as const,
    })),
    {
      executablePath: path.join(resourcesPath, 'winkgo-runtime', EXECUTABLE_NAME),
      source: 'packaged' as const,
    },
  ]
    .filter(({ executablePath }) => existsSync(executablePath))
    .toSorted((left, right) => statSync(right.executablePath).mtimeMs - statSync(left.executablePath).mtimeMs);
  const candidates: RuntimeCandidate[] = [
    ...explicitCandidates,
    ...modernCandidates,
    {
      executablePath: path.join(localAppData, 'Wink Go', 'winkgo-runtime', EXECUTABLE_NAME),
      source: 'legacy',
    },
  ];
  const selected = candidates.find(({ executablePath }) => existsSync(executablePath));
  if (!selected) {
    return {
      installed: false,
      executablePath: '',
      logPath: '',
      source: 'missing',
      legacyFallback: false,
      modifiedAtMs: 0,
    };
  }
  return {
    installed: true,
    executablePath: selected.executablePath,
    logPath: path.join(path.dirname(selected.executablePath), 'logs', 'sparkbot.log'),
    source: selected.source,
    legacyFallback: selected.source === 'legacy',
    modifiedAtMs: statSync(selected.executablePath).mtimeMs,
  };
};
