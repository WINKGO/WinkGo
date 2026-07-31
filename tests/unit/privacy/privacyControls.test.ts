import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../../..');
const readProjectFile = (relativePath: string): string => readFileSync(resolve(projectRoot, relativePath), 'utf8');

describe('privacy controls', () => {
  it('ships without automatic Sentry collectors or production telemetry opt-in', () => {
    const mainSentry = readProjectFile('packages/desktop/src/sentry.ts');
    const renderer = readProjectFile('packages/desktop/src/renderer/main.tsx');

    expect(mainSentry).toContain('return !app.isPackaged');
    expect(mainSentry).toContain('defaultIntegrations: []');
    expect(mainSentry).toContain('sendDefaultPii: false');
    expect(mainSentry).toContain('tracesSampleRate: 0');
    expect(renderer).toContain('defaultIntegrations: []');
    expect(renderer).toContain('sendDefaultPii: false');
    expect(renderer).toContain('tracesSampleRate: 0');
  });

  it('does not attach local logs or database diagnostics from the feedback form', () => {
    const modal = readProjectFile(
      'packages/desktop/src/renderer/components/settings/SettingsModal/contents/FeedbackReportModal.tsx'
    );
    const integrityDialog = readProjectFile(
      'packages/desktop/src/renderer/components/layout/InstallationIntegrityDialog.tsx'
    );

    expect(modal).toContain('collectLogs: false');
    expect(modal).not.toContain('collectDbDiagnostics: {');
    expect(integrityDialog).toContain('collectLogs: false');
    expect(integrityDialog).not.toContain('extra: {');
    expect(integrityDialog).not.toContain('tags: buildInstallationIntegrityTags');
  });

  it('truthfully describes feedback uploads in every supported locale', () => {
    const localesRoot = resolve(projectRoot, 'packages/desktop/src/renderer/services/i18n/locales');
    for (const locale of readdirSync(localesRoot)) {
      const settings = JSON.parse(readFileSync(resolve(localesRoot, locale, 'settings.json'), 'utf8')) as {
        bugReportAutoInfo?: string;
      };
      expect(settings.bugReportAutoInfo, locale).toBeTruthy();
      expect(settings.bugReportAutoInfo, locale).not.toMatch(
        /automatically attached|automatisch beigefügt|se (?:adjuntan|añaden) automáticamente|به‌صورت خودکار پیوست|automatiquement joints|自動的に添付|자동으로 첨부|автоматически прикрепляются|otomatik olarak eklenecektir|自动附带|自動附帶/i
      );
    }
  });

  it('keeps the optional cloud relay off until a user explicitly enables it', () => {
    const relayService = readProjectFile('packages/desktop/src/process/services/WinkGoXiaozhiService.ts');
    const authBridge = readProjectFile('packages/desktop/src/process/bridge/winkgo/authBridge.ts');
    const relaySettings = readProjectFile(
      'packages/desktop/src/renderer/pages/settings/ToolsSettings/XiaozhiMcpConnection.tsx'
    );

    expect(relayService).toMatch(/const defaultConfig[\s\S]*?relayEnabled:\s*false/);
    expect(relayService).toContain('const CURRENT_CONFIG_SCHEMA_VERSION = 5');
    expect(relayService).toContain('const CURRENT_RELAY_CONSENT_VERSION = 1');
    expect(relayService).toContain('relayEnabled: hasCurrentRelayConsent && raw.relayEnabled === true');
    expect(relayService).toContain(
      'config.relayConsentVersion = request.relayEnabled ? CURRENT_RELAY_CONSENT_VERSION : 0'
    );
    expect(authBridge).not.toContain('startWinkGoRemoteGateway');
    expect(relaySettings).toMatch(/const DEFAULT_CONFIG[\s\S]*?relayEnabled:\s*false/);
    expect(relaySettings).toContain("data-testid='xiaozhi-relay-disclosure'");

    const localesRoot = resolve(projectRoot, 'packages/desktop/src/renderer/services/i18n/locales');
    for (const locale of readdirSync(localesRoot)) {
      const settings = JSON.parse(readFileSync(resolve(localesRoot, locale, 'settings.json'), 'utf8')) as {
        mcpWorkspace?: {
          relayToggleLabel?: string;
          relayDisclosureTitle?: string;
          relayDisclosureBody?: string;
        };
      };
      expect(settings.mcpWorkspace?.relayToggleLabel, locale).toBeTruthy();
      expect(settings.mcpWorkspace?.relayDisclosureTitle, locale).toBeTruthy();
      expect(settings.mcpWorkspace?.relayDisclosureBody, locale).toContain('{{domain}}');
    }
  });

  it('keeps the Chromium sandbox enabled and provisions Linux WebUI as an unprivileged service', () => {
    const chromium = readProjectFile('packages/desktop/src/process/utils/configureChromium.ts');
    const ubuntuInstaller = readProjectFile('scripts/install-ubuntu.sh');

    expect(chromium).not.toContain("appendSwitch('no-sandbox')");
    expect(ubuntuInstaller).not.toContain('--no-sandbox');
    expect(ubuntuInstaller).toContain('User=winkgo');
    expect(ubuntuInstaller).toContain('NoNewPrivileges=true');
    expect(ubuntuInstaller).toContain('ProtectSystem=strict');
  });
});
