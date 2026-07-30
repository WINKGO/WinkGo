import { describe, expect, it } from 'vitest';
import {
  hasWinkGoCapability,
  normalizeWinkGoBuildEdition,
  resolveWinkGoEditionSnapshot,
} from '../../../packages/desktop/src/common/types/platform/winkGoEdition';

describe('WINK GO edition boundary', () => {
  it('fails closed to Free when the build edition is absent or invalid', () => {
    expect(normalizeWinkGoBuildEdition(undefined)).toBe('free');
    expect(normalizeWinkGoBuildEdition('enterprise')).toBe('free');
    expect(normalizeWinkGoBuildEdition('PRO')).toBe('pro');
  });

  it('keeps Free branding while launch policy grants the complete experience', () => {
    const edition = resolveWinkGoEditionSnapshot({
      buildEdition: 'free',
      authenticated: true,
      entitlements: {},
    });

    expect(edition.accountEdition).toBe('free');
    expect(edition.productCode).toBe('winkgo.free');
    expect(edition.displayName).toBe('WINK GO');
    expect(hasWinkGoCapability(edition, 'format.local')).toBe(true);
    expect(hasWinkGoCapability(edition, 'mcp.local')).toBe(true);
    expect(hasWinkGoCapability(edition, 'mcp.miniapp')).toBe(true);
    expect(hasWinkGoCapability(edition, 'canvas.ai')).toBe(true);
    expect(hasWinkGoCapability(edition, 'remote.desktop')).toBe(true);
    expect(edition.limits.devices).toBe(3);
    expect(edition.upgradeRequired).toBe(false);
  });

  it('requires both a Pro build and a signed Pro entitlement', () => {
    const unlicensed = resolveWinkGoEditionSnapshot({
      buildEdition: 'pro',
      authenticated: true,
      entitlements: {},
    });
    const capabilityOnly = resolveWinkGoEditionSnapshot({
      buildEdition: 'pro',
      authenticated: true,
      entitlements: {
        'edition.pro': false,
        'desktop.pro': true,
      },
    });
    const licensed = resolveWinkGoEditionSnapshot({
      buildEdition: 'pro',
      authenticated: true,
      entitlements: {
        'edition.pro': true,
      },
    });

    expect(unlicensed.accountEdition).toBe('free');
    expect(unlicensed.upgradeRequired).toBe(true);
    expect(hasWinkGoCapability(unlicensed, 'skills.premium')).toBe(false);

    expect(capabilityOnly.accountEdition).toBe('free');
    expect(capabilityOnly.productCode).toBe('winkgo.free');
    expect(capabilityOnly.displayName).toBe('WINK GO');
    expect(capabilityOnly.upgradeRequired).toBe(true);
    expect(hasWinkGoCapability(capabilityOnly, 'desktop.pro')).toBe(false);

    expect(licensed.accountEdition).toBe('pro');
    expect(licensed.productCode).toBe('winkgo.pro');
    expect(licensed.limits.devices).toBe(3);
    expect(hasWinkGoCapability(licensed, 'skills.premium')).toBe(true);
    expect(hasWinkGoCapability(licensed, 'inspiration.full')).toBe(true);
  });

  it('keeps the explicit development bypass scoped to Pro identity', () => {
    const proDevelopment = resolveWinkGoEditionSnapshot({
      buildEdition: 'pro',
      authenticated: true,
      developmentBypass: true,
    });
    const freeDevelopment = resolveWinkGoEditionSnapshot({
      buildEdition: 'free',
      authenticated: true,
      developmentBypass: true,
    });

    expect(proDevelopment.accountEdition).toBe('pro');
    expect(freeDevelopment.accountEdition).toBe('free');
    expect(hasWinkGoCapability(freeDevelopment, 'skills.premium')).toBe(true);
  });
});
