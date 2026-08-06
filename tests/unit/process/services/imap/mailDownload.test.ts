/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSafeChildPath, saveMailSource } from '@/process/services/imap/mailDownload';

const temporaryDirectories: string[] = [];

const makeTemporaryRoot = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'winkgo-mail-download-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('mail download', () => {
  it('writes a readable body and sanitized attachments inside the selected directory', async () => {
    const root = await makeTemporaryRoot();
    const source = Buffer.from(
      [
        'From: Sender <sender@example.com>',
        'To: user@example.com',
        'Subject: Quarterly report',
        'Date: Tue, 04 Aug 2026 10:00:00 +0800',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="winkgo-boundary"',
        '',
        '--winkgo-boundary',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'This is the message body.',
        '--winkgo-boundary',
        'Content-Type: text/plain; name="../../report.txt"',
        'Content-Disposition: attachment; filename="../../report.txt"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('attachment contents').toString('base64'),
        '--winkgo-boundary--',
        '',
      ].join('\r\n')
    );

    const result = await saveMailSource({
      source,
      rootDirectory: root,
      accountEmail: 'user@example.com',
      uid: 7,
    });

    expect(result.attachments).toHaveLength(1);
    expect(relative(root, result.directory)).not.toMatch(/^\.\./);
    expect(relative(result.directory, result.attachments[0])).not.toMatch(/^\.\./);
    expect(basename(result.attachments[0])).toBe('report.txt');
    await expect(readFile(result.bodyPath, 'utf8')).resolves.toContain('This is the message body.');
    await expect(readFile(result.attachments[0], 'utf8')).resolves.toBe('attachment contents');
  });

  it('refuses a child path that escapes the download root', () => {
    expect(() => resolveSafeChildPath('C:\\Downloads\\Mail', '..\\outside.txt')).toThrow('unsafe_mail_path');
  });

  it('keeps link targets in the saved body and saves inline images as local files', async () => {
    const root = await makeTemporaryRoot();
    const source = Buffer.from(
      [
        'From: Sender <sender@example.com>',
        'To: user@example.com',
        'Subject: Image and link',
        'MIME-Version: 1.0',
        'Content-Type: multipart/related; boundary="related-boundary"',
        '',
        '--related-boundary',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>Open <a href="https://example.com/download">the download link</a>.</p><img src="cid:logo">',
        '--related-boundary',
        'Content-Type: image/png; name="logo.png"',
        'Content-Disposition: inline; filename="logo.png"',
        'Content-ID: <logo>',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('fake-png').toString('base64'),
        '--related-boundary--',
        '',
      ].join('\r\n')
    );

    const result = await saveMailSource({
      source,
      rootDirectory: root,
      accountEmail: 'user@example.com',
      uid: 8,
    });

    await expect(readFile(result.bodyPath, 'utf8')).resolves.toContain('https://example.com/download');
    expect(result.attachments.map((path) => basename(path))).toContain('logo.png');
  });
});
