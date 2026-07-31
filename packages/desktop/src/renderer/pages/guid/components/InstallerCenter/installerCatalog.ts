export type InstallerPlatform = 'windows' | 'macos';
export type InstallerProduct = 'codex' | 'claude' | 'antigravity';
export type InstallerTone = 'orange' | 'indigo' | 'pink';

export type InstallerItem = {
  id: string;
  product: InstallerProduct;
  productName: string;
  platform: InstallerPlatform;
  tone: InstallerTone;
  downloadUrl: string;
};

export const INSTALLER_CATALOG: readonly InstallerItem[] = [
  {
    id: 'codex-windows',
    product: 'codex',
    productName: 'Codex',
    platform: 'windows',
    tone: 'orange',
    downloadUrl: 'https://openai.com/codex/',
  },
  {
    id: 'claude-windows',
    product: 'claude',
    productName: 'Claude Code',
    platform: 'windows',
    tone: 'indigo',
    downloadUrl: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
  },
  {
    id: 'antigravity-windows',
    product: 'antigravity',
    productName: 'Antigravity',
    platform: 'windows',
    tone: 'pink',
    downloadUrl: 'https://antigravity.google/download',
  },
  {
    id: 'codex-macos',
    product: 'codex',
    productName: 'Codex',
    platform: 'macos',
    tone: 'orange',
    downloadUrl: 'https://openai.com/codex/',
  },
  {
    id: 'claude-macos',
    product: 'claude',
    productName: 'Claude Code',
    platform: 'macos',
    tone: 'indigo',
    downloadUrl: 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
  },
  {
    id: 'antigravity-macos',
    product: 'antigravity',
    productName: 'Antigravity',
    platform: 'macos',
    tone: 'pink',
    downloadUrl: 'https://antigravity.google/download',
  },
] as const;

const TRUSTED_INSTALLER_URLS = new Set(INSTALLER_CATALOG.map((item) => item.downloadUrl));

export const isTrustedInstallerUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && TRUSTED_INSTALLER_URLS.has(parsed.toString());
  } catch {
    return false;
  }
};

export const getInstallerGroups = (
  preferredPlatform: InstallerPlatform
): Array<{ platform: InstallerPlatform; installers: InstallerItem[] }> => {
  const platforms: InstallerPlatform[] = preferredPlatform === 'macos' ? ['macos', 'windows'] : ['windows', 'macos'];

  return platforms.map((platform) => ({
    platform,
    installers: INSTALLER_CATALOG.filter((item) => item.platform === platform),
  }));
};
