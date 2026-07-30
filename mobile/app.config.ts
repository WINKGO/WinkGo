import { ExpoConfig, ConfigContext } from 'expo/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import VERSION from './versions/version.json';

const repositoryRoot = resolve(__dirname, '..');
const legalDocuments = {
  license: readFileSync(resolve(repositoryRoot, 'LICENSE'), 'utf8'),
  notice: readFileSync(resolve(repositoryRoot, 'NOTICE'), 'utf8'),
  thirdPartyNotices: readFileSync(resolve(repositoryRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
};

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    name: 'WINK GO',
    slug: 'winkgo-mobile',
    version: VERSION.version,
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'winkgo-mobile',
    userInterfaceStyle: 'automatic',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'ai.resopod.winkgo',
      buildNumber: String(VERSION.buildNumber),
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription: 'WINK GO needs camera access to scan QR codes for server login.',
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/images/icon.png',
        backgroundColor: '#000000',
      },
      package: 'ai.resopod.winkgo',
      versionCode: VERSION.buildNumber,
    },
    web: {
      output: 'static',
      favicon: './assets/images/icon.png',
    },
    plugins: ['expo-router', 'expo-secure-store', 'expo-dev-client', 'expo-camera'],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      legalDocuments,
      eas: {
        projectId: '34b66303-fd5c-4d86-a790-0665d55f2017',
      },
    },
  };
};
