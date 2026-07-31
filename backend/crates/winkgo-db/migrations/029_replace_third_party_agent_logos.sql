-- Replace bundled third-party brand graphics with the original neutral service
-- icon. The internal WINK GO agent keeps its owned brand asset.
UPDATE agent_metadata
SET icon = '/api/assets/logos/generic/service.svg',
    updated_at = unixepoch('now', 'subsec') * 1000
WHERE agent_source = 'builtin'
  AND (icon IS NULL OR icon <> '/api/assets/logos/generic/service.svg');
