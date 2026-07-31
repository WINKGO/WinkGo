import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();

const filesUnder = (entry: string): string[] => {
  const absolute = path.join(repositoryRoot, entry);
  if (fs.statSync(absolute).isFile()) return [absolute];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((item) => filesUnder(path.join(entry, item.name)));
};

const read = (entry: string): string => fs.readFileSync(path.join(repositoryRoot, entry), 'utf8');

const bundledAssistantAndSkillEntries = [
  'backend/crates/winkgo-app/assets/builtin-assistants/assistants.json',
  'backend/crates/winkgo-app/assets/builtin-assistants/rules',
  'backend/crates/winkgo-app/assets/builtin-skills/auto-inject/winkgo-config/SKILL.md',
  'backend/crates/winkgo-app/assets/builtin-skills/morph-ppt/SKILL.md',
  'backend/crates/winkgo-app/assets/builtin-skills/openclaw-setup/SKILL.md',
  'backend/crates/winkgo-app/assets/builtin-skills/winkgo-troubleshooting/SKILL.md',
  'backend/crates/winkgo-app/assets/builtin-skills/winkgo-webui-public/SKILL.md',
  'backend/crates/winkgo-app/assets/builtin-skills/winkgo-webui-setup',
];

const allowedLegacyPaths = [
  '/Users/alex/Library/Logs/WinkGo',
  '/Applications/WinkGo.app/Contents/MacOS/WinkGo',
  '%APPDATA%/WinkGo/webui.config.json',
  '~/Library/Application Support/WinkGo/webui.config.json',
  '~/.config/WinkGo/webui.config.json',
];

const withoutAllowedLegacyPaths = (content: string): string =>
  allowedLegacyPaths
    .reduce((result, legacyPath) => result.replaceAll(legacyPath, '<legacy-path>'), content)
    // These short source-provenance comments are required by the upstream
    // attribution policy and are not user-facing product branding.
    .replace(/(?:<!--\s*|#\s*)Modified from Aion(?:UI|Core) by WINK GO contributors in 2026\.?\s*(?:-->)?/gi, '<source-provenance>');

describe('user-facing WINK GO branding', () => {
  it('keeps bundled assistant and selected skill prose free of the retired upstream product name', () => {
    const files = bundledAssistantAndSkillEntries.flatMap(filesUnder).filter((file) => /\.(?:json|md)$/i.test(file));

    for (const file of files) {
      const visibleContent = withoutAllowedLegacyPaths(fs.readFileSync(file, 'utf8'));
      expect(visibleContent, path.relative(repositoryRoot, file)).not.toMatch(/\bAionUI\b|\baionui\b|AionCore/);
    }
  });

  it('verifies public WebUI links against the WINK GO document title', () => {
    const skill = read('backend/crates/winkgo-app/assets/builtin-skills/winkgo-webui-public/SKILL.md');

    expect(skill).toContain('<title>WINK GO</title>');
    expect(skill).not.toContain('<title>WinkGo</title>');
    expect(skill).toContain('winkgo_core');
  });

  it('keeps startup copy and every locale on the public core display name', () => {
    const localesRoot = path.join(repositoryRoot, 'packages/desktop/src/renderer/services/i18n/locales');
    const locales = fs.readdirSync(localesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());

    for (const locale of locales) {
      const common = JSON.parse(fs.readFileSync(path.join(localesRoot, locale.name, 'common.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      const settings = fs.readFileSync(path.join(localesRoot, locale.name, 'settings.json'), 'utf8');

      expect(common.localAccount, `${locale.name} localAccount`).toEqual(expect.any(String));
      expect(JSON.stringify(common), `${locale.name}/common.json`).not.toContain('WinkGoCore');
      expect(settings, `${locale.name}/settings.json`).not.toContain('WinkGoCore');
    }

    expect(read('packages/desktop/src/process/startup/architectureCompatibility.ts')).toContain(
      'WINK GO package architecture does not match this Mac'
    );
  });

  it('keeps public GitHub contribution templates on the current product name', () => {
    const templates = [
      '.github/ISSUE_TEMPLATE/bug_report.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
      '.github/ISSUE_TEMPLATE/feature_request.yml',
      '.github/ISSUE_TEMPLATE/question.yml',
      '.github/pull_request_template.md',
    ];

    for (const file of templates) {
      const content = read(file);
      expect(content, file).toContain('WINK GO');
      expect(withoutAllowedLegacyPaths(content), file).not.toMatch(/\bAionUI\b|\baionui\b|AionCore/);
    }
  });

  it('uses WINK GO folder names for new users while retaining legacy-folder fallback', () => {
    const filesBridge = read('packages/desktop/src/process/bridge/winkgo/filesBridge.ts');
    const formatBridge = read('packages/desktop/src/process/bridge/winkgo/formatBridge.ts');

    expect(filesBridge).toContain("'WINK GO 收纳箱'");
    expect(filesBridge).toContain("'WINK GO Inbox'");
    expect(filesBridge).toContain("'WINK GO 收纳箱'");
    expect(filesBridge).toContain("'WINK GO Inbox'");
    expect(filesBridge).toContain('existsSync(legacy) && !existsSync(current)');

    expect(formatBridge).toContain("'WINK GO 格式转换'");
    expect(formatBridge).toContain("'WINK GO 格式转换'");
    expect(formatBridge).toContain('existsSync(legacy) && !existsSync(current)');
  });
});
