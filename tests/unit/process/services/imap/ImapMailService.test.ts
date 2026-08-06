/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImapFlow } from 'imapflow';
import { describe, expect, it, vi } from 'vitest';
import type { WinkGoMailMessage } from '@/common/adapter/ipcBridge';
import { classifyImapError, ImapMailService } from '@/process/services/imap/ImapMailService';
import type { ImapAccountStore, LoadedImapAccount } from '@/process/services/imap/ImapAccountStore';

const account: LoadedImapAccount = {
  config: {
    enabled: true,
    label: 'Work',
    email: 'user@example.com',
    username: 'user@example.com',
    host: 'imap.example.com',
    port: 993,
    security: 'tls',
    pollIntervalMinutes: 60,
    downloadDirectory: '',
  },
  password: 'secret',
  checkpoint: { uidValidity: null, lastUid: null },
};

const createClient = (uidNext: number, messages: number[]): ImapFlow => {
  const client = {
    usable: true,
    on: vi.fn().mockReturnThis(),
    connect: vi.fn(() => Promise.resolve()),
    mailboxOpen: vi.fn(() =>
      Promise.resolve({
        uidValidity: 100n,
        uidNext,
        exists: uidNext - 1,
        flags: new Set(),
        path: 'INBOX',
        delimiter: '/',
      })
    ),
    search: vi.fn(() => Promise.resolve([1, 2])),
    noop: vi.fn(() => Promise.resolve()),
    status: vi.fn(() => Promise.resolve({ path: 'INBOX', messages: uidNext - 1, uidNext })),
    fetch: async function* () {
      for (const uid of messages) {
        yield {
          uid,
          seq: uid,
          envelope: {
            subject: `Subject ${uid}`,
            from: [{ name: 'Sender', address: 'sender@example.com' }],
          },
          bodyStructure: {
            type: 'multipart/mixed',
            childNodes: [
              { type: 'text/plain' },
              { type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'a.pdf' } },
            ],
          },
        };
      }
    },
    logout: vi.fn(() => Promise.resolve()),
    close: vi.fn(),
  };
  return client as unknown as ImapFlow;
};

describe('ImapMailService', () => {
  it('baselines the first check and emits only later UIDs', async () => {
    let checkpoint = { ...account.checkpoint };
    const store = {
      load: vi.fn(async () => ({ ...account, checkpoint: { ...checkpoint } })),
      updateCheckpoint: vi.fn(async (uidValidity: string | null, lastUid: number | null) => {
        checkpoint = { uidValidity, lastUid };
      }),
    } as unknown as ImapAccountStore;
    const messages: WinkGoMailMessage[] = [];
    const clients = [createClient(5, []), createClient(7, [5, 6])];
    const service = new ImapMailService({
      store,
      defaultDownloadDirectory: 'C:\\Downloads\\WINK GO 邮件',
      clientFactory: () => clients.shift()!,
      idleWatchEnabled: false,
      onMessage: (message) => messages.push(message),
    });

    await service.initialize();
    await service.checkNow();
    expect(messages).toEqual([]);
    expect(checkpoint).toEqual({ uidValidity: '100', lastUid: 4 });

    await service.checkNow();
    expect(messages.map((message) => message.uid)).toEqual([5, 6]);
    expect(messages[0]).toEqual(expect.objectContaining({ hasAttachments: true, attachmentCount: 1 }));
    await expect(service.listMessages(1)).resolves.toEqual([
      expect.objectContaining({ uid: 6, subject: 'Subject 6', isUnread: true }),
    ]);
    service.dispose();
  });

  it('checks for new mail immediately when the persistent IDLE connection reports EXISTS', async () => {
    let checkpoint = { ...account.checkpoint };
    const store = {
      load: vi.fn(async () => ({ ...account, checkpoint: { ...checkpoint } })),
      updateCheckpoint: vi.fn(async (uidValidity: string | null, lastUid: number | null) => {
        checkpoint = { uidValidity, lastUid };
      }),
    } as unknown as ImapAccountStore;
    const messages: WinkGoMailMessage[] = [];
    const idleClient = createClient(5, []);
    const baselineClient = createClient(5, []);
    const newMailClient = createClient(7, [5, 6]);
    const clients = [idleClient, baselineClient, newMailClient];
    const clientFactory = vi.fn((_input, _options?: { idle: boolean }) => clients.shift()!);
    const service = new ImapMailService({
      store,
      defaultDownloadDirectory: 'C:\\Downloads\\WINK GO 邮件',
      clientFactory,
      onMessage: (message) => messages.push(message),
    });

    await service.initialize();
    await vi.waitFor(() => expect(checkpoint).toEqual({ uidValidity: '100', lastUid: 4 }));
    expect(clientFactory.mock.calls[0]?.[1]).toEqual({ idle: true });

    const registrations = vi.mocked(idleClient.on).mock.calls as unknown as Array<
      [string, (event: { count: number; prevCount: number }) => void]
    >;
    const existsHandler = registrations.find(([eventName]) => eventName === 'exists')?.[1];
    expect(existsHandler).toBeDefined();
    existsHandler?.({ count: 6, prevCount: 4 });

    await vi.waitFor(() => expect(messages.map((message) => message.uid)).toEqual([5, 6]));
    service.dispose();
  });

  it('actively checks mailbox state so providers cannot delay alerts until the fallback poll', async () => {
    const store = {
      load: vi.fn(async () => account),
      updateCheckpoint: vi.fn(() => Promise.resolve()),
    } as unknown as ImapAccountStore;
    const idleClient = createClient(5, []);
    const service = new ImapMailService({
      store,
      defaultDownloadDirectory: 'C:\\Downloads\\WINK GO 邮件',
      clientFactory: () => idleClient,
      idleProbeIntervalMs: 20,
    });

    await service.initialize();
    await vi.waitFor(() => expect(idleClient.status).toHaveBeenCalledWith('INBOX', { messages: true, uidNext: true }), {
      timeout: 500,
    });
    service.dispose();
  });

  it('synchronizes new mail when the active mailbox status probe detects a UID change', async () => {
    let checkpoint = { ...account.checkpoint };
    let uidNext = 5;
    const store = {
      load: vi.fn(async () => ({ ...account, checkpoint: { ...checkpoint } })),
      updateCheckpoint: vi.fn(async (uidValidity: string | null, lastUid: number | null) => {
        checkpoint = { uidValidity, lastUid };
      }),
    } as unknown as ImapAccountStore;
    const messages: WinkGoMailMessage[] = [];
    const idleClient = createClient(5, []);
    vi.mocked(idleClient.status).mockImplementation(() =>
      Promise.resolve({ path: 'INBOX', messages: uidNext - 1, uidNext })
    );
    const clients = [idleClient, createClient(5, []), createClient(7, [5, 6])];
    const service = new ImapMailService({
      store,
      defaultDownloadDirectory: 'C:\\Downloads\\WINK GO 邮件',
      clientFactory: () => clients.shift()!,
      idleProbeIntervalMs: 20,
      onMessage: (message) => messages.push(message),
    });

    await service.initialize();
    await vi.waitFor(() => expect(checkpoint).toEqual({ uidValidity: '100', lastUid: 4 }));
    uidNext = 7;

    await vi.waitFor(() => expect(messages.map((message) => message.uid)).toEqual([5, 6]), { timeout: 1_000 });
    service.dispose();
  });

  it('maps authentication and TLS failures to safe error codes', () => {
    expect(classifyImapError({ authenticationFailed: true, message: 'secret details' })).toBe('authentication_failed');
    expect(classifyImapError({ code: 'CERT_HAS_EXPIRED' })).toBe('tls_failed');
  });
});
