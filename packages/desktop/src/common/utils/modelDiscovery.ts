const OPENAI_INFERENCE_SUFFIXES = ['/chat/completions', '/responses', '/completions'] as const;

/**
 * Convert a provider inference endpoint into the base URL used for model discovery.
 * The provider itself may still keep the original full URL for inference requests.
 */
export function getModelDiscoveryBaseUrl(endpoint: string | undefined, platform: string): string | undefined {
  const trimmed = endpoint?.trim();
  if (!trimmed) return trimmed;

  try {
    const url = new URL(trimmed);
    let pathname = url.pathname.replace(/\/+$/, '');

    if ((platform === 'anthropic' || platform === 'claude') && pathname.endsWith('/v1/messages')) {
      pathname = pathname.slice(0, -'/v1/messages'.length);
    } else {
      const inferenceSuffix = OPENAI_INFERENCE_SUFFIXES.find((suffix) => pathname.endsWith(suffix));
      if (inferenceSuffix) pathname = pathname.slice(0, -inferenceSuffix.length);
    }

    url.pathname = pathname || '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
}
