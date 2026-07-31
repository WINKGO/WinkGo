// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Steps } from '@arco-design/web-react';
import type { StepsProps } from '@arco-design/web-react/es/Steps';
import classNames from 'classnames';
import React from 'react';

/**
 * 步骤条组件属性 / Steps component props
 */
export interface WinkGoStepsProps extends StepsProps {
  /** 额外的类名 / Additional class name */
  className?: string;
}

/**
 * 步骤条组件 / Steps component
 *
 * 基于 Arco Design Steps 的封装，提供统一的样式主题
 * Wrapper around Arco Design Steps with unified theme styling
 *
 * @features
 * - 自定义品牌色主题 / Custom brand color theme
 * - 完成态的特殊样式处理 / Special styling for finished state
 * - 完整的 Arco Steps API 支持 / Full Arco Steps API support
 *
 * @example
 * ```tsx
 * // 基本用法 / Basic usage
 * <WinkGoSteps current={1}>
 *   <WinkGoSteps.Step title="步骤1" description="这是描述" />
 *   <WinkGoSteps.Step title="步骤2" description="这是描述" />
 *   <WinkGoSteps.Step title="步骤3" description="这是描述" />
 * </WinkGoSteps>
 *
 * // 垂直步骤条 / Vertical steps
 * <WinkGoSteps current={1} direction="vertical">
 *   <WinkGoSteps.Step title="步骤1" description="描述" />
 *   <WinkGoSteps.Step title="步骤2" description="描述" />
 * </WinkGoSteps>
 *
 * // 带图标的步骤条 / Steps with icons
 * <WinkGoSteps current={1}>
 *   <WinkGoSteps.Step title="完成" icon={<IconCheck />} />
 *   <WinkGoSteps.Step title="进行中" icon={<IconLoading />} />
 *   <WinkGoSteps.Step title="待处理" icon={<IconClock />} />
 * </WinkGoSteps>
 *
 * // 迷你版步骤条 / Mini steps
 * <WinkGoSteps current={1} size="small" type="dot">
 *   <WinkGoSteps.Step title="步骤1" />
 *   <WinkGoSteps.Step title="步骤2" />
 *   <WinkGoSteps.Step title="步骤3" />
 * </WinkGoSteps>
 * ```
 *
 * @see arco-override.css for custom styles (.winkgo-steps)
 */
const WinkGoSteps: React.FC<WinkGoStepsProps> & { Step: typeof Steps.Step } = ({ className, ...props }) => {
  return <Steps {...props} className={classNames('winkgo-steps', className)} />;
};

WinkGoSteps.displayName = 'WinkGoSteps';

// 导出子组件 / Export sub-component
WinkGoSteps.Step = Steps.Step;

export default WinkGoSteps;
