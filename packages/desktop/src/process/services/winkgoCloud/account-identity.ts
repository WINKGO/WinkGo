/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';

const CLOUD_ACCOUNT_ID_PATTERN = /^u_[a-f0-9]{24}$/;
const LICENSE_ACCOUNT_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const clean = (value: unknown, max: number): string =>
  (typeof value === 'string' || typeof value === 'number' ? String(value) : '').trim().toLowerCase().slice(0, max);

export const isWinkGoCloudAccountId = (value: unknown): boolean => CLOUD_ACCOUNT_ID_PATTERN.test(clean(value, 64));

export const isWinkGoLicenseAccountId = (value: unknown): boolean => LICENSE_ACCOUNT_ID_PATTERN.test(clean(value, 64));

export const toWinkGoCloudAccountId = (accountId: unknown, username = ''): string => {
  const normalizedAccountId = clean(accountId, 128);
  if (CLOUD_ACCOUNT_ID_PATTERN.test(normalizedAccountId)) return normalizedAccountId;

  const normalizedUsername = clean(username, 128);
  const seed = LICENSE_ACCOUNT_ID_PATTERN.test(normalizedAccountId)
    ? `license-account:${normalizedAccountId}`
    : `username:${normalizedUsername}`;
  return `u_${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
};

export const cloudAccountMatchesLicenseAccount = (cloudAccountId: unknown, licenseAccountId: unknown): boolean =>
  isWinkGoCloudAccountId(cloudAccountId) &&
  isWinkGoLicenseAccountId(licenseAccountId) &&
  clean(cloudAccountId, 64) === toWinkGoCloudAccountId(licenseAccountId);
