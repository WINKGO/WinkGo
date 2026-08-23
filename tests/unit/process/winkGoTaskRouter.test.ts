/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildWinkGoTaskRouteContext, routeWinkGoTask } from '@process/services/winkGoTaskRouter';

describe('WINK GO unified task router', () => {
  it.each([
    ['使用 WINK GO 内置浏览器打开携程查询机票', 'browser'],
    ['打开网页黄金矿工，帮我点击 canvas 里的开始按钮', 'browser_visual'],
    ['修改桌面的季度报告.docx 并检查排版', 'office'],
    ['打开 Word 软件，点击审阅菜单', 'desktop'],
    ['在 Windows 设置里关闭一个系统选项', 'desktop'],
    ['总结一下今天的任务', 'general'],
  ] as const)('routes %s to %s', (command, expected) => {
    expect(routeWinkGoTask(command).primary).toBe(expected);
  });

  it('routes a web download followed by spreadsheet editing as an ordered compound workflow', () => {
    const route = routeWinkGoTask('从腾讯云网页下载 usage.xlsx，然后修改 Excel 表格并验证公式');

    expect(route.stages).toEqual(['browser', 'office']);
    expect(route.verification).toEqual(['browser_snapshot', 'file_render']);
    expect(route.key).toBe('browser+office');
  });

  it('keeps account and external-side-effect tasks marked sensitive', () => {
    const route = routeWinkGoTask('登录网站并提交订单付款');
    expect(route.primary).toBe('browser');
    expect(route.sensitive).toBe(true);
  });

  it('builds executable route instructions with evidence requirements', () => {
    const context = buildWinkGoTaskRouteContext(routeWinkGoTask('制作并校验财务模型.xlsx'));

    expect(context).toContain('officecli');
    expect(context).toContain('validate');
    expect(context).toContain('文件渲染/校验');
    expect(context).not.toContain('run_desktop_task 操作真实 Windows 应用');
  });

  it('keeps ordinary DOM work in the current Agent loop and reserves the nested visual planner for pixel pages', () => {
    const domContext = buildWinkGoTaskRouteContext(routeWinkGoTask('打开网页填写项目名称并保存'));
    const visualContext = buildWinkGoTaskRouteContext(routeWinkGoTask('打开网页并点击 canvas 里的蓝色按钮'));

    expect(domContext).toContain('inspect_browser_page');
    expect(domContext).toContain('browser_action');
    expect(domContext).not.toContain('使用 run_browser_task 在 WINK GO 内置浏览器完成');
    expect(visualContext).toContain('run_browser_task');
  });
});
