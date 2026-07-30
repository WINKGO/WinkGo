/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export type WinkGoBuildEdition = 'free' | 'pro';
export type WinkGoAccountEdition = 'free' | 'pro';

export type WinkGoCapability =
  | 'desktop.core'
  | 'models.custom'
  | 'mcp.local'
  | 'skills.free'
  | 'inspiration.basic'
  | 'island.local'
  | 'format.local'
  | 'files.local'
  | 'desktop.pro'
  | 'mcp.managed'
  | 'mcp.miniapp'
  | 'mcp.sync'
  | 'skills.premium'
  | 'skills.cloud-catalog'
  | 'inspiration.full'
  | 'canvas.ai'
  | 'devices.multi'
  | 'remote.desktop';

export interface WinkGoEditionSnapshot {
  buildEdition: WinkGoBuildEdition;
  accountEdition: WinkGoAccountEdition;
  displayName: 'WINK GO' | 'WINK GO Pro';
  productCode: 'winkgo.free' | 'winkgo.pro';
  capabilities: WinkGoCapability[];
  limits: {
    devices: number;
  };
  upgradeRequired: boolean;
}

export const WINKGO_FREE_CAPABILITIES: readonly WinkGoCapability[] = [
  'desktop.core',
  'models.custom',
  'mcp.local',
  'skills.free',
  'inspiration.basic',
  'island.local',
  'format.local',
  'files.local',
];

export const WINKGO_PRO_CAPABILITIES: readonly WinkGoCapability[] = [
  ...WINKGO_FREE_CAPABILITIES,
  'desktop.pro',
  'mcp.managed',
  'mcp.miniapp',
  'mcp.sync',
  'skills.premium',
  'skills.cloud-catalog',
  'inspiration.full',
  'canvas.ai',
  'devices.multi',
  'remote.desktop',
];

/**
 * Launch policy: the public Free build currently includes the complete product
 * experience. Keeping this policy in the shared capability resolver lets a
 * future paid rollout restore the Free/Pro boundary without forking the app.
 */
export const WINKGO_FREE_FULL_ACCESS = true;

export const normalizeWinkGoBuildEdition = (value: unknown): WinkGoBuildEdition =>
  String(value || '')
    .trim()
    .toLowerCase() === 'pro'
    ? 'pro'
    : 'free';

/**
 * Product identity is controlled only by the signed edition entitlement.
 * `desktop.pro` is a capability grant and must never promote a Free account or
 * build to the WINK GO Pro product identity.
 */
const hasProEntitlement = (entitlements: Record<string, unknown> | null | undefined): boolean =>
  entitlements?.['edition.pro'] === true;

export const resolveWinkGoEditionSnapshot = ({
  buildEdition,
  authenticated,
  entitlements,
  developmentBypass = false,
}: {
  buildEdition: WinkGoBuildEdition;
  authenticated: boolean;
  entitlements?: Record<string, unknown> | null;
  developmentBypass?: boolean;
}): WinkGoEditionSnapshot => {
  const accountEdition: WinkGoAccountEdition =
    buildEdition === 'pro' && authenticated && (developmentBypass || hasProEntitlement(entitlements)) ? 'pro' : 'free';
  const proEnabled = buildEdition === 'pro' && accountEdition === 'pro';
  const fullAccessEnabled = proEnabled || (buildEdition === 'free' && WINKGO_FREE_FULL_ACCESS);

  return {
    buildEdition,
    accountEdition,
    displayName: proEnabled ? 'WINK GO Pro' : 'WINK GO',
    productCode: proEnabled ? 'winkgo.pro' : 'winkgo.free',
    capabilities: [...(fullAccessEnabled ? WINKGO_PRO_CAPABILITIES : WINKGO_FREE_CAPABILITIES)],
    limits: {
      devices: fullAccessEnabled ? 3 : 1,
    },
    upgradeRequired: buildEdition === 'pro' && authenticated && !proEnabled,
  };
};

export const hasWinkGoCapability = (
  edition: Pick<WinkGoEditionSnapshot, 'capabilities'>,
  capability: WinkGoCapability
): boolean => edition.capabilities.includes(capability);
