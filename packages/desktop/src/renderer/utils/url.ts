// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Return a normalized URL only when the whole value is one http(s) URL. */
export function parseHttpUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function closestAnchor(node: Node | null): HTMLAnchorElement | null {
  if (!node) return null;
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest?.('a') ?? null;
}

/** Resolve a selected raw URL or a selection contained by one shared link. */
export function resolveSelectionHttpUrl(text: string, anchorNode: Node | null, focusNode: Node | null): string | null {
  const direct = parseHttpUrl(text);
  if (direct) return direct;

  const anchor = closestAnchor(anchorNode);
  return anchor && anchor === closestAnchor(focusNode) ? parseHttpUrl(anchor.href) : null;
}
