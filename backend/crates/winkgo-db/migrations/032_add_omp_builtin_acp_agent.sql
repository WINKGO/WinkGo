-- Adapted from AionCore migration 031
-- (commit 91f375db0ba355c011309484382f4d5ab90ccbb2).
-- omp (Oh My Pi) exposes ACP over stdio through
-- `npx -y @oh-my-pi/pi-coding-agent acp`. Package 17.1.8 was
-- initialize/session probed by upstream. ACP modes are default/plan, so no
-- yolo mode is advertised and team/side-question support stays conservative.
INSERT INTO agent_metadata
    (id, icon, name, backend, agent_type, agent_source, agent_source_info,
     enabled, command, args, env, native_skills_dirs, behavior_policy, yolo_id,
     sort_order, created_at, updated_at)
VALUES
    ('c9e8a2f4', '/api/assets/logos/acp-registry/omp.svg', 'omp',
     'omp', 'acp', 'builtin', '{"binary_name":"omp","bridge_binary":"npx"}',
     1, 'npx', '["-y","@oh-my-pi/pi-coding-agent","acp"]', '[]',
     '[".omp/skills",".claude/skills"]',
     '{"supports_side_question":false,"supports_team":false,"team_capable_override":false}',
     NULL, 3330,
     unixepoch('now','subsec')*1000, unixepoch('now','subsec')*1000)
ON CONFLICT(id) DO UPDATE SET
    icon=excluded.icon, name=excluded.name, description=NULL,
    backend=excluded.backend, agent_type=excluded.agent_type,
    agent_source=excluded.agent_source, agent_source_info=excluded.agent_source_info,
    enabled=excluded.enabled, command=excluded.command, args=excluded.args,
    env=excluded.env, native_skills_dirs=excluded.native_skills_dirs,
    behavior_policy=excluded.behavior_policy, yolo_id=excluded.yolo_id,
    sort_order=excluded.sort_order, updated_at=unixepoch('now','subsec')*1000;
