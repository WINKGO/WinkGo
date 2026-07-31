-- Restore the original per-agent icon catalog. Migration 029 is retained for
-- databases that already recorded it; this migration corrects its data.
UPDATE agent_metadata
SET icon = CASE lower(COALESCE(backend, agent_type))
    WHEN 'claude' THEN '/api/assets/logos/ai-major/claude.svg'
    WHEN 'codex' THEN '/api/assets/logos/tools/coding/codex.svg'
    WHEN 'gemini' THEN '/api/assets/logos/ai-major/gemini.svg'
    WHEN 'qwen' THEN '/api/assets/logos/ai-china/qwen.svg'
    WHEN 'codebuddy' THEN '/api/assets/logos/tools/coding/codebuddy.svg'
    WHEN 'droid' THEN '/api/assets/logos/brand/droid.svg'
    WHEN 'goose' THEN '/api/assets/logos/tools/goose.svg'
    WHEN 'auggie' THEN '/api/assets/logos/brand/auggie.svg'
    WHEN 'kimi' THEN '/api/assets/logos/ai-china/kimi.svg'
    WHEN 'opencode' THEN '/api/assets/logos/tools/coding/opencode-light.svg'
    WHEN 'copilot' THEN '/api/assets/logos/tools/github.svg'
    WHEN 'qoder' THEN '/api/assets/logos/tools/coding/qoder.png'
    WHEN 'vibe' THEN '/api/assets/logos/ai-major/mistral.svg'
    WHEN 'cursor' THEN '/api/assets/logos/tools/coding/cursor.png'
    WHEN 'kiro' THEN NULL
    WHEN 'hermes' THEN '/api/assets/logos/brand/hermes.svg'
    WHEN 'snow' THEN '/api/assets/logos/tools/coding/snow.png'
    WHEN 'nanobot' THEN '/api/assets/logos/tools/nanobot.svg'
    WHEN 'openclaw-gateway' THEN '/api/assets/logos/tools/openclaw.svg'
    WHEN 'openclaw' THEN '/api/assets/logos/tools/openclaw.svg'
    WHEN 'pi' THEN '/api/assets/logos/tools/pi.svg'
    WHEN 'autohand' THEN '/api/assets/logos/acp-registry/autohand.svg'
    WHEN 'deepagents' THEN '/api/assets/logos/acp-registry/deepagents.svg'
    WHEN 'dimcode' THEN '/api/assets/logos/acp-registry/dimcode.svg'
    WHEN 'dirac' THEN '/api/assets/logos/acp-registry/dirac.svg'
    WHEN 'glm-acp-agent' THEN '/api/assets/logos/acp-registry/glm-acp-agent.svg'
    WHEN 'grok' THEN '/api/assets/logos/acp-registry/grok.svg'
    WHEN 'kilo' THEN '/api/assets/logos/acp-registry/kilo.svg'
    WHEN 'nova' THEN '/api/assets/logos/acp-registry/nova.svg'
    WHEN 'sigit' THEN '/api/assets/logos/acp-registry/sigit.svg'
    WHEN 'amp-acp' THEN '/api/assets/logos/acp-registry/amp-acp.svg'
    WHEN 'cortex-code' THEN '/api/assets/logos/acp-registry/cortex-code.svg'
    WHEN 'corust-agent' THEN '/api/assets/logos/acp-registry/corust-agent.svg'
    WHEN 'devin' THEN '/api/assets/logos/acp-registry/devin.svg'
    WHEN 'harn' THEN '/api/assets/logos/acp-registry/harn.svg'
    WHEN 'junie' THEN '/api/assets/logos/acp-registry/junie.svg'
    WHEN 'poolside' THEN '/api/assets/logos/acp-registry/poolside.svg'
    WHEN 'stakpak' THEN '/api/assets/logos/acp-registry/stakpak.svg'
    WHEN 'vtcode' THEN '/api/assets/logos/acp-registry/vtcode.svg'
    ELSE icon
END,
updated_at = unixepoch('now', 'subsec') * 1000
WHERE agent_source = 'builtin'
  AND lower(COALESCE(backend, agent_type)) IN (
    'claude', 'codex', 'gemini', 'qwen', 'codebuddy', 'droid', 'goose',
    'auggie', 'kimi', 'opencode', 'copilot', 'qoder', 'vibe', 'cursor',
    'kiro', 'hermes', 'snow', 'nanobot', 'openclaw-gateway', 'openclaw', 'pi',
    'autohand', 'deepagents', 'dimcode', 'dirac', 'glm-acp-agent', 'grok',
    'kilo', 'nova', 'sigit', 'amp-acp', 'cortex-code', 'corust-agent',
    'devin', 'harn', 'junie', 'poolside', 'stakpak', 'vtcode'
  );
