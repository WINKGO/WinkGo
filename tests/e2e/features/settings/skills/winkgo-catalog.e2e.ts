/**
 * WINK GO catalog E2E coverage.
 *
 * Verifies every bundled WINK GO skill is visible and can be imported through
 * the same UI path used by customers. The Electron fixture uses an isolated
 * profile, so no real user skill directory is modified.
 */

import { expect, test } from '../../../fixtures';
import { deleteSkillViaBridge, getMySkills, goToSkillsHub, normalizeTestId } from '../../../helpers/skillsHub';
import fs from 'node:fs';
import path from 'node:path';

const skillsRoot = path.join(process.cwd(), 'resources', 'winkgo', 'skills');
const bundledSkillIds = fs
  .readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
  .sort();

test.describe('WINK GO Skills catalog', () => {
  test('shows and imports every bundled WINK GO skill', async ({ page }) => {
    const importedSkillIds: string[] = [];

    try {
      await goToSkillsHub(page);
      await page.getByTestId('settings-tab-winkGo').click();

      const section = page.getByTestId('wink-go-skills-section');
      await expect(section).toBeVisible();
      await expect(section.locator('[data-testid^="wink-go-skill-card-"]')).toHaveCount(bundledSkillIds.length);

      for (const skillId of bundledSkillIds) {
        const normalizedId = normalizeTestId(skillId);
        const card = page.getByTestId(`wink-go-skill-card-${normalizedId}`);
        const importButton = page.getByTestId(`btn-import-wink-go-skill-${normalizedId}`);

        await expect(card, `${skillId} card should be visible`).toBeVisible();
        await expect(importButton, `${skillId} import should be available`).toBeEnabled();
        await importButton.click();
        await expect(importButton, `${skillId} should finish importing`).toBeDisabled({ timeout: 15_000 });
        importedSkillIds.push(skillId);
      }

      const customSkills = await getMySkills(page);
      const customSkillNames = new Set(
        customSkills.filter((skill) => skill.source === 'custom').map((skill) => skill.name)
      );
      expect(bundledSkillIds.filter((skillId) => !customSkillNames.has(skillId))).toEqual([]);
    } finally {
      for (const skillId of importedSkillIds) await deleteSkillViaBridge(page, skillId);
    }
  });
});
