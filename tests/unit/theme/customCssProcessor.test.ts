// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'postcss';
import { describe, expect, it } from 'vitest';
import { addImportantToAll, processCustomCss } from '@/renderer/utils/theme/customCssProcessor';

const presetDir = path.resolve(
  process.cwd(),
  'packages/desktop/src/renderer/pages/settings/AppearanceSettings/presets'
);

const presetFiles = fs.readdirSync(presetDir).filter((file) => file.endsWith('.css'));

const selectorsOf = (css: string): string[] => {
  const selectors: string[] = [];
  parse(css).walkRules((rule) => selectors.push(rule.selector));
  return selectors;
};

const declarationImportanceOf = (css: string): string[] => {
  const declarations: string[] = [];
  parse(css).walkDecls((declaration) => declarations.push(`${declaration.prop}:${declaration.important === true}`));
  return declarations;
};

describe('addImportantToAll', () => {
  it('returns an empty string for empty or whitespace-only input', () => {
    expect(addImportantToAll('')).toBe('');
    expect(addImportantToAll('   \n\t ')).toBe('');
  });

  it('preserves complex selectors while marking declarations important', () => {
    const css = [
      '.button:hover { color: red; }',
      '.item::before { content: "a; b: c"; }',
      ':not(.disabled) { padding: 1px }',
      '::-webkit-scrollbar-thumb:hover { background: blue; }',
    ].join('\n');

    const output = addImportantToAll(css);

    expect(selectorsOf(output)).toEqual(selectorsOf(css));
    expect(declarationImportanceOf(output)).toEqual(['color:true', 'content:true', 'padding:true', 'background:true']);
  });

  it('marks a final declaration without a trailing semicolon', () => {
    const output = addImportantToAll('.panel { color: red; margin: 0 }');
    expect(declarationImportanceOf(output)).toEqual(['color:true', 'margin:true']);
  });

  it('does not duplicate an existing important marker', () => {
    const output = addImportantToAll('.panel { color: red !important; }');
    expect(output).toContain('color: red !important');
    expect(output).not.toContain('!important !important');
  });

  it('returns invalid CSS unchanged instead of interrupting theme application', () => {
    const invalidCss = '.panel { color: red; ';
    expect(addImportantToAll(invalidCss)).toBe(invalidCss);
  });
});

describe('addImportantToAll preset regression coverage', () => {
  it('keeps every preset selector intact and marks every declaration important', () => {
    expect(presetFiles.length).toBeGreaterThan(0);

    for (const file of presetFiles) {
      const css = fs.readFileSync(path.join(presetDir, file), 'utf8');
      const output = addImportantToAll(css);

      expect(() => parse(output)).not.toThrow();
      expect(selectorsOf(output)).toEqual(selectorsOf(css));
      expect(declarationImportanceOf(output).every((declaration) => declaration.endsWith(':true'))).toBe(true);
    }
  });
});

describe('processCustomCss', () => {
  it('wraps processed CSS while preserving the selector', () => {
    const output = processCustomCss('.button:hover { color: red; }');
    expect(output).toContain('User Custom Styles');
    expect(output).toContain('.button:hover');
    expect(output).toContain('color: red !important');
  });

  it('returns an empty string for empty input', () => {
    expect(processCustomCss('')).toBe('');
  });
});
