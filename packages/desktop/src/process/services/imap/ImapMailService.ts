/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from 'imapflow';
import type {
  WinkGoMailAccountConfig,
  WinkGoMailAccountInput,
  WinkGoMailDownloadResult,
  WinkGoMailErrorCode,
  WinkGoMailMessage,
  WinkGoMailPreviewResult,
  WinkGoMailSaveResult,
  WinkGoMailStatus,
  WinkGoMailTestResult,
} from '@/common/adapter/ipcBridge';
import { SecureStorageUnavailableError, type ImapAccountStore, type LoadedImapAccount } from './ImapAccountStore';
import { ImapConfigurationError, planUidSync, validateImapAccountInput } from './imapConfig';
import { previewMailSource, saveMailSource } from './mailDownload';

const CONNECTION_TIMEOUT_MS = 15_000;
const IDLE_MAX_DURATION_MS = 25 * 60_000;
const IDLE_SOCKET_TIMEOUT_MS = 35 * 60_000;
const IDLE_PROBE_INTERVAL_MS = 5_000;
const IDLE_CHECK_DEBOUNCE_MS = 180;
const IDLE_RECONNECT_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;
const MAX_MESSAGE_BYTES = 50 * 1024 * 1024;
const MAX_NOTIFICATIONS_PER_CHECK = 20;
const MAX_RECENT_MESSAGES = 30;

type ImapMailServiceOptions = {
  store: ImapAccountStore;
  defaultDownloadDirectory: string;
  onStatus?: (status: WinkGoMailStatus) => void;
  onMessage?: (message: WinkGoMailMessage) => void;
  clientFactory?: (input: WinkGoMailAccountInput & { password: string }, options?: { idle: boolean }) => ImapFlow;
  idleWatchEnabled?: boolean;
  idleProbeIntervalMs?: number;
};

type ErrorLike = {
  authenticationFailed?: boolean;
  code?: string;
  message?: string;
  responseStatus?: string;
};

export const classifyImapError = (error: unknown): WinkGoMailErrorCode => {
  if (error instanceof ImapConfigurationError) return 'invalid_config';
  if (error instanceof SecureStorageUnavailableError) return 'secure_storage_unavailable';
  if (error instanceof Error && error.message === 'missing_password') return 'missing_password';
  const candidate = (typeof error === 'object' && error !== null ? error : {}) as ErrorLike;
  const code = candidate.code?.toLocaleUpperCase() || '';
  const message = candidate.message?.toLocaleLowerCase() || '';
  if (candidate.authenticationFailed || code.includes('AUTH') || message.includes('authentication failed')) {
    return 'authentication_failed';
  }
  if (code.includes('TIMEOUT') || code === 'ETIMEDOUT' || message.includes('timed out')) return 'timeout';
  if (
    code.includes('CERT') ||
    code.includes('TLS') ||
    message.includes('certificate') ||
    message.includes('starttls')
  ) {
    return 'tls_failed';
  }
  if (candidate.responseStatus === 'NO' || message.includes('mailbox') || message.includes('inbox')) {
    return 'mailbox_unavailable';
  }
  return 'connection_failed';
};

const countAttachments = (node?: MessageStructureObject): number => {
  if (!node) return 0;
  const ownFilename = node.dispositionParameters?.filename || node.parameters?.name;
  const ownCount = node.disposition?.toLocaleLowerCase() === 'attachment' || ownFilename ? 1 : 0;
  return ownCount + (node.childNodes?.reduce((sum, child) => sum + countAttachments(child), 0) ?? 0);
};

const closeClient = async (client: ImapFlow): Promise<void> => {
  try {
    if (client.usable) await client.logout();
    else client.close();
  } catch {
    client.close();
  }
};

const toPublicConfig = (loaded: LoadedImapAccount): WinkGoMailAccountConfig => ({
  ...loaded.config,
  passwordConfigured: Boolean(loaded.password),
});

const toMessage = (message: FetchMessageObject, accountEmail: string): WinkGoMailMessage => {
  const sender = message.envelope?.from?.[0] || message.envelope?.sender?.[0];
  const attachmentCount = countAttachments(message.bodyStructure);
  const dateValue = message.envelope?.date || message.internalDate;
  const receivedAt = dateValue ? new Date(dateValue).getTime() : Date.now();
  return {
    id: `${accountEmail}:${message.uid}`,
    uid: message.uid,
    accountEmail,
    senderName: sender?.name?.trim() || '',
    senderAddress: sender?.address?.trim() || '',
    subject: message.envelope?.subject?.trim() || '',
    receivedAt: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
    hasAttachments: attachmentCount > 0,
    attachmentCount,
    isUnread: !message.flags?.has('\\Seen'),
  };
};

export class ImapMailService {
  private readonly store: ImapAccountStore;
  private readonly defaultDownloadDirectory: string;
  private readonly onStatus?: (status: WinkGoMailStatus) => void;
  private readonly onMessage?: (message: WinkGoMailMessage) => void;
  private readonly clientFactory: NonNullable<ImapMailServiceOptions['clientFactory']>;
  private readonly idleWatchEnabled: boolean;
  private readonly idleProbeIntervalMs: number;
  private status: WinkGoMailStatus = { account: null, state: 'disabled', unreadCount: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idleReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private idleCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private idleClient: ImapFlow | null = null;
  private idleKnownUidNext: number | null = null;
  private idleKnownMessageCount: number | null = null;
  private idleGeneration = 0;
  private idleRetryAttempt = 0;
  private idleCheckAgainRequested = false;
  private checkPromise: Promise<WinkGoMailStatus> | null = null;
  private recentMessages: WinkGoMailMessage[] = [];
  private disposed = false;

  constructor(options: ImapMailServiceOptions) {
    this.store = options.store;
    this.defaultDownloadDirectory = options.defaultDownloadDirectory;
    this.onStatus = options.onStatus;
    this.onMessage = options.onMessage;
    this.idleWatchEnabled = options.idleWatchEnabled ?? true;
    this.idleProbeIntervalMs = Math.max(10, Math.trunc(options.idleProbeIntervalMs ?? IDLE_PROBE_INTERVAL_MS));
    this.clientFactory =
      options.clientFactory ??
      ((input, clientOptions) =>
        new ImapFlow({
          host: input.host,
          port: input.port,
          secure: input.security === 'tls',
          doSTARTTLS: input.security === 'starttls',
          auth: { user: input.username, pass: input.password },
          clientInfo: { name: 'WINK GO', version: '1' },
          logger: false,
          disableAutoIdle: !clientOptions?.idle,
          connectionTimeout: CONNECTION_TIMEOUT_MS,
          greetingTimeout: CONNECTION_TIMEOUT_MS,
          maxIdleTime: clientOptions?.idle ? IDLE_MAX_DURATION_MS : undefined,
          socketTimeout: clientOptions?.idle ? IDLE_SOCKET_TIMEOUT_MS : 30_000,
          maxLiteralSize: MAX_MESSAGE_BYTES + 1024 * 1024,
          tls: { rejectUnauthorized: true, servername: input.host },
        }));
  }

  private publishStatus(patch: Partial<WinkGoMailStatus>): WinkGoMailStatus {
    this.status = { ...this.status, ...patch };
    this.onStatus?.(this.status);
    return this.status;
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private cancelIdleReconnect(): void {
    if (this.idleReconnectTimer) clearTimeout(this.idleReconnectTimer);
    this.idleReconnectTimer = null;
  }

  private cancelIdleProbe(): void {
    if (this.idleProbeTimer) clearTimeout(this.idleProbeTimer);
    this.idleProbeTimer = null;
  }

  private cancelIdleCheck(): void {
    if (this.idleCheckTimer) clearTimeout(this.idleCheckTimer);
    this.idleCheckTimer = null;
    this.idleCheckAgainRequested = false;
  }

  private stopIdleWatcher(): void {
    this.idleGeneration += 1;
    this.idleRetryAttempt = 0;
    this.cancelIdleReconnect();
    this.cancelIdleProbe();
    this.cancelIdleCheck();
    const client = this.idleClient;
    this.idleClient = null;
    this.idleKnownUidNext = null;
    this.idleKnownMessageCount = null;
    if (client) void closeClient(client);
  }

  private scheduleIdleProbe(generation: number, client: ImapFlow): void {
    this.cancelIdleProbe();
    if (this.disposed || generation !== this.idleGeneration || this.idleClient !== client) return;
    this.idleProbeTimer = setTimeout(() => {
      this.idleProbeTimer = null;
      void client
        .status('INBOX', { messages: true, uidNext: true })
        .then((mailboxStatus) => {
          if (generation !== this.idleGeneration || this.idleClient !== client) return;
          const nextUid = Number.isSafeInteger(mailboxStatus.uidNext) ? (mailboxStatus.uidNext as number) : null;
          const messageCount = Number.isSafeInteger(mailboxStatus.messages) ? (mailboxStatus.messages as number) : null;
          const hasNewMessage =
            (nextUid !== null && this.idleKnownUidNext !== null && nextUid > this.idleKnownUidNext) ||
            (messageCount !== null && this.idleKnownMessageCount !== null && messageCount > this.idleKnownMessageCount);

          if (nextUid !== null) this.idleKnownUidNext = nextUid;
          if (messageCount !== null) this.idleKnownMessageCount = messageCount;
          if (hasNewMessage) this.requestIdleCheck();
          this.scheduleIdleProbe(generation, client);
        })
        .catch(() => {
          if (generation !== this.idleGeneration || this.idleClient !== client) return;
          this.idleClient = null;
          client.close();
          this.scheduleIdleReconnect(generation);
        });
    }, this.idleProbeIntervalMs);
    this.idleProbeTimer.unref?.();
  }

  private requestIdleCheck(): void {
    if (this.disposed) return;
    if (this.checkPromise) {
      this.idleCheckAgainRequested = true;
      return;
    }
    if (this.idleCheckTimer) return;
    this.idleCheckTimer = setTimeout(() => {
      this.idleCheckTimer = null;
      void this.checkNow();
    }, IDLE_CHECK_DEBOUNCE_MS);
    this.idleCheckTimer.unref?.();
  }

  private scheduleIdleReconnect(generation: number, immediate = false): void {
    this.cancelIdleReconnect();
    if (this.disposed || !this.idleWatchEnabled || generation !== this.idleGeneration) return;
    const delay = immediate
      ? 0
      : IDLE_RECONNECT_DELAYS_MS[Math.min(this.idleRetryAttempt++, IDLE_RECONNECT_DELAYS_MS.length - 1)];
    this.idleReconnectTimer = setTimeout(() => {
      this.idleReconnectTimer = null;
      void this.connectIdleWatcher(generation);
    }, delay);
    this.idleReconnectTimer.unref?.();
  }

  private async connectIdleWatcher(generation: number): Promise<void> {
    let client: ImapFlow | null = null;
    try {
      if (this.disposed || generation !== this.idleGeneration) return;
      const loaded = await this.loadAccount();
      if (!loaded?.config.enabled || generation !== this.idleGeneration) return;

      client = this.createClient(loaded, true);
      this.idleClient = client;
      client.on('exists', ({ count, prevCount }) => {
        if (generation !== this.idleGeneration || this.idleClient !== client || count <= prevCount) return;
        this.idleKnownMessageCount = Math.max(this.idleKnownMessageCount ?? 0, count);
        this.requestIdleCheck();
      });
      client.on('close', () => {
        if (generation !== this.idleGeneration || this.idleClient !== client) return;
        this.cancelIdleProbe();
        this.idleClient = null;
        this.scheduleIdleReconnect(generation);
      });

      await client.connect();
      const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
      if (this.disposed || generation !== this.idleGeneration || this.idleClient !== client) {
        await closeClient(client);
        return;
      }

      this.idleRetryAttempt = 0;
      this.idleKnownUidNext = mailbox.uidNext;
      this.idleKnownMessageCount = mailbox.exists;
      this.scheduleIdleProbe(generation, client);
      // Catch messages delivered while the machine was asleep or the IDLE socket
      // was reconnecting. ImapFlow automatically enters IDLE after this command.
      this.requestIdleCheck();
    } catch {
      if (this.idleClient === client) this.idleClient = null;
      if (client) await closeClient(client);
      this.scheduleIdleReconnect(generation);
    }
  }

  private startIdleWatcher(): void {
    this.stopIdleWatcher();
    if (this.disposed || !this.idleWatchEnabled || !this.status.account?.enabled) return;
    this.scheduleIdleReconnect(this.idleGeneration, true);
  }

  private schedule(minutes: number, initial = false): void {
    this.cancelTimer();
    if (this.disposed || !this.status.account?.enabled) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.checkNow();
      },
      initial ? 1_000 : Math.max(1, minutes) * 60_000
    );
    this.timer.unref?.();
  }

  private async loadAccount(): Promise<LoadedImapAccount | null> {
    return this.store.load();
  }

  private getDownloadRoot(config: LoadedImapAccount['config']): string {
    return config.downloadDirectory.trim() || this.defaultDownloadDirectory;
  }

  private createClient(loaded: LoadedImapAccount, idle = false): ImapFlow {
    const client = this.clientFactory({ ...loaded.config, password: loaded.password }, { idle });
    client.on('error', () => {
      // All user-facing errors are returned through the sanitized status code.
    });
    return client;
  }

  async initialize(): Promise<WinkGoMailStatus> {
    try {
      const loaded = await this.loadAccount();
      if (!loaded) return this.publishStatus({ account: null, state: 'disabled', unreadCount: 0 });
      const account = toPublicConfig(loaded);
      this.publishStatus({ account, state: account.enabled ? 'idle' : 'disabled', lastErrorCode: undefined });
      if (account.enabled) {
        this.schedule(account.pollIntervalMinutes, true);
        this.startIdleWatcher();
      }
      return this.status;
    } catch (error) {
      return this.publishStatus({ state: 'error', lastErrorCode: classifyImapError(error) });
    }
  }

  getStatus(): WinkGoMailStatus {
    return this.status;
  }

  private async fetchRecentMessages(
    client: ImapFlow,
    accountEmail: string,
    messageCount: number,
    limit = MAX_RECENT_MESSAGES
  ): Promise<WinkGoMailMessage[]> {
    if (messageCount <= 0) return [];
    const normalizedLimit = Math.min(MAX_RECENT_MESSAGES, Math.max(1, Math.trunc(limit)));
    const firstSequence = Math.max(1, messageCount - normalizedLimit + 1);
    const fetched: WinkGoMailMessage[] = [];
    for await (const message of client.fetch(`${firstSequence}:${messageCount}`, {
      envelope: true,
      bodyStructure: true,
      internalDate: true,
      flags: true,
    })) {
      fetched.push(toMessage(message, accountEmail));
    }
    return fetched.toSorted((left, right) => right.receivedAt - left.receivedAt || right.uid - left.uid);
  }

  async listMessages(limit = 12): Promise<WinkGoMailMessage[]> {
    const normalizedLimit = Math.min(MAX_RECENT_MESSAGES, Math.max(1, Math.trunc(limit || 12)));
    if (this.checkPromise) await this.checkPromise;
    if (this.recentMessages.length > 0) return this.recentMessages.slice(0, normalizedLimit);

    let client: ImapFlow | null = null;
    try {
      const loaded = await this.loadAccount();
      if (!loaded?.config.enabled) return [];
      client = this.createClient(loaded);
      await client.connect();
      const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
      this.recentMessages = await this.fetchRecentMessages(
        client,
        loaded.config.email,
        mailbox.exists,
        MAX_RECENT_MESSAGES
      );
      return this.recentMessages.slice(0, normalizedLimit);
    } catch {
      return [];
    } finally {
      if (client) await closeClient(client);
    }
  }

  async saveAccount(input: WinkGoMailAccountInput): Promise<WinkGoMailSaveResult> {
    try {
      const normalized = validateImapAccountInput(input);
      const { password, ...config } = normalized;
      await this.store.save({ config, password });
      const loaded = await this.loadAccount();
      if (!loaded) throw new Error('missing_password');
      const account = toPublicConfig(loaded);
      this.publishStatus({
        account,
        state: account.enabled ? 'idle' : 'disabled',
        lastErrorCode: undefined,
        unreadCount: 0,
      });
      this.recentMessages = [];
      if (account.enabled) {
        this.schedule(account.pollIntervalMinutes, true);
        this.startIdleWatcher();
      } else {
        this.cancelTimer();
        this.stopIdleWatcher();
      }
      return { ok: true, status: this.status };
    } catch (error) {
      const errorCode = classifyImapError(error);
      this.publishStatus({ state: 'error', lastErrorCode: errorCode });
      return { ok: false, status: this.status, errorCode };
    }
  }

  async clearAccount(): Promise<WinkGoMailStatus> {
    this.cancelTimer();
    this.stopIdleWatcher();
    await this.store.clear();
    this.recentMessages = [];
    return this.publishStatus({
      account: null,
      state: 'disabled',
      lastCheckedAt: undefined,
      lastErrorCode: undefined,
      unreadCount: 0,
    });
  }

  private async resolveTestAccount(input: WinkGoMailAccountInput): Promise<LoadedImapAccount> {
    const normalized = validateImapAccountInput(input);
    if (normalized.password) {
      const { password, ...config } = normalized;
      return { config, password, checkpoint: { uidValidity: null, lastUid: null } };
    }
    const existing = await this.loadAccount();
    if (!existing || existing.config.email !== normalized.email || existing.config.username !== normalized.username) {
      throw new Error('missing_password');
    }
    const { password: _password, ...config } = normalized;
    return { config, password: existing.password, checkpoint: existing.checkpoint };
  }

  async testConnection(input: WinkGoMailAccountInput): Promise<WinkGoMailTestResult> {
    const startedAt = Date.now();
    let client: ImapFlow | null = null;
    try {
      const loaded = await this.resolveTestAccount(input);
      client = this.createClient(loaded);
      await client.connect();
      await client.mailboxOpen('INBOX', { readOnly: true });
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return { ok: false, errorCode: classifyImapError(error), latencyMs: Date.now() - startedAt };
    } finally {
      if (client) await closeClient(client);
    }
  }

  private async performCheck(): Promise<WinkGoMailStatus> {
    let loaded: LoadedImapAccount | null = null;
    let client: ImapFlow | null = null;
    try {
      loaded = await this.loadAccount();
      if (!loaded) return this.publishStatus({ account: null, state: 'disabled', unreadCount: 0 });
      const account = toPublicConfig(loaded);
      if (!account.enabled) return this.publishStatus({ account, state: 'disabled' });
      this.publishStatus({ account, state: 'checking', lastErrorCode: undefined });

      client = this.createClient(loaded);
      await client.connect();
      const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
      const uidValidity = mailbox.uidValidity.toString();
      const previousUid = loaded.checkpoint.uidValidity === uidValidity ? loaded.checkpoint.lastUid : null;
      const syncPlan = planUidSync(previousUid, mailbox.uidNext);
      const unread = await client.search({ seen: false }, { uid: true });
      this.recentMessages = await this.fetchRecentMessages(client, account.email, mailbox.exists, MAX_RECENT_MESSAGES);

      if (syncPlan.range) {
        const fetched: WinkGoMailMessage[] = [];
        for await (const message of client.fetch(
          `${syncPlan.range.from}:${syncPlan.range.to}`,
          { envelope: true, bodyStructure: true, internalDate: true, flags: true },
          { uid: true }
        )) {
          fetched.push(toMessage(message, account.email));
        }
        for (const message of fetched
          .toSorted((left, right) => left.uid - right.uid)
          .slice(-MAX_NOTIFICATIONS_PER_CHECK)) {
          this.onMessage?.(message);
        }
      }

      await this.store.updateCheckpoint(uidValidity, syncPlan.nextCheckpoint);
      return this.publishStatus({
        account,
        state: 'connected',
        lastCheckedAt: Date.now(),
        lastErrorCode: undefined,
        unreadCount: Array.isArray(unread) ? unread.length : 0,
      });
    } catch (error) {
      return this.publishStatus({
        state: 'error',
        lastCheckedAt: Date.now(),
        lastErrorCode: classifyImapError(error),
      });
    } finally {
      if (client) await closeClient(client);
      if (loaded?.config.enabled) this.schedule(loaded.config.pollIntervalMinutes);
    }
  }

  checkNow(): Promise<WinkGoMailStatus> {
    if (this.checkPromise) return this.checkPromise;
    this.cancelTimer();
    this.checkPromise = this.performCheck().finally(() => {
      this.checkPromise = null;
      if (this.idleCheckAgainRequested) {
        this.idleCheckAgainRequested = false;
        this.requestIdleCheck();
      }
    });
    return this.checkPromise;
  }

  async previewMessage(uid: number): Promise<WinkGoMailPreviewResult> {
    if (!Number.isSafeInteger(uid) || uid <= 0) {
      return { ok: false, attachmentNames: [], errorCode: 'message_not_found' };
    }
    let client: ImapFlow | null = null;
    try {
      const loaded = await this.loadAccount();
      if (!loaded) return { ok: false, attachmentNames: [], errorCode: 'not_configured' };
      client = this.createClient(loaded);
      await client.connect();
      await client.mailboxOpen('INBOX', { readOnly: true });
      const metadata = await client.fetchOne(String(uid), { size: true }, { uid: true });
      if (!metadata) return { ok: false, attachmentNames: [], errorCode: 'message_not_found' };
      if ((metadata.size ?? 0) > MAX_MESSAGE_BYTES) {
        return { ok: false, attachmentNames: [], errorCode: 'message_too_large' };
      }
      const message = await client.fetchOne(
        String(uid),
        { source: { maxLength: MAX_MESSAGE_BYTES + 1 } },
        { uid: true }
      );
      if (!message || !message.source) return { ok: false, attachmentNames: [], errorCode: 'message_not_found' };
      if (message.source.byteLength > MAX_MESSAGE_BYTES) {
        return { ok: false, attachmentNames: [], errorCode: 'message_too_large' };
      }
      return { ok: true, ...(await previewMailSource(message.source)) };
    } catch (error) {
      const errorCode = classifyImapError(error);
      return {
        ok: false,
        attachmentNames: [],
        errorCode: errorCode === 'connection_failed' ? 'download_failed' : errorCode,
      };
    } finally {
      if (client) await closeClient(client);
    }
  }

  async downloadMessage(uid: number): Promise<WinkGoMailDownloadResult> {
    if (!Number.isSafeInteger(uid) || uid <= 0) {
      return { ok: false, attachments: [], errorCode: 'message_not_found' };
    }
    let client: ImapFlow | null = null;
    try {
      const loaded = await this.loadAccount();
      if (!loaded) return { ok: false, attachments: [], errorCode: 'not_configured' };
      client = this.createClient(loaded);
      await client.connect();
      await client.mailboxOpen('INBOX', { readOnly: true });
      const metadata = await client.fetchOne(String(uid), { size: true }, { uid: true });
      if (!metadata) return { ok: false, attachments: [], errorCode: 'message_not_found' };
      if ((metadata.size ?? 0) > MAX_MESSAGE_BYTES) {
        return { ok: false, attachments: [], errorCode: 'message_too_large' };
      }
      const message = await client.fetchOne(
        String(uid),
        { source: { maxLength: MAX_MESSAGE_BYTES + 1 } },
        { uid: true }
      );
      if (!message || !message.source) return { ok: false, attachments: [], errorCode: 'message_not_found' };
      if (message.source.byteLength > MAX_MESSAGE_BYTES) {
        return { ok: false, attachments: [], errorCode: 'message_too_large' };
      }
      const saved = await saveMailSource({
        source: message.source,
        rootDirectory: this.getDownloadRoot(loaded.config),
        accountEmail: loaded.config.email,
        uid,
      });
      return { ok: true, ...saved };
    } catch (error) {
      const errorCode = classifyImapError(error);
      return {
        ok: false,
        attachments: [],
        errorCode: errorCode === 'connection_failed' ? 'download_failed' : errorCode,
      };
    } finally {
      if (client) await closeClient(client);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.stopIdleWatcher();
  }
}
