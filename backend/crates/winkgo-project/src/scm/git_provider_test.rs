// Modified from AionCore by WINK GO contributors in 2026.
//! Focused integration tests for the in-process git provider.

use tempfile::TempDir;

use super::*;

fn init_repo(dir: &Path) -> Repository {
    let repo = Repository::init(dir).expect("init repository");
    let mut config = repo.config().expect("repository config");
    config.set_str("user.name", "WINK GO SCM test").expect("set name");
    config.set_str("user.email", "scm@winkgo.test").expect("set email");
    repo
}

fn write(dir: &Path, relative: &str, body: &str) {
    let path = dir.join(relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent");
    }
    std::fs::write(path, body).expect("write fixture");
}

fn commit_all(repo: &Repository, message: &str) {
    let mut index = repo.index().expect("index");
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .expect("stage all");
    index.write().expect("write index");
    let tree_id = index.write_tree().expect("write tree");
    let tree = repo.find_tree(tree_id).expect("find tree");
    let signature = repo.signature().expect("signature");
    let parents = repo
        .head()
        .ok()
        .and_then(|head| head.peel_to_commit().ok())
        .into_iter()
        .collect::<Vec<_>>();
    let parent_refs = parents.iter().collect::<Vec<_>>();
    repo.commit(Some("HEAD"), &signature, &signature, message, &tree, &parent_refs)
        .expect("commit");
}

fn root(dir: &Path) -> ResolvedRoot {
    ResolvedRoot {
        pe_id: "pe-winkgo".to_owned(),
        absolute_path: dir.to_string_lossy().into_owned(),
        label: "WINK GO fixture".to_owned(),
        pe_name: None,
    }
}

async fn discovered(dir: &Path) -> (GitScmProvider, RepoRef) {
    let provider = GitScmProvider::new();
    let repository = provider
        .discover(&root(dir))
        .await
        .expect("discover succeeds")
        .expect("repository found");
    (
        provider,
        RepoRef {
            repo_id: repository.repo_id,
        },
    )
}

#[tokio::test]
async fn plain_directory_is_not_reported_as_repository() {
    let temp = TempDir::new().expect("temp directory");
    assert!(
        GitScmProvider::new()
            .discover(&root(temp.path()))
            .await
            .expect("discover")
            .is_none()
    );
}

#[tokio::test]
async fn repository_identity_and_capabilities_are_reported() {
    let temp = TempDir::new().expect("temp directory");
    let repo = init_repo(temp.path());
    write(temp.path(), "README.md", "WINK GO\n");
    commit_all(&repo, "initial");

    let found = GitScmProvider::new()
        .discover(&root(temp.path()))
        .await
        .expect("discover")
        .expect("repository");
    assert_eq!(found.provider_id, "git");
    assert_eq!(found.root.pe_id, "pe-winkgo");
    assert!(found.repo_id.starts_with("scm:"));
    assert!(found.capabilities.staging);
    assert!(!found.capabilities.remote_ops);
}

#[tokio::test]
async fn status_lists_nested_untracked_file() {
    let temp = TempDir::new().expect("temp directory");
    let repo = init_repo(temp.path());
    write(temp.path(), "README.md", "WINK GO\n");
    commit_all(&repo, "initial");
    write(temp.path(), "notes/todo.txt", "ship SCM\n");

    let (provider, repo_ref) = discovered(temp.path()).await;
    let status = provider.status(&repo_ref).await.expect("status");
    let resource = status
        .resources
        .iter()
        .find(|resource| resource.repo_relative_path == "notes/todo.txt")
        .expect("untracked resource");
    assert_eq!(resource.state, ScmResourceState::Created);
    assert_eq!(resource.staged, Some(false));
}

#[tokio::test]
async fn stage_and_unstage_round_trip_updates_status_side() {
    let temp = TempDir::new().expect("temp directory");
    let repo = init_repo(temp.path());
    write(temp.path(), "README.md", "before\n");
    commit_all(&repo, "initial");
    write(temp.path(), "README.md", "after\n");

    let (provider, repo_ref) = discovered(temp.path()).await;
    let file = FileRef {
        pe_id: "pe-winkgo".to_owned(),
        relative_path: "README.md".to_owned(),
    };
    let staging = provider.staging().expect("staging capability");
    staging
        .stage(&repo_ref, std::slice::from_ref(&file))
        .await
        .expect("stage");
    assert!(
        provider
            .status(&repo_ref)
            .await
            .expect("staged status")
            .resources
            .iter()
            .any(|resource| resource.repo_relative_path == "README.md" && resource.staged == Some(true))
    );

    staging.unstage(&repo_ref, &[file]).await.expect("unstage");
    assert!(
        provider
            .status(&repo_ref)
            .await
            .expect("unstaged status")
            .resources
            .iter()
            .any(|resource| resource.repo_relative_path == "README.md" && resource.staged == Some(false))
    );
}
