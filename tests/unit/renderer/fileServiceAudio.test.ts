import { describe, expect, it } from 'vitest';

import { allSupportedExts, audioExts } from '@/renderer/services/FileService';

describe('FileService audio attachments', () => {
  it('offers the supported audio formats in the attachment picker', () => {
    expect(audioExts).toEqual(['.mp3', '.wav', '.m4a', '.ogg', '.flac']);
    expect(allSupportedExts).toEqual(expect.arrayContaining(audioExts));
  });
});
