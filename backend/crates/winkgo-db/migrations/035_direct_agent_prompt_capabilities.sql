-- Native prompt media capabilities for WINK GO's direct CLI agents.
--
-- ACP agents persist these fields from their initialize handshake. Claude and
-- Codex use the direct session backend instead, so their stable built-in rows
-- need an equivalent projection for the conversation detail UI.

UPDATE agent_metadata SET
    agent_capabilities = json_patch(
        COALESCE(agent_capabilities, '{}'),
        '{"prompt_capabilities":{"image":true,"audio":false}}'
    ),
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = '2d23ff1c';

UPDATE agent_metadata SET
    agent_capabilities = json_patch(
        COALESCE(agent_capabilities, '{}'),
        '{"prompt_capabilities":{"image":true,"audio":false}}'
    ),
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = '8e1acf31';
