/**
 * @license
 * Copyright 2026 WINK GO contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '../../..');
const builtinSkillsRoot = resolve(projectRoot, 'backend/crates/winkgo-app/assets/builtin-skills');
const builtinAssistantsRoot = resolve(projectRoot, 'backend/crates/winkgo-app/assets/builtin-assistants');
const themeAssetsRoot = resolve(projectRoot, 'packages/desktop/src/renderer/assets/themes');
const themePresetsRoot = resolve(
  projectRoot,
  'packages/desktop/src/renderer/pages/settings/AppearanceSettings/presets'
);
const backendLogoRoot = resolve(projectRoot, 'backend/crates/winkgo-assets/assets/logos');
const rendererChannelLogoRoot = resolve(projectRoot, 'packages/desktop/src/renderer/assets/channel-logos');
const rendererProductLogoRoot = resolve(projectRoot, 'packages/desktop/src/renderer/assets/product-logos');

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

function listFilesRecursively(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFilesRecursively(path) : [path];
  });
}

describe('third-party distribution compliance', () => {
  it('does not ship the removed Moltbook integration', () => {
    expect(existsSync(resolve(builtinSkillsRoot, 'moltbook'))).toBe(false);
    expect(existsSync(resolve(builtinAssistantsRoot, 'avatars/moltbook.jpg'))).toBe(false);

    for (const locale of ['en-US', 'ru-RU', 'zh-CN']) {
      expect(existsSync(resolve(builtinAssistantsRoot, `rules/moltbook.${locale}.md`))).toBe(false);
    }

    const assistants = JSON.parse(readFileSync(resolve(builtinAssistantsRoot, 'assistants.json'), 'utf8')) as {
      assistants: Array<{
        id: string;
        name: string;
        name_i18n?: Record<string, string>;
        avatar?: unknown;
        enabled_skills?: string[];
      }>;
    };
    expect(assistants.assistants.some((assistant) => assistant.id === 'moltbook')).toBe(false);
    expect(assistants.assistants.some((assistant) => assistant.enabled_skills?.includes('moltbook'))).toBe(false);

    const migrationSource = readProjectFile('packages/desktop/src/process/utils/migrateAssistants.ts');
    expect(migrationSource).not.toContain("'moltbook'");
  });

  it('keeps each visible builtin assistant avatar while removed integrations stay absent', () => {
    const assistants = JSON.parse(readFileSync(resolve(builtinAssistantsRoot, 'assistants.json'), 'utf8')) as {
      assistants: Array<{
        id: string;
        name: string;
        name_i18n?: Record<string, string>;
        avatar?: unknown;
      }>;
    };

    expect(existsSync(resolve(builtinAssistantsRoot, 'avatars'))).toBe(true);
    for (const assistant of assistants.assistants) {
      expect(Object.hasOwn(assistant, 'avatar'), assistant.id).toBe(true);
      if (typeof assistant.avatar === 'string' && assistant.avatar.startsWith('avatars/')) {
        expect(existsSync(resolve(builtinAssistantsRoot, assistant.avatar)), assistant.id).toBe(true);
      }
    }

    const designStudio = assistants.assistants.find((assistant) => assistant.id === 'ui-ux-pro-max');
    expect(designStudio?.name).toBe('UI/UX Design Studio');
    expect(designStudio?.name_i18n?.['zh-CN']).toBe('UI/UX 设计工作室');
  });

  it('does not ship the removed character themes or leave runtime references', () => {
    const removedFiles = [
      resolve(themeAssetsRoot, 'hello-kitty.png'),
      resolve(themeAssetsRoot, 'misaka-mikoto-theme.png'),
      resolve(themePresetsRoot, 'hello-kitty.css'),
      resolve(themePresetsRoot, 'misaka-mikoto.css'),
    ];

    for (const file of removedFiles) {
      expect(existsSync(file), file).toBe(false);
    }

    const builtinThemes = readProjectFile('packages/desktop/src/renderer/theme/builtinThemes.ts');
    const themeCovers = readProjectFile(
      'packages/desktop/src/renderer/pages/settings/AppearanceSettings/themeCovers.ts'
    );
    for (const removedThemeId of ['hello-kitty', 'misaka-mikoto-theme']) {
      expect(builtinThemes).not.toContain(removedThemeId);
      expect(themeCovers).not.toContain(removedThemeId);
    }
  });

  it('identifies the original PDF toolkit as WINK GO project material', () => {
    const skillRoot = resolve(builtinSkillsRoot, 'pdf-toolkit');
    const source = readFileSync(resolve(skillRoot, 'SOURCE.md'), 'utf8');
    const skill = readFileSync(resolve(skillRoot, 'SKILL.md'), 'utf8');
    const license = readFileSync(resolve(skillRoot, 'LICENSE'), 'utf8');

    expect(source).toContain('independently written as original WINK GO project material');
    expect(source).toContain('Copyright 2026 WINK GO contributors.');
    expect(skill).toContain('Copyright 2026 WINK GO contributors.');
    expect(license).toContain('Apache License');
    expect(`${source}\n${skill}`).not.toContain('AionUi');
  });

  it('ships complete OfficeCLI legal files with every derived skill', () => {
    const officeCliSkillRoots = listFilesRecursively(builtinSkillsRoot)
      .filter((file) => basename(file) === 'SKILL.md')
      .filter((file) => /\bofficecli\b/i.test(readFileSync(file, 'utf8')))
      .map(dirname);

    expect(officeCliSkillRoots.length).toBeGreaterThan(0);
    expect(
      officeCliSkillRoots.map((directory) => relative(builtinSkillsRoot, directory).replaceAll('\\', '/'))
    ).toContain('auto-inject/officecli');

    for (const skillRoot of officeCliSkillRoots) {
      const skillName = relative(builtinSkillsRoot, skillRoot).replaceAll('\\', '/');
      const license = readFileSync(resolve(skillRoot, 'LICENSE'), 'utf8');
      const notice = readFileSync(resolve(skillRoot, 'NOTICE'), 'utf8');
      const source = readFileSync(resolve(skillRoot, 'SOURCE.md'), 'utf8');
      const skill = readFileSync(resolve(skillRoot, 'SKILL.md'), 'utf8');

      expect(license, skillName).toContain('Apache License');
      expect(license, skillName).toContain('Copyright 2026 OfficeCLI (https://OfficeCLI.AI)');
      expect(notice, skillName).toContain('Created and maintained by goworm.');
      expect(notice, skillName).toContain('must retain this');
      expect(source, skillName).toContain('e04dee2af5a0822db867edd67fcf29c9e02739fc');
      expect(skill, skillName).toMatch(/^---\r?\n/);
      expect(skill, skillName).toContain('This OfficeCLI-derived file was modified by WINK GO contributors in 2026');
    }

    const embedSource = readProjectFile('backend/crates/winkgo-extension/src/skill_service.rs');
    expect(embedSource).toContain('include_dir!("$CARGO_MANIFEST_DIR/../winkgo-app/assets/builtin-skills")');
  });

  it('preserves Anthropic skill-creator licensing and modification provenance', () => {
    const skillRoot = resolve(builtinSkillsRoot, 'auto-inject/skill-creator');
    const license = readFileSync(resolve(skillRoot, 'LICENSE.txt'), 'utf8');
    const source = readFileSync(resolve(skillRoot, 'SOURCE.md'), 'utf8');
    const modifications = readFileSync(resolve(skillRoot, 'MODIFICATIONS.md'), 'utf8');

    expect(license).toContain('Copyright 2026 Anthropic, PBC.');
    expect(license).not.toContain('Copyright [yyyy] [name of copyright owner]');
    expect(source).toContain('ef740771ac901e03fbca3ce4e1c453a96010f30a');
    expect(source).toContain('b29e7cf65e5cb78a5ac33d582270551bc74a14eb');
    expect(modifications).toContain('scripts/quick_validate.py');

    expect(readFileSync(resolve(skillRoot, 'SKILL.md'), 'utf8')).toContain(
      'This Anthropic skill-creator file was modified by WINK GO contributors in 2026'
    );
    expect(readFileSync(resolve(skillRoot, 'references/output-patterns.md'), 'utf8')).toContain(
      'WINK GO contributors modified this Anthropic-derived file in 2026'
    );
    expect(readFileSync(resolve(skillRoot, 'scripts/quick_validate.py'), 'utf8')).toContain(
      'Modified by WINK GO contributors in 2026'
    );
  });

  it('ships the individual Agent and channel logo catalog', () => {
    const backendLogos = listFilesRecursively(backendLogoRoot)
      .map((file) => relative(backendLogoRoot, file).replaceAll('\\', '/'))
      .toSorted();
    const rendererProductLogos = listFilesRecursively(rendererProductLogoRoot)
      .map((file) => relative(rendererProductLogoRoot, file).replaceAll('\\', '/'))
      .toSorted();

    expect(backendLogos).toContain('brand/winkgo.svg');
    expect(backendLogos).toContain('ai-major/claude.svg');
    expect(backendLogos).toContain('ai-major/gemini.svg');
    expect(backendLogos).toContain('tools/coding/codex.svg');
    expect(backendLogos).toContain('tools/openclaw.svg');
    expect(backendLogos).not.toContain('generic/service.svg');
    expect(existsSync(rendererChannelLogoRoot)).toBe(true);
    expect(listFilesRecursively(rendererChannelLogoRoot).length).toBeGreaterThan(0);
    expect(rendererProductLogos.length).toBeGreaterThan(0);
  });
});
