/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { convert } from 'html-to-text';
import { simpleParser } from 'mailparser';
import { sanitizeMailPathSegment } from './imapConfig';

export type SavedMailSource = {
  directory: string;
  bodyPath: string;
  attachments: string[];
};

export type MailSourcePreview = {
  body: string;
  attachmentNames: string[];
};

const isExistingPathError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';

export const resolveSafeChildPath = (rootDirectory: string, childName: string): string => {
  const root = resolve(rootDirectory);
  const child = resolve(root, childName);
  const relativePath = relative(root, child);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('unsafe_mail_path');
  }
  return child;
};

const createUniqueDirectory = async (parent: string, desiredName: string): Promise<string> => {
  await mkdir(parent, { recursive: true });
  const attempt = async (index: number): Promise<string> => {
    if (index >= 1_000) throw new Error('mail_directory_exhausted');
    const suffix = index === 0 ? '' : ` (${index + 1})`;
    const candidate = resolveSafeChildPath(parent, `${desiredName}${suffix}`);
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if (!isExistingPathError(error)) throw error;
      return attempt(index + 1);
    }
  };
  return attempt(0);
};

const reserveAttachmentPath = async (directory: string, rawFilename: string, index: number): Promise<string> => {
  const safeFilename = sanitizeMailPathSegment(basename(rawFilename), `附件-${index + 1}`);
  const extensionIndex = safeFilename.lastIndexOf('.');
  const base = extensionIndex > 0 ? safeFilename.slice(0, extensionIndex) : safeFilename;
  const extension = extensionIndex > 0 ? safeFilename.slice(extensionIndex) : '';

  const attempt = async (duplicate: number): Promise<string> => {
    if (duplicate >= 1_000) throw new Error('mail_attachment_name_exhausted');
    const suffix = duplicate === 0 ? '' : ` (${duplicate + 1})`;
    const candidate = resolveSafeChildPath(directory, `${base}${suffix}${extension}`);
    try {
      await writeFile(candidate, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
      return candidate;
    } catch (error) {
      if (!isExistingPathError(error)) throw error;
      return attempt(duplicate + 1);
    }
  };
  return attempt(0);
};

const formatDate = (date: Date): string => {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const previewMailSource = async (source: Buffer): Promise<MailSourcePreview> => {
  const mail = await simpleParser(source, {
    skipImageLinks: true,
    maxHtmlLengthToParse: 5 * 1024 * 1024,
  });
  const body =
    mail.text?.trim() ||
    (typeof mail.html === 'string'
      ? convert(mail.html, {
          wordwrap: false,
          selectors: [{ selector: 'img', format: 'skip' }],
        }).trim()
      : '') ||
    '（此邮件没有可读取的正文）';
  return {
    body,
    attachmentNames: mail.attachments.map((attachment, index) => attachment.filename || `附件-${index + 1}`),
  };
};

export const saveMailSource = async ({
  source,
  rootDirectory,
  accountEmail,
  uid,
}: {
  source: Buffer;
  rootDirectory: string;
  accountEmail: string;
  uid: number;
}): Promise<SavedMailSource> => {
  const mail = await simpleParser(source, {
    skipImageLinks: true,
    maxHtmlLengthToParse: 5 * 1024 * 1024,
  });
  const receivedAt = mail.date instanceof Date && !Number.isNaN(mail.date.getTime()) ? mail.date : new Date();
  const accountDirectory = resolveSafeChildPath(rootDirectory, sanitizeMailPathSegment(accountEmail, '邮箱'));
  const subject = sanitizeMailPathSegment(mail.subject || '无主题');
  const directory = await createUniqueDirectory(
    accountDirectory,
    `${formatDate(receivedAt)} ${subject} UID-${Math.max(0, Math.trunc(uid))}`
  );

  const plainBody =
    mail.text?.trim() ||
    (typeof mail.html === 'string'
      ? convert(mail.html, {
          wordwrap: false,
          selectors: [{ selector: 'img', format: 'skip' }],
        }).trim()
      : '') ||
    '（此邮件没有可读取的正文）';
  const from = mail.from?.text || '未知发件人';
  const body = [
    `发件人：${from}`,
    `收件账号：${accountEmail}`,
    `主题：${mail.subject || '无主题'}`,
    `日期：${receivedAt.toLocaleString()}`,
    '',
    plainBody,
    '',
  ].join('\n');
  const bodyPath = resolveSafeChildPath(directory, '正文.txt');
  await writeFile(bodyPath, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });

  const attachments = await Promise.all(
    mail.attachments.map(async (attachment, index) => {
      const attachmentPath = await reserveAttachmentPath(directory, attachment.filename || '', index);
      await writeFile(attachmentPath, attachment.content, { flag: 'w', mode: 0o600 });
      return attachmentPath;
    })
  );

  return { directory, bodyPath, attachments };
};
