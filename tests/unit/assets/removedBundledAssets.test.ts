import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../../..');
const builtinSkillsRoot = resolve(projectRoot, 'backend/crates/winkgo-app/assets/builtin-skills');
const builtinAssistantsRoot = resolve(projectRoot, 'backend/crates/winkgo-app/assets/builtin-assistants');

describe('original bundled assets', () => {
  it('restores the 2.1.45 official assistants and skills', () => {
    expect(existsSync(resolve(builtinSkillsRoot, 'pdf'))).toBe(true);
    expect(existsSync(resolve(builtinSkillsRoot, 'story-roleplay'))).toBe(true);
    expect(existsSync(resolve(builtinSkillsRoot, 'moltbook'))).toBe(true);
    expect(existsSync(resolve(builtinSkillsRoot, 'moltbook/LICENSE'))).toBe(true);
    expect(existsSync(resolve(builtinSkillsRoot, 'pdf/LICENSE.txt'))).toBe(false);
    expect(existsSync(resolve(builtinSkillsRoot, 'pdf/forms.md'))).toBe(false);
    expect(existsSync(resolve(builtinSkillsRoot, 'pdf/scripts'))).toBe(false);
    expect(existsSync(resolve(builtinAssistantsRoot, 'rules/story-roleplay.en-US.md'))).toBe(true);
    expect(existsSync(resolve(builtinAssistantsRoot, 'rules/planning-with-files.en-US.md'))).toBe(true);

    const assistants = JSON.parse(readFileSync(resolve(builtinAssistantsRoot, 'assistants.json'), 'utf8')).assistants;
    expect(assistants).toHaveLength(21);
    expect(assistants.map((assistant: { id: string }) => assistant.id)).toEqual(
      expect.arrayContaining(['story-roleplay', 'planning-with-files', 'moltbook'])
    );
  });
});
