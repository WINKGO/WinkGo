/**
 * @license
 * Copyright 2026 WINK GO contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: {
    deepLink: {
      received: {
        emit: vi.fn(),
      },
    },
  },
}));

const loadParser = async () => {
  vi.resetModules();
  process.env.WINKGO_EDITION = 'free';
  return import('@/process/utils/deepLink');
};

describe('deep-link parser security', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a bounded provider prefill without credentials', async () => {
    const { parseDeepLinkUrl } = await loadParser();
    expect(
      parseDeepLinkUrl('winkgo://add-provider?base_url=https%3A%2F%2Fapi.example.com%2Fv1&name=Example&platform=openai')
    ).toEqual({
      action: 'add-provider',
      params: {
        base_url: 'https://api.example.com/v1',
        name: 'Example',
        platform: 'openai',
      },
    });
  });

  it('accepts safe base64 provider metadata', async () => {
    const { parseDeepLinkUrl } = await loadParser();
    const data = Buffer.from(
      JSON.stringify({ base_url: 'http://127.0.0.1:3000/v1', name: 'Local', platform: 'openai' })
    ).toString('base64url');
    expect(parseDeepLinkUrl(`winkgo://provider/add?v=1&data=${encodeURIComponent(data)}`)).toEqual({
      action: 'provider/add',
      params: {
        v: '1',
        base_url: 'http://127.0.0.1:3000/v1',
        name: 'Local',
        platform: 'openai',
      },
    });
  });

  it('rejects credentials in query strings or encoded JSON', async () => {
    const { parseDeepLinkUrl } = await loadParser();
    expect(parseDeepLinkUrl('winkgo://add-provider?base_url=https://api.example.com&api_key=sk-secret')).toBeNull();

    const data = Buffer.from(JSON.stringify({ base_url: 'https://api.example.com', api_key: 'sk-secret' })).toString(
      'base64'
    );
    expect(parseDeepLinkUrl(`winkgo://provider/add?data=${encodeURIComponent(data)}`)).toBeNull();
  });

  it('rejects unknown actions, duplicate keys, nested values, and oversized input', async () => {
    const { parseDeepLinkUrl } = await loadParser();
    expect(parseDeepLinkUrl('winkgo://unknown?route=%2Fguid')).toBeNull();
    expect(
      parseDeepLinkUrl('winkgo://add-provider?base_url=https://one.example&base_url=https://two.example')
    ).toBeNull();

    const nested = Buffer.from(JSON.stringify({ base_url: { href: 'https://api.example.com' } })).toString('base64');
    expect(parseDeepLinkUrl(`winkgo://provider/add?data=${encodeURIComponent(nested)}`)).toBeNull();
    expect(parseDeepLinkUrl(`winkgo://navigate?route=${'a'.repeat(9 * 1024)}`)).toBeNull();
  });
});
