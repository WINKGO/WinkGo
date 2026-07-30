import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type {
  WinkGoFileCommand,
  WinkGoOrganizeOperation,
  WinkGoOrganizerMode,
  WinkGoOrganizerRule,
} from '@/common/adapter/ipcBridge';
import {
  WINK_GO_ORGANIZER_SETTINGS_EVENT,
  WINK_GO_ORGANIZER_STORAGE_KEYS,
} from '@renderer/utils/winkgo/islandFilePreferences';

const {
  recentFiles: RECENT_FILES_KEY,
  lastBatch: LAST_BATCH_KEY,
  rules: RULES_KEY,
  root: ROOT_KEY,
  mode: MODE_KEY,
  autoRename: AUTO_RENAME_KEY,
} = WINK_GO_ORGANIZER_STORAGE_KEYS;
const MAX_RECENT_FILES = 12;
const MAX_CUSTOM_RULES = 32;

export type IslandRecentFile = Pick<
  WinkGoOrganizeOperation,
  'destination' | 'finalName' | 'category' | 'classification' | 'fileType' | 'sizeBytes' | 'organizedAt'
>;

export type IslandFileOrganizerStatus = {
  type: 'idle' | 'success' | 'error';
  organized?: number;
  failed?: number;
  restored?: number;
  code?: string;
};

const readStorageArray = <T>(key: string, validate: (value: unknown) => value is T): T[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validate);
  } catch {
    return [];
  }
};

const isRecentFile = (value: unknown): value is IslandRecentFile => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<IslandRecentFile>;
  return typeof candidate.destination === 'string' && typeof candidate.finalName === 'string';
};

const isRule = (value: unknown): value is WinkGoOrganizerRule => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WinkGoOrganizerRule>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    Array.isArray(candidate.keywords) &&
    candidate.keywords.every((keyword) => typeof keyword === 'string')
  );
};

const isOperation = (value: unknown): value is WinkGoOrganizeOperation => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WinkGoOrganizeOperation>;
  return (
    typeof candidate.source === 'string' &&
    typeof candidate.destination === 'string' &&
    (candidate.mode === 'move' || candidate.mode === 'copy')
  );
};

const sanitizeCategoryName = (value: string): string =>
  value
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 32);

const writeStorage = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in hardened browser sessions.
  }
};

type UseIslandFileOrganizerOptions = {
  enabled?: boolean;
  onCommand: (command: WinkGoFileCommand['type']) => void;
};

export const useIslandFileOrganizer = ({ enabled = true, onCommand }: UseIslandFileOrganizerOptions) => {
  const [recentFiles, setRecentFiles] = useState<IslandRecentFile[]>(() =>
    readStorageArray(RECENT_FILES_KEY, isRecentFile).slice(0, MAX_RECENT_FILES)
  );
  const [lastBatch, setLastBatch] = useState<WinkGoOrganizeOperation[]>(() =>
    readStorageArray(LAST_BATCH_KEY, isOperation)
  );
  const [rules, setRules] = useState<WinkGoOrganizerRule[]>(() =>
    readStorageArray(RULES_KEY, isRule).slice(0, MAX_CUSTOM_RULES)
  );
  const [destinationRoot, setDestinationRoot] = useState(() => window.localStorage.getItem(ROOT_KEY) || '');
  const [mode, setModeState] = useState<WinkGoOrganizerMode>(() =>
    window.localStorage.getItem(MODE_KEY) === 'copy' ? 'copy' : 'move'
  );
  const [autoRename, setAutoRenameState] = useState(() => window.localStorage.getItem(AUTO_RENAME_KEY) !== 'false');
  const [pendingPaths, setPendingPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<IslandFileOrganizerStatus>({ type: 'idle' });

  useEffect(() => {
    const unsubscribe = ipcBridge.winkGoFiles.command.on(({ type }) => {
      if (enabled) onCommand(type);
    });
    if (window.electronAPI) {
      void ipcBridge.winkGoFiles.activateShortcuts.invoke().catch((): undefined => undefined);
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!enabled || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const command =
        event.key === '2'
          ? 'openShelf'
          : event.key === '3'
            ? 'newCategory'
            : event.key === '4'
              ? 'openFormat'
              : undefined;
      if (!command) return;
      event.preventDefault();
      onCommand(command);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, onCommand]);

  useEffect(() => {
    const refreshFromStorage = () => {
      setRecentFiles(readStorageArray(RECENT_FILES_KEY, isRecentFile).slice(0, MAX_RECENT_FILES));
      setLastBatch(readStorageArray(LAST_BATCH_KEY, isOperation));
      setRules(readStorageArray(RULES_KEY, isRule).slice(0, MAX_CUSTOM_RULES));
      setDestinationRoot(window.localStorage.getItem(ROOT_KEY) || '');
      setModeState(window.localStorage.getItem(MODE_KEY) === 'copy' ? 'copy' : 'move');
      setAutoRenameState(window.localStorage.getItem(AUTO_RENAME_KEY) !== 'false');
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key && (Object.values(WINK_GO_ORGANIZER_STORAGE_KEYS) as readonly string[]).includes(event.key)) {
        refreshFromStorage();
      }
    };
    window.addEventListener(WINK_GO_ORGANIZER_SETTINGS_EVENT, refreshFromStorage);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(WINK_GO_ORGANIZER_SETTINGS_EVENT, refreshFromStorage);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const ensureDestinationRoot = useCallback(async (): Promise<string> => {
    if (destinationRoot) return destinationRoot;
    const defaultRoot = await ipcBridge.winkGoFiles.getDefaultFolder.invoke();
    setDestinationRoot(defaultRoot);
    window.localStorage.setItem(ROOT_KEY, defaultRoot);
    return defaultRoot;
  }, [destinationRoot]);

  const chooseRoot = useCallback(async (): Promise<void> => {
    const selected = await ipcBridge.dialog.showOpen.invoke({
      defaultPath: destinationRoot || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    const nextRoot = selected?.[0];
    if (!nextRoot) return;
    setDestinationRoot(nextRoot);
    window.localStorage.setItem(ROOT_KEY, nextRoot);
  }, [destinationRoot]);

  const chooseFiles = useCallback(async (): Promise<string[]> => {
    if (!enabled) return [];
    const selected = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openFile', 'multiSelections'],
    });
    const paths = (selected ?? []).filter(Boolean).slice(0, 64);
    if (paths.length > 0) {
      await ensureDestinationRoot();
      setPendingPaths(paths);
      setStatus({ type: 'idle' });
    }
    return paths;
  }, [enabled, ensureDestinationRoot]);

  const stagePaths = useCallback(
    async (paths: string[]): Promise<boolean> => {
      if (!enabled) return false;
      const accepted = paths.filter(Boolean).slice(0, 64);
      if (accepted.length === 0) return false;
      await ensureDestinationRoot();
      setPendingPaths(accepted);
      setStatus({ type: 'idle' });
      return true;
    },
    [enabled, ensureDestinationRoot]
  );

  const organizePending = useCallback(
    async (manualClassification?: string): Promise<boolean> => {
      if (busy || pendingPaths.length === 0) return false;
      setBusy(true);
      setStatus({ type: 'idle' });
      try {
        const root = await ensureDestinationRoot();
        const result = await ipcBridge.winkGoFiles.organize.invoke({
          paths: pendingPaths,
          destinationRoot: root,
          mode,
          autoRename,
          customRules: rules,
          manualClassification,
        });
        const additions: IslandRecentFile[] = result.operations.map((operation) => ({
          destination: operation.destination,
          finalName: operation.finalName,
          category: operation.category,
          classification: operation.classification,
          fileType: operation.fileType,
          sizeBytes: operation.sizeBytes,
          organizedAt: operation.organizedAt,
        }));
        const unique = new Map<string, IslandRecentFile>();
        for (const file of [...additions, ...recentFiles]) {
          if (!unique.has(file.destination)) unique.set(file.destination, file);
        }
        const nextRecent = [...unique.values()].slice(0, MAX_RECENT_FILES);
        setRecentFiles(nextRecent);
        setLastBatch(result.operations);
        setPendingPaths([]);
        writeStorage(RECENT_FILES_KEY, nextRecent);
        writeStorage(LAST_BATCH_KEY, result.operations);
        setStatus({
          type: result.failures.length > 0 && result.operations.length === 0 ? 'error' : 'success',
          organized: result.operations.length,
          failed: result.failures.length,
          code: result.failures[0]?.reason,
        });
        return result.operations.length > 0;
      } catch (error) {
        setStatus({ type: 'error', code: error instanceof Error ? error.message : 'ORGANIZE_FAILED' });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [autoRename, busy, ensureDestinationRoot, mode, pendingPaths, recentFiles, rules]
  );

  const undoLastBatch = useCallback(async (): Promise<boolean> => {
    if (busy || lastBatch.length === 0) return false;
    setBusy(true);
    try {
      const result = await ipcBridge.winkGoFiles.undo.invoke({ operations: lastBatch });
      const restored = new Set(result.restored);
      const nextRecent = recentFiles.filter(
        (file) => !lastBatch.some((operation) => operation.destination === file.destination)
      );
      setRecentFiles(nextRecent);
      setLastBatch([]);
      writeStorage(RECENT_FILES_KEY, nextRecent);
      writeStorage(LAST_BATCH_KEY, []);
      setStatus({
        type: result.failures.length > 0 && restored.size === 0 ? 'error' : 'success',
        restored: restored.size,
        failed: result.failures.length,
        code: result.failures[0]?.reason,
      });
      return restored.size > 0;
    } catch (error) {
      setStatus({ type: 'error', code: error instanceof Error ? error.message : 'UNDO_FAILED' });
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, lastBatch, recentFiles]);

  const addCategory = useCallback(
    (rawName: string): 'added' | 'invalid' | 'duplicate' | 'limit' => {
      const name = sanitizeCategoryName(rawName);
      if (name.length < 2) return 'invalid';
      if (rules.some((rule) => rule.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return 'duplicate';
      if (rules.length >= MAX_CUSTOM_RULES) return 'limit';
      const nextRules = [...rules, { id: `island-${Date.now().toString(36)}`, name, keywords: [name] }];
      setRules(nextRules);
      writeStorage(RULES_KEY, nextRules);
      return 'added';
    },
    [rules]
  );

  const removeCategory = useCallback(
    (id: string) => {
      const nextRules = rules.filter((rule) => rule.id !== id);
      setRules(nextRules);
      writeStorage(RULES_KEY, nextRules);
    },
    [rules]
  );

  const setMode = useCallback((nextMode: WinkGoOrganizerMode) => {
    setModeState(nextMode);
    window.localStorage.setItem(MODE_KEY, nextMode);
  }, []);

  const setAutoRename = useCallback((nextEnabled: boolean) => {
    setAutoRenameState(nextEnabled);
    window.localStorage.setItem(AUTO_RENAME_KEY, String(nextEnabled));
  }, []);

  const openRecentFile = useCallback(async (file: IslandRecentFile): Promise<void> => {
    await ipcBridge.shell.openFile.invoke(file.destination);
  }, []);

  const revealRecentFile = useCallback(async (file: IslandRecentFile): Promise<void> => {
    await ipcBridge.winkGoFiles.showItemInFolder.invoke({ path: file.destination });
  }, []);

  return {
    recentFiles,
    lastBatch,
    rules,
    destinationRoot,
    mode,
    autoRename,
    pendingPaths,
    busy,
    status,
    chooseFiles,
    chooseRoot,
    stagePaths,
    organizePending,
    undoLastBatch,
    addCategory,
    removeCategory,
    setMode,
    setAutoRename,
    openRecentFile,
    revealRecentFile,
    clearPending: () => setPendingPaths([]),
  };
};
