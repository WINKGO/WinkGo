// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import classNames from 'classnames';
import { removeStack } from '@/renderer/utils/common';

const addWindowEventListener = <K extends keyof WindowEventMap>(
  key: K,
  handler: (e: WindowEventMap[K]) => void
): (() => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener(key, handler);
  return () => {
    window.removeEventListener(key, handler);
  };
};

interface UseResizableSplitOptions {
  /** 默认宽度。`unit: 'ratio'` 时为百分比 (0-100)，`unit: 'px'` 时为像素值 */
  defaultWidth?: number;
  /** 最小宽度（同 defaultWidth 的单位） */
  minWidth?: number;
  /** 最大宽度（同 defaultWidth 的单位） */
  maxWidth?: number;
  /** LocalStorage 存储键名（用于记录偏好） */
  storageKey?: string;
  /** 单位：百分比或像素。默认 'ratio'（向后兼容） */
  unit?: 'ratio' | 'px';
}

/**
 * 可拖动分割面板 Hook，支持记录用户偏好
 * Resizable split panel Hook with user preference persistence
 *
 * @param options - 配置选项 / Configuration options
 * @returns 分割比例、拖动句柄和设置函数 / Split ratio, drag handle, and setter function
 */
export const useResizableSplit = (options: UseResizableSplitOptions = {}) => {
  const { defaultWidth = 50, minWidth = 20, maxWidth = 80, storageKey, unit = 'ratio' } = options;
  const isPx = unit === 'px';

  // 从 LocalStorage 读取保存的比例 / Read saved ratio from LocalStorage
  const getStoredRatio = (): number => {
    if (!storageKey) return defaultWidth;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const ratio = parseFloat(stored);
        if (!isNaN(ratio) && ratio >= minWidth && ratio <= maxWidth) {
          return ratio;
        }
      }
    } catch (error) {
      console.error('Failed to read split ratio from localStorage:', error);
    }
    return defaultWidth;
  };

  const [splitRatio, setSplitRatioState] = useState(() => getStoredRatio());

  const dispatchSplitResizeEvent = useCallback((ratio: number) => {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
      return;
    }
    window.dispatchEvent(new CustomEvent('preview-panel-resize', { detail: { ratio } }));
  }, []);

  // 保存比例到 LocalStorage / Save ratio to LocalStorage
  const setSplitRatio = useCallback(
    (ratio: number) => {
      setSplitRatioState(ratio);
      dispatchSplitResizeEvent(ratio);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, ratio.toString());
        } catch (error) {
          console.error('Failed to save split ratio to localStorage:', error);
        }
      }
    },
    [storageKey, dispatchSplitResizeEvent]
  );

  // 处理拖动开始事件 / Handle drag start event
  const handleDragStart = useCallback(
    (reverse = false) =>
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== 'touch' && event.button !== 0) {
          return;
        }
        event.preventDefault();

        const dragHandle = event.currentTarget as HTMLElement;
        const parent = dragHandle.parentElement;
        const outerContainer = parent?.parentElement;
        const containerWidth = outerContainer?.offsetWidth || 0;
        if (!isPx && !containerWidth) {
          return;
        }

        const startX = event.clientX;
        const startRatio = splitRatio;
        const pointerId = event.pointerId;
        // px 模式下拖动直接换算为像素差，不再除以容器宽度
        const computeRatio = (clientX: number): number => {
          const deltaX = reverse ? startX - clientX : clientX - startX;
          if (isPx) {
            return Math.max(minWidth, Math.min(maxWidth, startRatio + deltaX));
          }
          const deltaRatio = (deltaX / containerWidth) * 100;
          return Math.max(minWidth, Math.min(maxWidth, startRatio + deltaRatio));
        };
        let rafId: number | null = null;
        let pendingRatio: number | null = null;
        let latestRatio = startRatio;
        let isDragging = true;
        let cleanupListeners: (() => void) | null = null;

        const flushPendingRatio = () => {
          if (pendingRatio === null) {
            return;
          }
          latestRatio = pendingRatio;
          setSplitRatioState(pendingRatio);
          dispatchSplitResizeEvent(pendingRatio);
        };

        // 初始化拖动样式 / Initialize drag styles
        const initDragStyle = () => {
          const originalUserSelect = document.body.style.userSelect;
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'col-resize';

          const layoutSider = dragHandle.closest('.layout-sider');
          if (layoutSider) {
            layoutSider.classList.add('layout-sider--dragging');
          }

          return () => {
            document.body.style.userSelect = originalUserSelect;
            document.body.style.cursor = '';
            if (rafId !== null) {
              cancelAnimationFrame(rafId);
              rafId = null;
            }
            if (layoutSider) {
              layoutSider.classList.remove('layout-sider--dragging');
            }
          };
        };

        const finishDrag = (e?: PointerEvent | MouseEvent | FocusEvent) => {
          if (!isDragging) {
            return;
          }
          isDragging = false;

          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          flushPendingRatio();

          let finalRatio = latestRatio;
          if (e && 'clientX' in e && typeof e.clientX === 'number') {
            finalRatio = computeRatio(e.clientX);
            latestRatio = finalRatio;
          }

          setSplitRatio(finalRatio);
          cleanupListeners?.();
        };

        const handlePointerMove = (e: PointerEvent) => {
          if (!isDragging) {
            return;
          }
          if (e.buttons === 0) {
            finishDrag(e);
            return;
          }
          pendingRatio = computeRatio(e.clientX);
          if (rafId === null) {
            rafId = requestAnimationFrame(() => {
              rafId = null;
              flushPendingRatio();
            });
          }
        };

        const handleLostPointerCapture = () => finishDrag();

        const handlePointerUp = (e: PointerEvent) => finishDrag(e);
        const handlePointerCancel = (e: PointerEvent) => finishDrag(e);
        const handleMouseUp = (e: MouseEvent) => finishDrag(e);

        if (dragHandle.setPointerCapture) {
          try {
            dragHandle.setPointerCapture(pointerId);
            dragHandle.addEventListener('lostpointercapture', handleLostPointerCapture);
          } catch (error) {
            // 忽略 pointer capture 失败，继续使用备用逻辑 / Ignore failures silently
          }
        }

        const releasePointerCapture = () => {
          if (dragHandle.releasePointerCapture && dragHandle.hasPointerCapture?.(pointerId)) {
            dragHandle.releasePointerCapture(pointerId);
          }
          dragHandle.removeEventListener('lostpointercapture', handleLostPointerCapture);
        };

        cleanupListeners = removeStack(
          initDragStyle(),
          releasePointerCapture,
          addWindowEventListener('pointermove', handlePointerMove),
          addWindowEventListener('pointerup', handlePointerUp),
          addWindowEventListener('pointercancel', handlePointerCancel),
          addWindowEventListener('mouseup', handleMouseUp),
          addWindowEventListener('blur', () => finishDrag())
        );
      },
    [splitRatio, minWidth, maxWidth, setSplitRatio, dispatchSplitResizeEvent, isPx]
  );

  const renderHandle = ({
    className,
    style,
    reverse,
    linePlacement,
    lineClassName,
    lineStyle,
    compact = false,
    ariaLabel = '调整面板宽度',
  }: {
    className?: string;
    style?: CSSProperties;
    reverse?: boolean;
    linePlacement?: 'start' | 'end';
    lineClassName?: string;
    lineStyle?: CSSProperties;
    /** Use a short Codex-style grip instead of a full-height divider line. */
    compact?: boolean;
    ariaLabel?: string;
  } = {}) => (
    <div
      className={classNames(
        'group absolute top-0 bottom-0 z-20 cursor-col-resize flex items-center',
        linePlacement
          ? linePlacement === 'start'
            ? 'justify-start'
            : 'justify-end'
          : reverse
            ? 'justify-start'
            : 'justify-end',
        className
      )}
      style={{ width: '12px', ...style }}
      role='separator'
      aria-label={ariaLabel}
      aria-orientation='vertical'
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={Math.round(splitRatio)}
      tabIndex={0}
      onPointerDown={handleDragStart(reverse)}
      onKeyDown={(event) => {
        const step = isPx ? 24 : 2;
        let nextRatio: number | null = null;
        if (event.key === 'Home') nextRatio = minWidth;
        if (event.key === 'End') nextRatio = maxWidth;
        if (event.key === 'ArrowLeft') nextRatio = splitRatio + (reverse ? step : -step);
        if (event.key === 'ArrowRight') nextRatio = splitRatio + (reverse ? -step : step);
        if (nextRatio === null) return;
        event.preventDefault();
        setSplitRatio(Math.max(minWidth, Math.min(maxWidth, nextRatio)));
      }}
      onDoubleClick={() => setSplitRatio(defaultWidth)}
    >
      <span
        data-winkgo-resize-grip='true'
        className={classNames(
          'pointer-events-none block rd-full transition-all duration-150',
          compact
            ? 'h-44px w-4px bg-bg-4 opacity-85 shadow-[0_0_0_1px_var(--bg-2),0_4px_14px_rgba(56,126,255,0.16)] group-hover:h-56px group-hover:w-5px group-hover:bg-aou-6 group-hover:opacity-100 group-active:h-60px group-active:w-5px group-active:bg-aou-6 group-focus-visible:h-56px group-focus-visible:w-5px group-focus-visible:bg-aou-6'
            : 'h-full w-2px bg-bg-3 opacity-90 group-hover:w-6px group-hover:bg-aou-6 group-active:w-6px group-active:bg-aou-6',
          lineClassName
        )}
        style={lineStyle}
      />
    </div>
  );

  return {
    splitRatio,
    dragHandle: renderHandle({ className: 'right-0' }),
    setSplitRatio,
    createDragHandle: renderHandle,
  };
};
