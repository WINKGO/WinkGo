import { describe, expect, it } from 'vitest';
import { getModelDiscoveryBaseUrl } from '@/common/utils/modelDiscovery';

describe('model discovery URL normalization', () => {
  it('keeps an OpenAI-compatible base URL unchanged', () => {
    expect(getModelDiscoveryBaseUrl('https://winkgo.xyz/v1', 'custom')).toBe('https://winkgo.xyz/v1');
  });

  it.each([
    'https://winkgo.xyz/v1/chat/completions',
    'https://winkgo.xyz/v1/responses',
    'https://winkgo.xyz/v1/completions',
  ])('derives the OpenAI-compatible discovery base from %s', (endpoint) => {
    expect(getModelDiscoveryBaseUrl(endpoint, 'custom')).toBe('https://winkgo.xyz/v1');
  });

  it('derives the Anthropic discovery root from a messages endpoint', () => {
    expect(getModelDiscoveryBaseUrl('https://api.example.com/v1/messages', 'anthropic')).toBe(
      'https://api.example.com'
    );
  });
});
