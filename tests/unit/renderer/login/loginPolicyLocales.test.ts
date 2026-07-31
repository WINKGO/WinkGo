import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '../../../..');
const localesRoot = resolve(projectRoot, 'packages/desktop/src/renderer/services/i18n/locales');
const i18nConfig = JSON.parse(
  readFileSync(resolve(projectRoot, 'packages/desktop/src/common/config/i18n-config.json'), 'utf8')
) as {
  supportedLanguages: string[];
};

const REQUIRED_POLICY_KEYS = [
  'dataDisclosure',
  'agreementCheckbox',
  'agreementPrefix',
  'termsOfService',
  'agreementAnd',
  'privacyPolicy',
  'policyModalTitle',
  'policyBaselineNotice',
] as const;

describe('login policy locales', () => {
  it('provides the same account-data disclosure and consent controls in every configured locale', () => {
    const localeNames = readdirSync(localesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const configuredLocaleNames = [...i18nConfig.supportedLanguages].sort();

    expect(localeNames).toEqual(configuredLocaleNames);

    for (const localeName of localeNames) {
      const filePath = resolve(localesRoot, localeName, 'login.json');
      const source = readFileSync(filePath, 'utf8');
      const login = JSON.parse(source) as Record<string, unknown> & {
        errors?: Record<string, unknown>;
      };

      for (const key of REQUIRED_POLICY_KEYS) {
        expect(typeof login[key], `${localeName}.${key}`).toBe('string');
        expect(String(login[key]).trim().length, `${localeName}.${key}`).toBeGreaterThan(0);
      }
      expect(typeof login.errors?.agreementRequired, `${localeName}.errors.agreementRequired`).toBe('string');
      expect(login).not.toHaveProperty('localPrivacy');
      expect(source, localeName).not.toMatch(/heartbeat|心跳|ハートビート|하트비트/i);
    }
  });
});
