/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { AndroidConfig, type IOSConfig } from '@expo/config-plugins';

import appConfig from '../app.config';
import {
  applyAndroidLocalNetworkAccess,
  applyIosLocalNetworkAccess,
  LOCAL_NETWORK_USAGE_DESCRIPTION,
} from '../plugins/withLocalNetworkAccess';

function createAndroidManifest(): AndroidConfig.Manifest.AndroidManifest {
  return {
    manifest: {
      $: {
        'xmlns:android': 'http://schemas.android.com/apk/res/android',
      },
      queries: [],
      application: [
        {
          $: {
            'android:name': '.MainApplication',
            'android:allowBackup': 'false',
          },
        },
      ],
    },
  };
}

describe('mobile native local-network configuration', () => {
  it('enables Android cleartext transport without replacing unrelated application attributes', () => {
    const manifest = createAndroidManifest();

    const result = applyAndroidLocalNetworkAccess(manifest);
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(result);

    expect(application.$['android:usesCleartextTraffic']).toBe('true');
    expect(application.$['android:allowBackup']).toBe('false');
  });

  it('fails closed when an Android manifest has no main application', () => {
    const manifest = createAndroidManifest();
    manifest.manifest.application = [];

    expect(() => applyAndroidLocalNetworkAccess(manifest)).toThrow();
  });

  it('allows only local iOS networking while removing a global ATS bypass', () => {
    const exceptionDomains = {
      localhost: {
        NSExceptionAllowsInsecureHTTPLoads: true,
      },
    };
    const infoPlist = {
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
        NSExceptionDomains: exceptionDomains,
      },
    } as IOSConfig.InfoPlist;

    const result = applyIosLocalNetworkAccess(infoPlist);
    const transportSecurity = result.NSAppTransportSecurity as {
      NSAllowsArbitraryLoads?: boolean;
      NSAllowsLocalNetworking?: boolean;
      NSExceptionDomains?: unknown;
    };

    expect(transportSecurity.NSAllowsLocalNetworking).toBe(true);
    expect(transportSecurity.NSAllowsArbitraryLoads).toBeUndefined();
    expect(transportSecurity.NSExceptionDomains).toEqual(exceptionDomains);
  });

  it('declares the local-network purpose and registers the native plugin last', () => {
    const config = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);

    expect(config.ios?.infoPlist?.NSLocalNetworkUsageDescription).toBe(LOCAL_NETWORK_USAGE_DESCRIPTION);
    expect(config.ios?.infoPlist?.NSAppTransportSecurity).toEqual({
      NSAllowsLocalNetworking: true,
    });
    expect(config.plugins?.at(-1)).toBe('./plugins/withLocalNetworkAccess.ts');
  });
});
