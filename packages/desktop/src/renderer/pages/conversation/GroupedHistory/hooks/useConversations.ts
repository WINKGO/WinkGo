// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import type { TimelineSection } from '../types';
import {
  dispatchWorkspaceExpansionChange,
  readExpandedWorkspaces,
  WORKSPACE_EXPANSION_STORAGE_KEY,
} from './useWorkspaceExpansionState';

// Persist section collapsed state across reloads.
const COLLAPSED_SECTIONS_KEY = 'grouped-history-collapsed-sections';

const readCollapsedSections = (): Set<string> => {
  try {
    const raw = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
};

// Where an active conversation lives, so we can expand the right containers
// before scrolling it into view.
type ConversationLocation = { section: 'pinned' | 'projects' | 'conversations'; workspace?: string };

const locateConversation = (
  id: string,
  pinned: TChatConversation[],
  sections: TimelineSection[]
): ConversationLocation | null => {
  if (pinned.some((c) => c.id === id)) return { section: 'pinned' };
  for (const section of sections) {
    for (const item of section.items) {
      if (item.type === 'workspace' && item.workspaceGroup) {
        if (item.workspaceGroup.conversations.some((c) => c.id === id)) {
          return { section: 'projects', workspace: item.workspaceGroup.workspace };
        }
      } else if (item.type === 'conversation' && item.conversation?.id === id) {
        return { section: 'conversations' };
      }
    }
  }
  return null;
};

export const useConversations = () => {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<string[]>(() => readExpandedWorkspaces());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => readCollapsedSections());
  const { id } = useParams();
  const {
    conversations,
    isConversationGenerating,
    hasCompletionUnread,
    clearCompletionUnread,
    isManualUnread,
    markManualUnread,
    clearManualUnread,
    setActiveConversation,
    groupedHistory,
  } = useConversationHistoryContext();

  const { pinnedConversations, timelineSections } = groupedHistory;

  // Track whether auto-expand has already been performed to avoid
  // re-expanding workspaces after a user manually collapses them (#1156)
  const hasAutoExpandedRef = useRef(false);
  // Guard so the auto-expand + scroll for a given active id runs only once.
  // Reset when the active id changes so navigating back to a conversation
  // re-triggers, but manual collapses afterwards are not fought.
  const revealedIdRef = useRef<string | null>(null);

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Reveal + scroll the active conversation into view.
  // Depends on the grouped data because on a cold start (opening the app
  // directly on a conversation URL) the list loads asynchronously — we re-run
  // once the target can be located, then expand its section/folder and scroll.
  // Wait one frame for a newly expanded container to render, then reveal the
  // active row without a smooth-scroll animation. Conversation changes are a
  // high-frequency action, so animating the sidebar here needlessly keeps the
  // renderer busy while the chat view is mounting.
  useEffect(() => {
    if (!id) {
      setActiveConversation(null);
      revealedIdRef.current = null;
      return;
    }

    setActiveConversation(id);
    clearCompletionUnread(id);
    clearManualUnread(id);

    if (revealedIdRef.current === id) return;

    const location = locateConversation(id, pinnedConversations, timelineSections);
    if (!location) return; // data not loaded yet; effect re-runs when it arrives
    revealedIdRef.current = id;

    // Expand the containing section if collapsed.
    setCollapsedSections((prev) => {
      if (!prev.has(location.section)) return prev;
      const next = new Set(prev);
      next.delete(location.section);
      return next;
    });
    // Expand the containing project folder if collapsed.
    if (location.workspace) {
      const workspace = location.workspace;
      setExpandedWorkspaces((prev) => (prev.includes(workspace) ? prev : [...prev, workspace]));
    }

    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      const element = document.getElementById('c-' + id);
      if (element) {
        element.scrollIntoView({ behavior: 'auto', block: 'nearest' });
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [clearCompletionUnread, clearManualUnread, id, setActiveConversation, pinnedConversations, timelineSections]);

  // Persist workspace expansion state
  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_EXPANSION_STORAGE_KEY, JSON.stringify(expandedWorkspaces));
    } catch {
      // ignore
    }

    dispatchWorkspaceExpansionChange(expandedWorkspaces);
  }, [expandedWorkspaces]);

  // Persist section collapsed state
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...collapsedSections]));
    } catch {
      // ignore
    }
  }, [collapsedSections]);

  // Auto-expand all workspaces on first load only (#1156)
  useEffect(() => {
    if (hasAutoExpandedRef.current) return;
    if (expandedWorkspaces.length > 0) {
      hasAutoExpandedRef.current = true;
      return;
    }
    const allWorkspaces: string[] = [];
    timelineSections.forEach((section) => {
      section.items.forEach((item) => {
        if (item.type === 'workspace' && item.workspaceGroup) {
          allWorkspaces.push(item.workspaceGroup.workspace);
        }
      });
    });
    if (allWorkspaces.length > 0) {
      setExpandedWorkspaces(allWorkspaces);
      hasAutoExpandedRef.current = true;
    }
  }, [timelineSections]);

  // Remove stale workspace entries that no longer exist in the data
  useEffect(() => {
    const currentWorkspaces = new Set<string>();
    timelineSections.forEach((section) => {
      section.items.forEach((item) => {
        if (item.type === 'workspace' && item.workspaceGroup) {
          currentWorkspaces.add(item.workspaceGroup.workspace);
        }
      });
    });
    if (currentWorkspaces.size === 0) return;
    setExpandedWorkspaces((prev) => {
      const filtered = prev.filter((ws) => currentWorkspaces.has(ws));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [timelineSections]);

  const handleToggleWorkspace = useCallback((workspace: string) => {
    setExpandedWorkspaces((prev) => {
      if (prev.includes(workspace)) {
        return prev.filter((item) => item !== workspace);
      }
      return [...prev, workspace];
    });
  }, []);

  return {
    conversations,
    isConversationGenerating,
    hasCompletionUnread,
    isManualUnread,
    markManualUnread,
    clearManualUnread,
    expandedWorkspaces,
    pinnedConversations,
    timelineSections,
    handleToggleWorkspace,
    collapsedSections,
    toggleSection,
  };
};
