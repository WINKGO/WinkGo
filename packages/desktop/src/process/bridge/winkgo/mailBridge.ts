/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { ipcBridge } from '@/common';
import { ImapAccountStore, ImapMailService } from '@process/services/imap';
import { getDesktopIslandWindow } from '@process/winkgo/desktopIslandWindow';

let mailService: ImapMailService | null = null;

const getMailService = (): ImapMailService => {
  mailService ??= new ImapMailService({
    store: new ImapAccountStore(join(app.getPath('userData'), 'mail', 'imap-account.json'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plaintext) => safeStorage.encryptString(plaintext),
      decrypt: (ciphertext) => safeStorage.decryptString(ciphertext),
    }),
    defaultDownloadDirectory: join(app.getPath('downloads'), 'WINK GO 邮件'),
    onStatus: (status) => ipcBridge.winkGoMail.statusChanged.emit(status),
    onMessage: (message) => {
      ipcBridge.winkGoMail.messageReceived.emit({
        id: `winkgo-mail:${message.id}`,
        appName: '邮箱',
        title: message.senderName || message.senderAddress,
        body: message.subject,
        appUserModelId: `winkgo.mail.${message.accountEmail}`,
        createdAt: message.receivedAt,
        mail: {
          uid: message.uid,
          accountEmail: message.accountEmail,
          hasAttachments: message.hasAttachments,
          attachmentCount: message.attachmentCount,
        },
      });
      getDesktopIslandWindow()?.showInactive();
    },
  });
  return mailService;
};

/** Registers local-only IMAP settings, polling, notification and download IPC. */
export function initWinkGoMailBridge(): void {
  const service = getMailService();
  ipcBridge.winkGoMail.getStatus.provider(() => service.getStatus());
  ipcBridge.winkGoMail.listMessages.provider(({ limit }) => service.listMessages(limit));
  ipcBridge.winkGoMail.previewMessage.provider(({ uid }) => service.previewMessage(uid));
  ipcBridge.winkGoMail.saveAccount.provider((input) => service.saveAccount(input));
  ipcBridge.winkGoMail.clearAccount.provider(() => service.clearAccount());
  ipcBridge.winkGoMail.testConnection.provider((input) => service.testConnection(input));
  ipcBridge.winkGoMail.checkNow.provider(() => service.checkNow());
  ipcBridge.winkGoMail.downloadMessage.provider(({ uid }) => service.downloadMessage(uid));
  void service.initialize();
  app.once('will-quit', () => {
    mailService?.dispose();
    mailService = null;
  });
}
