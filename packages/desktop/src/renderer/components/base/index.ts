/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WinkGo 基础组件库统一导出 / WinkGo base components unified exports
 *
 * 提供所有基础组件和类型的统一导出入口
 * Provides unified export entry for all base components and types
 */

// ==================== 组件导出 / Component Exports ====================

export { default as WinkGoModal } from './WinkGoModal';
export { default as WinkGoCollapse } from './WinkGoCollapse';
export { default as WinkGoSelect } from './WinkGoSelect';
export { default as WinkGoScrollArea } from './WinkGoScrollArea';
export { default as WinkGoSteps } from './WinkGoSteps';
export { default as WinkGoSearchInput } from './WinkGoSearchInput';
export { default as WinkGoInlineSearchInput } from './WinkGoInlineSearchInput';

// ==================== 类型导出 / Type Exports ====================

// WinkGoModal 类型 / WinkGoModal types
export type {
  ModalSize,
  ModalHeaderConfig,
  ModalFooterConfig,
  ModalContentStyleConfig,
  WinkGoModalProps,
} from './WinkGoModal';
export { MODAL_SIZES } from './WinkGoModal';

// WinkGoCollapse 类型 / WinkGoCollapse types
export type { WinkGoCollapseProps, WinkGoCollapseItemProps } from './WinkGoCollapse';

// WinkGoSelect 类型 / WinkGoSelect types
export type { WinkGoSelectProps } from './WinkGoSelect';

// WinkGoSteps 类型 / WinkGoSteps types
export type { WinkGoStepsProps } from './WinkGoSteps';

// WinkGoSearchInput 类型 / WinkGoSearchInput types
export type { WinkGoSearchInputProps } from './WinkGoSearchInput';

// WinkGoInlineSearchInput 类型 / WinkGoInlineSearchInput types
export type { WinkGoInlineSearchInputProps } from './WinkGoInlineSearchInput';
