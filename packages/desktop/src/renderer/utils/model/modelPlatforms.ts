// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 模型平台配置模块
 * Model Platform Configuration Module
 *
 * 集中管理所有模型平台的配置信息，便于扩展和维护
 * Centralized management of all model platform configurations for extensibility and maintainability
 */

/**
 * 平台类型
 * Platform type
 */
export type PlatformType = 'gemini' | 'gemini-vertex-ai' | 'anthropic' | 'custom' | 'new-api' | 'bedrock';

/**
 * 模型平台配置接口
 * Model Platform Configuration Interface
 */
export interface PlatformConfig {
  /** 平台名称 / Platform name */
  name: string;
  /** 平台值（用于表单） / Platform value (for form) */
  value: string;
  /** Logo 路径 / Logo path */
  logo: string | null;
  /** 平台标识 / Platform identifier */
  platform: PlatformType;
  /** Base URL（预设供应商使用） / Base URL (for preset providers) */
  base_url?: string;
  /** 供应商官网（注册、购买额度或管理 API Key） / Provider website */
  website_url?: string;
  /** 国际化 key（可选，用于需要翻译的平台名称） / i18n key (optional, for platform names that need translation) */
  i18nKey?: string;
}

/**
 * 模型平台选项列表
 * Model Platform options list
 *
 * 顺序：
 * 1. WINK GO 中转站（默认，用户只需粘贴 API Key）
 * 2. 自定义（需要用户输入 base url）
 * 3. Moonshot/Kimi（战略合作，置顶展示）
 * 4. New API / Gemini 官方平台
 * 5+ 预设供应商
 */
export const MODEL_PLATFORMS: PlatformConfig[] = [
  // WINK GO 官方中转站：地址预设，安装包不包含任何 API Key。
  // WINK GO relay: endpoint preset only; no API key is bundled.
  {
    name: 'WINK GO',
    value: 'WINK-GO',
    logo: null,
    platform: 'custom',
    base_url: 'https://winkgo.xyz/v1',
    website_url: 'https://winkgo.xyz/',
    i18nKey: 'settings.platformWinkGo',
  },

  // 自定义选项（需要用户输入 base url）/ Custom option (requires user to input base url)
  { name: 'Custom', value: 'custom', logo: null, platform: 'custom', i18nKey: 'settings.platformCustom' },

  // Moonshot/Kimi 战略合作伙伴，紧随 Custom 置顶 / Strategic partner pinned right after Custom
  {
    name: 'Moonshot (China)',
    value: 'Moonshot',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.moonshot.cn/v1',
  },
  {
    name: 'Moonshot (Global)',
    value: 'Moonshot-Global',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.moonshot.ai/v1',
  },

  // New API 多模型网关 / New API multi-model gateway
  {
    name: 'New API',
    value: 'new-api',
    logo: null,
    platform: 'new-api',
    i18nKey: 'settings.platformNewApi',
  },

  // 官方 Gemini 平台
  {
    name: 'Gemini',
    value: 'gemini',
    logo: null,
    platform: 'gemini',
    base_url: 'https://generativelanguage.googleapis.com',
  },
  {
    name: 'Gemini (Vertex AI)',
    value: 'gemini-vertex-ai',
    logo: null,
    platform: 'gemini-vertex-ai',
  },

  // 预设供应商（按字母顺序排列）
  {
    name: 'OpenAI',
    value: 'OpenAI',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.openai.com/v1',
  },
  {
    name: 'Anthropic',
    value: 'Anthropic',
    logo: null,
    platform: 'anthropic',
    base_url: 'https://api.anthropic.com',
  },
  {
    name: 'AWS Bedrock',
    value: 'AWS-Bedrock',
    logo: null,
    platform: 'bedrock',
    i18nKey: 'settings.platformBedrock',
  },
  {
    name: 'DeepSeek',
    value: 'DeepSeek',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.deepseek.com/v1',
  },
  {
    name: 'MiniMax',
    value: 'MiniMax',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.minimaxi.com/v1',
  },
  {
    name: 'Novita',
    value: 'Novita',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.novita.ai/openai/v1',
  },
  {
    name: 'OpenRouter',
    value: 'OpenRouter',
    logo: null,
    platform: 'custom',
    base_url: 'https://openrouter.ai/api/v1',
  },
  {
    name: 'Dashscope',
    value: 'Dashscope',
    logo: null,
    platform: 'custom',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    name: 'Dashscope Coding Plan',
    value: 'Dashscope-Coding',
    logo: null,
    platform: 'custom',
    // Base URL intentionally left unset — users must supply their own coding-plan
    // endpoint, so the add-model form should not pre-fill a default.
    base_url: '',
  },
  {
    name: 'SiliconFlow-CN',
    value: 'SiliconFlow-CN',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.siliconflow.cn/v1',
  },
  {
    name: 'SiliconFlow',
    value: 'SiliconFlow',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.siliconflow.com/v1',
  },
  {
    name: 'Zhipu',
    value: 'Zhipu',
    logo: null,
    platform: 'custom',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
  },
  {
    name: 'xAI',
    value: 'xAI',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.x.ai/v1',
  },
  {
    name: 'Ark',
    value: 'Ark',
    logo: null,
    platform: 'custom',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  {
    name: 'Qianfan',
    value: 'Qianfan',
    logo: null,
    platform: 'custom',
    base_url: 'https://qianfan.baidubce.com/v2',
  },
  {
    name: 'Hunyuan',
    value: 'Hunyuan',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.hunyuan.cloud.tencent.com/v1',
  },
  {
    name: 'Lingyi',
    value: 'Lingyi',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.lingyiwanwu.com/v1',
  },
  {
    name: 'Poe',
    value: 'Poe',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.poe.com/v1',
  },
  {
    name: 'PPIO',
    value: 'PPIO',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.ppinfra.com/v3/openai',
  },
  {
    name: 'ModelScope',
    value: 'ModelScope',
    logo: null,
    platform: 'custom',
    base_url: 'https://api-inference.modelscope.cn/v1',
  },
  {
    name: 'InfiniAI',
    value: 'InfiniAI',
    logo: null,
    platform: 'custom',
    base_url: 'https://cloud.infini-ai.com/maas/v1',
  },
  {
    name: 'Ctyun',
    value: 'Ctyun',
    logo: null,
    platform: 'custom',
    base_url: 'https://wishub-x1.ctyun.cn/v1',
  },
  {
    name: 'StepFun',
    value: 'StepFun',
    logo: null,
    platform: 'custom',
    base_url: 'https://api.stepfun.com/v1',
  },
];

/**
 * New API 协议选项
 * New API protocol options for per-model protocol configuration
 */
export const NEW_API_PROTOCOL_OPTIONS = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'Anthropic', value: 'anthropic' },
];

/**
 * 根据模型名称自动推断 New API 协议类型
 * Auto-detect New API protocol type based on model name
 */
export const detectNewApiProtocol = (modelName: string): string => {
  const name = modelName.toLowerCase();
  if (name.startsWith('claude') || name.startsWith('anthropic')) return 'anthropic';
  if (name.startsWith('gemini') || name.startsWith('models/gemini')) return 'gemini';
  // Default to openai (covers gpt, deepseek, qwen, o1, o3, etc.)
  return 'openai';
};

/**
 * 添加模型弹窗的默认平台——始终跟随列表第一位
 * Default platform for the add-model modal — always the first list entry
 */
export const DEFAULT_PLATFORM_VALUE = MODEL_PLATFORMS[0].value;

// ============ 工具函数 / Utility Functions ============

/**
 * 根据 value 获取平台配置
 * Get platform config by value
 */
export const getPlatformByValue = (value: string): PlatformConfig | undefined => {
  return MODEL_PLATFORMS.find((p) => p.value === value);
};

/**
 * 获取所有预设供应商（有 base_url 的）
 * Get all preset providers (with base_url)
 */
export const getPresetProviders = (): PlatformConfig[] => {
  return MODEL_PLATFORMS.filter((p) => p.base_url);
};

export const getProviderLogo = (_provider: { name?: string; base_url?: string; platform?: string }): string | null =>
  null;

/**
 * 获取官方 Gemini 平台
 * Get official Gemini platforms
 */
export const getGeminiPlatforms = (): PlatformConfig[] => {
  return MODEL_PLATFORMS.filter((p) => p.platform === 'gemini' || p.platform === 'gemini-vertex-ai');
};

/**
 * 检查平台是否为 Gemini 类型
 * Check if platform is Gemini type
 */
export const isGeminiPlatform = (platform: PlatformType): boolean => {
  return platform === 'gemini' || platform === 'gemini-vertex-ai';
};

/**
 * 检查是否为自定义选项（无预设 base_url）
 * Check if it's custom option (no preset base_url)
 */
export const isCustomOption = (value: string): boolean => {
  const platform = getPlatformByValue(value);
  return value === 'custom' && !platform?.base_url;
};

// Re-export from common for renderer convenience
export { isNewApiPlatform } from '@/common/utils/platformConstants';

/**
 * 根据名称搜索平台（不区分大小写）
 * Search platforms by name (case-insensitive)
 */
export const searchPlatformsByName = (keyword: string): PlatformConfig[] => {
  const lowerKeyword = keyword.toLowerCase();
  return MODEL_PLATFORMS.filter((p) => p.name.toLowerCase().includes(lowerKeyword));
};
