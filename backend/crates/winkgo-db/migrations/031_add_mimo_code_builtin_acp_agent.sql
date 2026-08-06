-- Adapted from AionCore migration 029
-- (commit 3a2d7e48386fd608b752354f032657c442b13e1b).
-- MiMo Code provides a native ACP stdio entrypoint through
-- `npx -y @mimo-ai/cli acp`. Package 0.1.9 was initialize/session probed by
-- upstream; WINK GO retains conservative side-question/team capabilities.
INSERT INTO agent_metadata
    (id, icon, name, backend, agent_type, agent_source, agent_source_info,
     enabled, command, args, env, native_skills_dirs, behavior_policy, yolo_id,
     sort_order, created_at, updated_at)
VALUES
    ('8f21c6d3', '/api/assets/logos/acp-registry/mimo-code.svg', 'MiMo Code',
     'mimo-code', 'acp', 'builtin', '{"binary_name":"mimo","bridge_binary":"npx"}',
     1, 'npx', '["-y","@mimo-ai/cli","acp"]', '[]',
     '[".mimocode/skills",".opencode/skills"]',
     '{"supports_side_question":false,"supports_team":false,"team_capable_override":false}',
     'build', 3320,
     unixepoch('now','subsec')*1000, unixepoch('now','subsec')*1000)
ON CONFLICT(id) DO UPDATE SET
    icon=excluded.icon, name=excluded.name, description=NULL,
    backend=excluded.backend, agent_type=excluded.agent_type,
    agent_source=excluded.agent_source, agent_source_info=excluded.agent_source_info,
    enabled=excluded.enabled, command=excluded.command, args=excluded.args,
    env=excluded.env, native_skills_dirs=excluded.native_skills_dirs,
    behavior_policy=excluded.behavior_policy, yolo_id=excluded.yolo_id,
    sort_order=excluded.sort_order, updated_at=unixepoch('now','subsec')*1000;
