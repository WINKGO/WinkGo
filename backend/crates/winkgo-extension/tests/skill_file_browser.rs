// Modified from AionCore by WINK GO contributors in 2026.

use std::path::PathBuf;

use tempfile::TempDir;
use winkgo_extension::error::ExtensionError;
use winkgo_extension::skill_service::{list_skill_files_at_location, read_skill_file_at_location};

async fn fixture() -> (TempDir, PathBuf) {
    let sandbox = tempfile::tempdir().unwrap();
    let root = sandbox.path().join("demo");
    tokio::fs::create_dir_all(root.join("scripts")).await.unwrap();
    tokio::fs::write(root.join("SKILL.md"), "# Demo").await.unwrap();
    tokio::fs::write(root.join("notes.md"), "Notes").await.unwrap();
    tokio::fs::write(root.join("scripts").join("run.js"), "run();")
        .await
        .unwrap();
    (sandbox, root)
}

#[tokio::test]
async fn lists_manifest_first_and_nested_files_relative_to_root() {
    let (_sandbox, root) = fixture().await;

    let nodes = list_skill_files_at_location(&root.join("SKILL.md")).await.unwrap();

    assert_eq!(nodes.first().map(|node| node.relative_path.as_str()), Some("SKILL.md"));
    let scripts = nodes.iter().find(|node| node.name == "scripts").unwrap();
    assert_eq!(scripts.children[0].relative_path, "scripts/run.js");
}

#[tokio::test]
async fn reads_utf8_files_from_a_manifest_location() {
    let (_sandbox, root) = fixture().await;

    let content = read_skill_file_at_location(&root.join("SKILL.md"), "notes.md")
        .await
        .unwrap();

    assert_eq!(content, "Notes");
}

#[tokio::test]
async fn rejects_paths_that_escape_the_skill_root() {
    let (_sandbox, root) = fixture().await;

    let error = read_skill_file_at_location(&root, "../outside.txt").await.unwrap_err();

    assert!(matches!(error, ExtensionError::PathTraversal(_)));
}
