// Modified from AionCore by WINK GO contributors in 2026.
use winkgo_db::{IAgentMetadataRepository, SqliteAgentMetadataRepository, init_database_memory};

#[tokio::test]
async fn antigravity_builtin_agent_uses_the_direct_agy_backend() {
    let db = init_database_memory().await.unwrap();
    let repo = SqliteAgentMetadataRepository::new(db.pool().clone());

    let row = repo
        .find_builtin_by_backend("antigravity")
        .await
        .unwrap()
        .expect("antigravity builtin row");

    assert_eq!(row.agent_type, "antigravity");
    assert_eq!(row.command.as_deref(), Some("agy"));
    assert_eq!(row.args.as_deref(), Some("[]"));
    assert_eq!(row.icon.as_deref(), Some("/api/assets/logos/ai-major/antigravity.svg"));
    assert_eq!(row.yolo_id.as_deref(), Some("yolo"));
    assert_eq!(row.native_skills_dirs.as_deref(), Some(r#"[".agents/skills"]"#));

    let source: serde_json::Value = serde_json::from_str(row.agent_source_info.as_deref().unwrap()).unwrap();
    assert_eq!(source["binary_name"], "agy");

    let modes: serde_json::Value = serde_json::from_str(row.available_modes.as_deref().unwrap()).unwrap();
    assert_eq!(modes["current_mode_id"], "default");
    assert!(
        modes["available_modes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|mode| mode["id"] == "yolo")
    );
}
