// Modified from AionCore by WINK GO contributors in 2026.
use super::*;

fn file_uri(path: &str) -> String {
    if cfg!(windows) {
        format!("file:///C:{path}")
    } else {
        format!("file://{path}")
    }
}

fn fs_test_path(path: &str) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(format!(r"C:{}", path.replace('/', r"\")))
    } else {
        PathBuf::from(path)
    }
}

#[test]
fn drops_trailing_slash() {
    assert_eq!(
        canonicalize(&file_uri("/a/b/")).unwrap(),
        canonicalize(&file_uri("/a/b")).unwrap()
    );
}

#[test]
fn resolves_dot_dot_lexically() {
    assert_eq!(
        canonicalize(&file_uri("/a/b/../c")).unwrap(),
        canonicalize(&file_uri("/a/c")).unwrap()
    );
}

#[test]
fn resolves_single_dot() {
    assert_eq!(
        canonicalize(&file_uri("/a/./b")).unwrap(),
        canonicalize(&file_uri("/a/b")).unwrap()
    );
}

#[test]
fn collapses_repeated_separators() {
    assert_eq!(
        canonicalize(&file_uri("/a//b")).unwrap(),
        canonicalize(&file_uri("/a/b")).unwrap()
    );
}

#[test]
fn dot_dot_above_root_is_clamped_not_errored() {
    // Lexical clamp to root; containment (not canonicalize) rejects escapes.
    assert_eq!(
        canonicalize(&file_uri("/../../a")).unwrap(),
        canonicalize(&file_uri("/a")).unwrap()
    );
}

#[test]
fn is_deterministic() {
    let a = canonicalize(&file_uri("/Users/me/proj")).unwrap();
    let b = canonicalize(&file_uri("/Users/me/proj")).unwrap();
    assert_eq!(a, b);
}

#[test]
fn casing_folds_per_platform() {
    let mixed = canonicalize(&file_uri("/Users/Me/WinkGo")).unwrap();
    let lower = canonicalize(&file_uri("/users/me/winkgo")).unwrap();
    if IGNORE_PATH_CASING {
        // macOS / Windows: same folder.
        assert_eq!(mixed, lower);
    } else {
        // Linux: two distinct folders.
        assert_ne!(mixed, lower);
    }
}

#[test]
fn symlink_dir_is_not_its_target_lexically() {
    // Pure lexical identity: two distinct path strings are two distinct
    // folders regardless of any on-disk symlink relationship.
    let link = canonicalize(&file_uri("/a/link")).unwrap();
    let target = canonicalize(&file_uri("/a/target")).unwrap();
    assert_ne!(link, target);
}

#[test]
fn unsupported_scheme_is_rejected() {
    let err = canonicalize("ssh://host/home/me/project").unwrap_err();
    assert_eq!(err.code(), "unsupported_resource_scheme");
}

#[test]
fn parse_scheme_accepts_file_rejects_others() {
    assert_eq!(parse_scheme(&file_uri("/a")).unwrap(), Scheme::File);
    assert_eq!(
        parse_scheme("ssh://h/p").unwrap_err().code(),
        "unsupported_resource_scheme"
    );
}

#[test]
fn basename_is_final_segment() {
    let c = canonicalize(&file_uri("/Users/me/winkgo")).unwrap();
    assert_eq!(basename(&c), "winkgo");
}

#[test]
fn fs_path_roundtrips_canonical() {
    let c = canonicalize(&file_uri("/Users/me/winkgo")).unwrap();
    let p = fs_path(&c).unwrap();
    // Re-deriving the file uri from the path reproduces the canonical string.
    assert_eq!(to_file_uri(&p).unwrap(), c.as_str());
}

#[test]
fn to_file_uri_does_not_fold_casing() {
    // to_file_uri is raw capture, not identity: casing is preserved.
    let uri = to_file_uri(&fs_test_path("/Users/Me/WinkGo")).unwrap();
    assert_eq!(uri, file_uri("/Users/Me/WinkGo"));
}
