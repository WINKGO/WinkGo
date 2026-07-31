// Modified from AionCore by WINK GO contributors in 2026.
use winkgo_db::{IAgentMetadataRepository, SqliteAgentMetadataRepository, init_database_memory};

#[tokio::test]
async fn verified_registry_binary_agents_store_stable_registry_identity() {
    let db = init_database_memory().await.unwrap();
    let repo = SqliteAgentMetadataRepository::new(db.pool().clone());
    let cases = [
        ("amp-acp", "amp-acp", r#"[]"#, Some("bypass")),
        ("cortex-code", "cortex", r#"["acp","serve"]"#, Some("bypass")),
        ("corust-agent", "corust-agent-acp", r#"[]"#, None),
        ("devin", "devin", r#"["acp"]"#, Some("bypass")),
        ("harn", "harn", r#"["serve","acp"]"#, None),
        ("junie", "junie", r#"["--acp=true"]"#, None),
        ("poolside", "pool", r#"["acp"]"#, None),
        ("stakpak", "stakpak", r#"["acp"]"#, None),
        ("vtcode", "vtcode", r#"["acp"]"#, None),
    ];
    for (backend, command, args, yolo_id) in cases {
        let row = repo.find_builtin_by_backend(backend).await.unwrap().unwrap();
        assert_eq!(row.description, None, "{backend} builtin description");
        let expected_icon = format!("/api/assets/logos/acp-registry/{backend}.svg");
        assert_eq!(row.icon.as_deref(), Some(expected_icon.as_str()), "{backend} icon");
        assert_eq!(row.command.as_deref(), Some(command), "{backend} command");
        assert_eq!(row.args.as_deref(), Some(args), "{backend} args");
        assert_eq!(row.yolo_id.as_deref(), yolo_id);
        let source: serde_json::Value = serde_json::from_str(row.agent_source_info.as_deref().unwrap()).unwrap();
        assert!(source.get("registry_id").is_none());
        assert!(source.get("distribution").is_none());
        assert!(source.get("version").is_none());
        let policy: serde_json::Value = serde_json::from_str(row.behavior_policy.as_deref().unwrap()).unwrap();
        assert_eq!(policy["team_capable_override"], false);
    }
}

#[tokio::test]
async fn builtin_agents_keep_their_individual_logo_catalog() {
    let db = init_database_memory().await.unwrap();
    let repo = SqliteAgentMetadataRepository::new(db.pool().clone());
    let cases = [
        ("claude", Some("/api/assets/logos/ai-major/claude.svg")),
        ("codex", Some("/api/assets/logos/tools/coding/codex.svg")),
        ("gemini", Some("/api/assets/logos/ai-major/gemini.svg")),
        ("qwen", Some("/api/assets/logos/ai-china/qwen.svg")),
        ("codebuddy", Some("/api/assets/logos/tools/coding/codebuddy.svg")),
        ("droid", Some("/api/assets/logos/brand/droid.svg")),
        ("goose", Some("/api/assets/logos/tools/goose.svg")),
        ("auggie", Some("/api/assets/logos/brand/auggie.svg")),
        ("kimi", Some("/api/assets/logos/ai-china/kimi.svg")),
        ("opencode", Some("/api/assets/logos/tools/coding/opencode-light.svg")),
        ("copilot", Some("/api/assets/logos/tools/github.svg")),
        ("qoder", Some("/api/assets/logos/tools/coding/qoder.png")),
        ("vibe", Some("/api/assets/logos/ai-major/mistral.svg")),
        ("cursor", Some("/api/assets/logos/tools/coding/cursor.png")),
        ("kiro", None),
        ("hermes", Some("/api/assets/logos/brand/hermes.svg")),
        ("snow", Some("/api/assets/logos/tools/coding/snow.png")),
        ("openclaw", Some("/api/assets/logos/tools/openclaw.svg")),
        ("pi", Some("/api/assets/logos/tools/pi.svg")),
    ];

    for (backend, expected_icon) in cases {
        let row = repo.find_builtin_by_backend(backend).await.unwrap().unwrap();
        assert_eq!(row.icon.as_deref(), expected_icon, "{backend} icon");
        assert_ne!(
            row.icon.as_deref(),
            Some("/api/assets/logos/generic/service.svg"),
            "{backend} must not use the generic replacement icon"
        );
    }
}
