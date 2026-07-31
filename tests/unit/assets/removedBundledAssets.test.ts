import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../../..');
const builtinSkillsRoot = resolve(projectRoot, 'backend/crates/winkgo-app/assets/builtin-skills');
const builtinAssistantsRoot = resolve(projectRoot, 'backend/crates/winkgo-app/assets/builtin-assistants');

describe('removed bundled assets', () => {
  it('does not restore proprietary or unlicensed assistant materials', () => {
    expect(existsSync(resolve(builtinSkillsRoot, 'pdf'))).toBe(false);
    expect(existsSync(resolve(builtinSkillsRoot, 'story-roleplay'))).toBe(false);
    expect(existsSync(resolve(builtinAssistantsRoot, 'rules/story-roleplay.en-US.md'))).toBe(false);
    expect(existsSync(resolve(builtinAssistantsRoot, 'rules/planning-with-files.en-US.md'))).toBe(false);

    const assistants = readFileSync(resolve(builtinAssistantsRoot, 'assistants.json'), 'utf8');
    expect(assistants).not.toContain('"id": "story-roleplay"');
    expect(assistants).not.toContain('"id": "planning-with-files"');
  });
});
