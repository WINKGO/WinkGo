/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as configPluginsNamespace from '@expo/config-plugins';
import type { AndroidConfig as AndroidConfigTypes, ConfigPlugin, IOSConfig } from '@expo/config-plugins';

type ConfigPluginsModule = typeof import('@expo/config-plugins');
const configPlugins =
  'AndroidConfig' in configPluginsNamespace
    ? configPluginsNamespace
    : (configPluginsNamespace as unknown as { default: ConfigPluginsModule }).default;
const { AndroidConfig, withAndroidManifest, withInfoPlist } = configPlugins;

export const LOCAL_NETWORK_USAGE_DESCRIPTION =
  'WINK GO uses your local network to connect to your WINK GO desktop app.';

type PlistValue = Exclude<IOSConfig.InfoPlist[string], undefined>;
type AppTransportSecurity = Record<string, PlistValue> & {
  NSAllowsArbitraryLoads?: boolean;
  NSAllowsLocalNetworking?: boolean;
};

export function applyAndroidLocalNetworkAccess(
  androidManifest: AndroidConfigTypes.Manifest.AndroidManifest
): AndroidConfigTypes.Manifest.AndroidManifest {
  const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);

  // Android cannot express an RFC1918/CIDR-only cleartext allowlist in the
  // manifest. This platform switch is required for dynamic LAN IP addresses;
  // the pairing layer remains responsible for accepting only local endpoints.
  mainApplication.$['android:usesCleartextTraffic'] = 'true';
  return androidManifest;
}

export function applyIosLocalNetworkAccess(infoPlist: IOSConfig.InfoPlist): IOSConfig.InfoPlist {
  const currentTransportSecurity: AppTransportSecurity =
    typeof infoPlist.NSAppTransportSecurity === 'object' && infoPlist.NSAppTransportSecurity !== null
      ? (infoPlist.NSAppTransportSecurity as AppTransportSecurity)
      : {};
  const localTransportSecurity: AppTransportSecurity = {
    ...currentTransportSecurity,
    NSAllowsLocalNetworking: true,
  };

  delete localTransportSecurity.NSAllowsArbitraryLoads;
  infoPlist.NSAppTransportSecurity = localTransportSecurity;
  infoPlist.NSLocalNetworkUsageDescription = LOCAL_NETWORK_USAGE_DESCRIPTION;
  return infoPlist;
}

const withLocalNetworkAccess: ConfigPlugin = (config) => {
  const withAndroidAccess = withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = applyAndroidLocalNetworkAccess(modConfig.modResults);
    return modConfig;
  });

  return withInfoPlist(withAndroidAccess, (modConfig) => {
    modConfig.modResults = applyIosLocalNetworkAccess(modConfig.modResults);
    return modConfig;
  });
};

export default withLocalNetworkAccess;
