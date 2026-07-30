/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export type InspirationCategory = 'office' | 'data' | 'research';

export type InspirationTemplate = {
  id:
    | 'desktopOrganizer'
    | 'meetingMinutes'
    | 'presentationPlan'
    | 'spreadsheetAnalysis'
    | 'weeklyReport'
    | 'researchBrief';
  category: InspirationCategory;
  icon: 'folder' | 'file' | 'magic';
};

export const INSPIRATION_TEMPLATES: InspirationTemplate[] = [
  { id: 'desktopOrganizer', category: 'office', icon: 'folder' },
  { id: 'meetingMinutes', category: 'office', icon: 'file' },
  { id: 'presentationPlan', category: 'office', icon: 'magic' },
  { id: 'spreadsheetAnalysis', category: 'data', icon: 'file' },
  { id: 'weeklyReport', category: 'office', icon: 'file' },
  { id: 'researchBrief', category: 'research', icon: 'magic' },
];
