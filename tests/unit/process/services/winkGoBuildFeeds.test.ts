import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEdition = process.env.WINKGO_EDITION;

afterEach(() => {
  if (originalEdition === undefined) delete process.env.WINKGO_EDITION;
  else process.env.WINKGO_EDITION = originalEdition;
  vi.resetModules();
});

describe('WINK GO edition-specific update feeds', () => {
  it.each([
    {
      edition: 'free',
      manifest: 'https://winkgo.top/winkgo-free-update.json',
      feed: 'https://winkgo.top/releases/free',
    },
    {
      edition: 'pro',
      manifest: 'https://winkgo.top/winkgo-pro-update.json',
      feed: 'https://winkgo.top/releases/pro',
    },
  ])('keeps the $edition build on its own release channel', async ({ edition, manifest, feed }) => {
    process.env.WINKGO_EDITION = edition;
    vi.resetModules();

    const updateManifest = await import('@/process/services/winkGoUpdateManifest');
    const updateFeed = await import('@/process/services/updateFeed');

    expect(updateManifest.WINKGO_UPDATE_MANIFEST_URL).toBe(manifest);
    expect(updateFeed.CDN_UPDATE_BASE_URL).toBe(feed);
    expect(updateFeed.buildCdnFeedOptions().url).toBe(feed);
  });
});
