use std::path::PathBuf;

use include_dir::Dir;
use winkgo_extension::builtin_skills_corpus;

fn collect_officecli_skill_dirs(dir: &Dir<'_>, result: &mut Vec<PathBuf>) {
    for file in dir.files() {
        let is_skill_file = file.path().file_name().and_then(|name| name.to_str()) == Some("SKILL.md");
        let mentions_officecli = std::str::from_utf8(file.contents())
            .map(|source| source.to_ascii_lowercase().contains("officecli"))
            .unwrap_or(false);

        if is_skill_file && mentions_officecli {
            result.push(file.path().parent().expect("SKILL.md parent").to_path_buf());
        }
    }

    for child in dir.dirs() {
        collect_officecli_skill_dirs(child, result);
    }
}

#[test]
fn embedded_moltbook_skill_retains_mit_notice_and_provenance() {
    let corpus = builtin_skills_corpus();
    let license = corpus
        .get_file("moltbook/LICENSE")
        .expect("embedded Moltbook MIT LICENSE");
    let source = corpus
        .get_file("moltbook/SOURCE.md")
        .expect("embedded Moltbook SOURCE.md");
    let license = std::str::from_utf8(license.contents()).expect("UTF-8 Moltbook LICENSE");
    let source = std::str::from_utf8(source.contents()).expect("UTF-8 Moltbook SOURCE.md");

    assert!(license.contains("MIT License"));
    assert!(license.contains("Copyright (c) moltbook"));
    assert!(source.contains("76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d"));
    assert!(source.contains("https://www.moltbook.com"));
}

#[test]
fn embedded_officecli_skills_retain_license_notice_and_source() {
    let corpus = builtin_skills_corpus();
    let mut officecli_skills = Vec::new();
    collect_officecli_skill_dirs(corpus, &mut officecli_skills);
    officecli_skills.sort();
    officecli_skills.dedup();

    assert!(!officecli_skills.is_empty(), "expected OfficeCLI-derived skills");
    assert!(
        officecli_skills
            .iter()
            .any(|path| path == &PathBuf::from("auto-inject/officecli")),
        "auto-inject/officecli must be included in the OfficeCLI compliance set"
    );
    for skill in officecli_skills {
        for legal_file in ["LICENSE", "NOTICE", "SOURCE.md"] {
            let path = skill.join(legal_file);
            assert!(
                corpus.get_file(&path).is_some(),
                "embedded OfficeCLI skill is missing {}",
                path.display()
            );
        }
    }
}

#[test]
fn embedded_skill_creator_retains_anthropic_license_and_provenance() {
    let corpus = builtin_skills_corpus();
    let license = corpus
        .get_file("auto-inject/skill-creator/LICENSE.txt")
        .expect("embedded Anthropic skill-creator LICENSE.txt");
    let source = corpus
        .get_file("auto-inject/skill-creator/SOURCE.md")
        .expect("embedded Anthropic skill-creator SOURCE.md");
    let modifications = corpus
        .get_file("auto-inject/skill-creator/MODIFICATIONS.md")
        .expect("embedded Anthropic skill-creator MODIFICATIONS.md");

    assert!(
        std::str::from_utf8(license.contents())
            .expect("UTF-8 license")
            .contains("Copyright 2026 Anthropic, PBC.")
    );
    assert!(
        std::str::from_utf8(source.contents())
            .expect("UTF-8 source record")
            .contains("b29e7cf65e5cb78a5ac33d582270551bc74a14eb")
    );
    assert!(!modifications.contents().is_empty());
}

#[test]
fn embedded_pdf_alias_and_toolkit_are_apache_licensed_and_legacy_files_are_absent() {
    let corpus = builtin_skills_corpus();

    assert!(
        corpus.get_dir("pdf").is_some(),
        "user-facing pdf compatibility skill must be embedded"
    );
    assert!(
        corpus.get_dir("pdf-toolkit").is_some(),
        "independently written pdf-toolkit skill must be embedded"
    );

    let alias_skill = corpus
        .get_file("pdf/SKILL.md")
        .expect("embedded pdf compatibility SKILL.md");
    let alias_license = corpus
        .get_file("pdf/LICENSE")
        .expect("embedded pdf compatibility LICENSE");
    let alias_source = corpus
        .get_file("pdf/SOURCE.md")
        .expect("embedded pdf compatibility SOURCE.md");
    let skill = corpus
        .get_file("pdf-toolkit/SKILL.md")
        .expect("embedded pdf-toolkit SKILL.md");
    let license = corpus
        .get_file("pdf-toolkit/LICENSE")
        .expect("embedded pdf-toolkit LICENSE");
    let source = corpus
        .get_file("pdf-toolkit/SOURCE.md")
        .expect("embedded pdf-toolkit SOURCE.md");
    let alias_skill = std::str::from_utf8(alias_skill.contents()).expect("UTF-8 pdf compatibility SKILL.md");
    let alias_license = std::str::from_utf8(alias_license.contents()).expect("UTF-8 pdf compatibility LICENSE");
    let alias_source = std::str::from_utf8(alias_source.contents()).expect("UTF-8 pdf compatibility SOURCE.md");
    let skill = std::str::from_utf8(skill.contents()).expect("UTF-8 pdf-toolkit SKILL.md");
    let license = std::str::from_utf8(license.contents()).expect("UTF-8 pdf-toolkit LICENSE");
    let source = std::str::from_utf8(source.contents()).expect("UTF-8 pdf-toolkit SOURCE.md");
    let normalized_skill = format!("{alias_skill}\n{skill}").to_ascii_lowercase();

    assert!(alias_skill.contains("name: pdf"));
    assert!(alias_skill.contains("compatibility entry"));
    assert!(alias_license.contains("Apache License"));
    assert!(alias_source.contains("No text, code, prompts, scripts, or assets"));
    assert!(skill.contains("name: pdf-toolkit"));
    assert!(skill.contains("Apache License 2.0"));
    assert!(skill.contains("SPDX-License-Identifier: Apache-2.0"));
    assert!(license.contains("Apache License"));
    assert!(license.contains("Version 2.0, January 2004"));
    assert!(source.contains("independently written"));
    assert!(source.contains("No text, code, prompts, scripts, or assets"));
    assert!(!normalized_skill.contains("anthropic"));
    assert!(!normalized_skill.contains("claude"));
}
