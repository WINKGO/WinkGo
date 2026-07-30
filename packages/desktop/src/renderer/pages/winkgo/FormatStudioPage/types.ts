/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export type FormatStudioMode = 'cleanText' | 'formatJson' | 'markdownOutline';

export type FormatStudioResult = { ok: true; output: string } | { ok: false; error: 'invalidJson' };
