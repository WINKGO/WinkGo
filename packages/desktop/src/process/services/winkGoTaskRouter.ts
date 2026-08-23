/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export type WinkGoTaskSurface = 'browser' | 'browser_visual' | 'office' | 'desktop' | 'general';
export type WinkGoTaskVerification = 'browser_snapshot' | 'file_render' | 'desktop_screenshot' | 'agent_result';

export type WinkGoTaskRoute = {
  primary: WinkGoTaskSurface;
  stages: WinkGoTaskSurface[];
  verification: WinkGoTaskVerification[];
  sensitive: boolean;
  reason: string;
  key: string;
};

const normalize = (value: string): string => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const has = (value: string, pattern: RegExp): boolean => pattern.test(value);

const BROWSER =
  /https?:\/\/|网页|网站|页面|浏览器|在线|搜索网页|携程|飞猪|腾讯云|阿里云|淘宝|京东|知乎|b站|哔哩|browser|website|web page|online/i;
const BROWSER_VISUAL =
  /canvas|webgl|网页游戏|小游戏|黄金矿工|死神vs火影|地图|图表|远程桌面|像素|画布|game|chart|map|pixel|remote desktop/i;
const OFFICE =
  /\.docx?\b|\.xlsx?\b|\.pptx?\b|\.pdf\b|word文档|excel表格|ppt|powerpoint|演示文稿|幻灯片|电子表格|工作簿|办公文档|财务模型|报告文档|officecli/i;
const EXPLICIT_NATIVE_UI =
  /打开(?:word|excel|powerpoint|wps)软件|在(?:word|excel|powerpoint|wps)界面|点击.*(?:菜单|按钮|窗口)|真实(?:word|excel|powerpoint|wps)|使用桌面.*(?:word|excel|powerpoint|wps)/i;
const DESKTOP =
  /桌面软件|本地软件|windows\s*设置|系统设置|控制面板|任务管理器|窗口|鼠标|键盘|记事本|资源管理器|微信客户端|qq客户端|native app|desktop app|windows app/i;
const SENSITIVE =
  /支付|付款|购买|下单|发送|发布|删除|注销|上传|密码|验证码|授权|登录|pay|purchase|checkout|send|publish|delete|upload|password|otp|captcha|login/i;

const unique = <T>(items: T[]): T[] => [...new Set(items)];

const verificationFor = (surface: WinkGoTaskSurface): WinkGoTaskVerification => {
  if (surface === 'browser' || surface === 'browser_visual') return 'browser_snapshot';
  if (surface === 'office') return 'file_render';
  if (surface === 'desktop') return 'desktop_screenshot';
  return 'agent_result';
};

export const routeWinkGoTask = (input: string): WinkGoTaskRoute => {
  const command = normalize(input);
  const browser = has(command, BROWSER);
  const visualBrowser = browser && has(command, BROWSER_VISUAL);
  const office = has(command, OFFICE);
  const explicitNativeUi = has(command, EXPLICIT_NATIVE_UI);
  const desktop = explicitNativeUi || has(command, DESKTOP);

  let stages: WinkGoTaskSurface[];
  let reason: string;
  if (browser && office) {
    stages = [visualBrowser ? 'browser_visual' : 'browser', explicitNativeUi ? 'desktop' : 'office'];
    reason = '任务同时包含网页流程和 Office 文件处理，先完成网页阶段，再处理下载或生成的文件。';
  } else if (visualBrowser) {
    stages = ['browser_visual'];
    reason = '网页包含 Canvas、WebGL 或其他像素内容，需要浏览器截图和视觉坐标。';
  } else if (browser) {
    stages = ['browser'];
    reason = '任务目标是网站或在线流程，应留在 WINK GO 内置浏览器。';
  } else if (office && !explicitNativeUi) {
    stages = ['office'];
    reason = '任务目标是 Office/PDF 文件内容，应优先使用结构化文件工具和渲染验证。';
  } else if (desktop) {
    stages = ['desktop'];
    reason = '任务明确依赖可见 Windows 应用界面。';
  } else {
    stages = ['general'];
    reason = '未检测到必须使用网页、Office 文件或桌面 GUI 的目标。';
  }

  const normalizedStages = unique(stages);
  return {
    primary: normalizedStages[0],
    stages: normalizedStages,
    verification: normalizedStages.map(verificationFor),
    sensitive: has(command, SENSITIVE),
    reason,
    key: normalizedStages.join('+'),
  };
};

export const buildWinkGoTaskRouteContext = (route: WinkGoTaskRoute): string => {
  const stageRules = route.stages.map((surface, index) => {
    const prefix = `阶段 ${index + 1}`;
    if (surface === 'browser') {
      return `${prefix}：先用 inspect_browser_page 读取 WINK GO 内置浏览器，再用 browser_action 按当前 DOM ref 逐步操作；每次页面变化后重新读取并验证。`;
    }
    if (surface === 'browser_visual') {
      return `${prefix}：使用 run_browser_task；Canvas/WebGL/游戏/地图/图表必须读取当前浏览器截图并使用受边界约束的视觉坐标，动作后重新截图验证。`;
    }
    if (surface === 'office') {
      return `${prefix}：使用 officecli 结构化读取或修改 DOCX/XLSX/PPTX/PDF；完成后 validate，并通过截图/HTML/页面渲染验证文件，不要用桌面鼠标代替文件工具。`;
    }
    if (surface === 'desktop') {
      return `${prefix}：使用 run_desktop_task 操作真实 Windows 应用；保持目标窗口可见，并以新截图而不是工具返回文案验证。`;
    }
    return `${prefix}：使用现有 WINK GO 技能、文件和 MCP 工具完成，并给出可检查的结果证据。`;
  });
  return [
    'WINK GO 已根据用户目标选择执行表面。必须按以下阶段顺序执行，不得改用系统默认浏览器或盲目 shell 操作代替可验证工具。',
    `路由：${route.stages.join(' -> ')}。${route.reason}`,
    ...stageRules,
    route.sensitive
      ? '任务包含账号、发送、删除、上传、支付或凭据相关词语；在产生外部副作用前必须停下并获取用户对该具体动作的确认。'
      : '任务未命中高风险词，但仍需遵守每个工具自身的确认与权限策略。',
    '完成标准：只有相应页面快照、文件渲染/校验、桌面新截图或结构化结果明确证明目标已完成时，才能报告成功。',
  ].join('\n');
};
