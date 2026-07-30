import { describe, expect, it } from 'vitest';
import {
  getInstallerGroups,
  INSTALLER_CATALOG,
  isTrustedInstallerUrl,
} from '@/renderer/pages/guid/components/InstallerCenter/installerCatalog';

describe('installer catalog', () => {
  it('accepts every configured installer URL', () => {
    const results = INSTALLER_CATALOG.map((installer) => isTrustedInstallerUrl(installer.downloadUrl));

    expect(results).toHaveLength(6);
    expect(results.every(Boolean)).toBe(true);
  });

  it('uses only official vendor pages for Codex and Claude Code', () => {
    const vendorUrls = INSTALLER_CATALOG.filter((installer) => installer.product !== 'antigravity').map(
      (installer) => new URL(installer.downloadUrl).hostname
    );

    expect(vendorUrls).toEqual(['openai.com', 'docs.anthropic.com', 'openai.com', 'docs.anthropic.com']);
    expect(INSTALLER_CATALOG.some((installer) => installer.downloadUrl.includes('xuweihafeichangniu-lab'))).toBe(false);
  });

  it.each(['http://github.com/example/installer.exe', 'https://github.com/example/installer.exe', 'not-a-url'])(
    'rejects an untrusted installer URL: %s',
    (url) => {
      expect(isTrustedInstallerUrl(url)).toBe(false);
    }
  );

  it('orders the preferred platform first and keeps three packages per platform', () => {
    const groups = getInstallerGroups('macos');

    expect(groups.map((group) => group.platform)).toEqual(['macos', 'windows']);
    expect(groups.map((group) => group.installers.length)).toEqual([3, 3]);
  });
});
