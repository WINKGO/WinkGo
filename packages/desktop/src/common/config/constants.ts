// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WinkGo应用程序共用常量
 */

// ===== 应用内浏览器 / In-app browser =====

/** 所有浏览器标签共享且跨重启保留的安全会话分区。 */
export const BROWSER_SESSION_PARTITION = 'persist:winkgo-browser';

/** 内置浏览器 MCP 的稳定注册名；主进程与渲染进程必须保持一致。 */
export const BUILTIN_BROWSER_MCP_NAME = 'winkgo-browser';

/** 录制型浏览器技能的本机确定性调用服务。 */
export const BUILTIN_BROWSER_SKILLS_MCP_NAME = 'winkgo-browser-skills';

/** 独立的 Windows 桌面 Computer Use MCP；不得与应用内浏览器工具混用。 */
export const BUILTIN_DESKTOP_COMPUTER_USE_MCP_NAME = 'winkgo-desktop-computer-use';

// ===== 文件处理相关常量 =====

/** 临时文件时间戳分隔符 */
export const WINKGO_TIMESTAMP_SEPARATOR = '_winkgo_';

/** 用于匹配和清理时间戳后缀的正则表达式 */
export const WINKGO_TIMESTAMP_REGEX = /_winkgo_\d{13}(\.\w+)?$/;
export const WINKGO_FILES_MARKER = '[[WINKGO_FILES]]';

// ===== 媒体类型相关常量 =====

/** 支持的图片文件扩展名 */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'] as const;

/** 文件扩展名到MIME类型的映射 */
export const MIME_TYPE_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
};

/** MIME类型到文件扩展名的映射 */
export const MIME_TO_EXT_MAP: Record<string, string> = {
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  gif: '.gif',
  webp: '.webp',
  bmp: '.bmp',
  tiff: '.tiff',
  'svg+xml': '.svg',
};

/** 默认图片文件扩展名 */
export const DEFAULT_IMAGE_EXTENSION = '.png';

// ===== WebUI 相关常量 =====

/** WebUI default port: 25808 for production, 25809 for development, 25810 for multi-instance dev */
export const WEBUI_DEFAULT_PORT = (() => {
  if (process.env.NODE_ENV === 'production') return 25808;
  if (process.env.WINKGO_MULTI_INSTANCE === '1') return 25810;
  return 25809;
})();

export const TEAM_MODE_ENABLED = true;

// ===== AI Provider 相关常量 =====

// Stable ID for the Google Auth virtual provider.
// Shared between frontend (useModelProviderList) and backend (SystemActions).
export const GOOGLE_AUTH_PROVIDER_ID = 'google-auth-gemini';
