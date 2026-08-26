import type { IProvider } from '@/common/config/storage';
import type { ComputerUseModelRef } from '@/common/types/computerUse';
import { hasSpecificModelCapability } from '@/common/utils/modelCapabilities';

const NON_CHAT_MODEL = /(?:auto-review|review|rerank|embedding|moderation|gpt-image|image-generation|tts|transcri)/i;
const WINK_GO_VISUAL_MODEL = /^gpt-5\.6-(?:terra|sol|luna)(?:$|[-:])/i;

export const getComputerUseModelCandidates = (provider: IProvider): string[] => {
  const enabled = (provider.models || []).filter((model) => provider.model_enabled?.[model] !== false);
  const healthy = enabled.filter((model) => provider.model_health?.[model]?.status !== 'unhealthy');
  return healthy.length ? healthy : enabled;
};

const visualModelRank = (provider: IProvider, model: string): number | null => {
  if (NON_CHAT_MODEL.test(model)) return null;
  const imageInput = provider.model_settings?.[model]?.image_input;
  if (imageInput === 'unsupported') return null;
  if (imageInput === 'supported') return 0;
  if (WINK_GO_VISUAL_MODEL.test(model)) return 1;
  if (hasSpecificModelCapability(provider, model, 'vision') === true) return 1;
  const providerVision = provider.capabilities?.find((capability) => capability.type === 'vision')?.isUserSelected;
  if (providerVision === false) return null;
  if (providerVision === true) return 2;
  return 3;
};

/** Chooses a screenshot-capable configured model and never uses review/image/text-only utilities. */
export const selectDefaultWinkGoComputerUseModel = (providers: IProvider[]): ComputerUseModelRef | null => {
  const ranked: Array<{ providerId: string; model: string; rank: number; order: number }> = [];
  let order = 0;
  for (const provider of providers) {
    if (provider.enabled === false || !provider.api_key?.trim()) continue;
    for (const model of getComputerUseModelCandidates(provider)) {
      const rank = visualModelRank(provider, model);
      if (rank !== null) ranked.push({ providerId: provider.id, model, rank, order });
      order += 1;
    }
  }
  ranked.sort((left, right) => left.rank - right.rank || left.order - right.order);
  const selected = ranked[0];
  return selected ? { providerId: selected.providerId, model: selected.model } : null;
};
