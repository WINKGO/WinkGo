// Modified from AionCore by WINK GO contributors in 2026.
//! Capability-aware attachment partitioning for native prompt media.

use std::path::Path;

use tracing::warn;
use winkgo_common::constants::WINKGO_FILES_MARKER;

use crate::types::PromptMediaCaps;

/// Conservative per-file ceiling for inline base64 prompt blocks.
pub const MAX_MEDIA_BLOCK_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    Image,
    Audio,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaAttachment {
    pub path: String,
    pub mime: String,
    pub kind: MediaKind,
}

#[derive(Debug)]
pub struct MediaPartition {
    pub content: String,
    pub path_files: Vec<String>,
    pub media: Vec<MediaAttachment>,
}

/// Split capable raster images/audio from normal path attachments. The
/// persisted message remains untouched; only the agent-bound prompt changes.
pub fn partition_media(content: &str, files: &[String], caps: PromptMediaCaps) -> MediaPartition {
    if files.is_empty() || caps == PromptMediaCaps::default() {
        return MediaPartition {
            content: content.to_owned(),
            path_files: files.to_vec(),
            media: Vec::new(),
        };
    }

    let mut path_files = Vec::new();
    let mut media = Vec::new();
    for path in files {
        match classify(path, caps) {
            Some(attachment) => media.push(attachment),
            None => path_files.push(path.clone()),
        }
    }

    let content = if media.is_empty() {
        content.to_owned()
    } else {
        append_files_marker(strip_files_marker(content, files), &path_files)
    };
    MediaPartition {
        content,
        path_files,
        media,
    }
}

fn classify(path: &str, caps: PromptMediaCaps) -> Option<MediaAttachment> {
    let mime = mime_guess::from_path(path).first()?;
    let kind = match mime.type_().as_str() {
        // SVG is text/source and is rejected by common vision APIs.
        "image" if caps.image && mime.subtype() != "svg" => MediaKind::Image,
        "audio" if caps.audio => MediaKind::Audio,
        _ => return None,
    };
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() && meta.len() <= MAX_MEDIA_BLOCK_BYTES => Some(MediaAttachment {
            path: path.to_owned(),
            mime: mime.essence_str().to_owned(),
            kind,
        }),
        Ok(meta) if meta.is_file() => {
            warn!(path, bytes = meta.len(), "media attachment too large; using file path");
            None
        }
        _ => {
            warn!(path, "media attachment unreadable; using file path");
            None
        }
    }
}

fn strip_files_marker<'a>(content: &'a str, files: &[String]) -> &'a str {
    let Some((user_text, metadata)) = content.rsplit_once(WINKGO_FILES_MARKER) else {
        return content;
    };
    let metadata_files = metadata.lines().map(str::trim).filter(|line| !line.is_empty());
    if metadata_files.eq(files.iter().map(String::as_str)) {
        user_text.strip_suffix("\n\n").unwrap_or(user_text)
    } else {
        content
    }
}

fn append_files_marker(content: &str, paths: &[String]) -> String {
    if paths.is_empty() {
        content.to_owned()
    } else {
        format!("{content}\n\n{WINKGO_FILES_MARKER}\n{}", paths.join("\n"))
    }
}

/// Preserve every attachment path in agent-bound text while still allowing
/// capable models to receive native image/audio blocks. Native blocks carry
/// bytes, not a reliable file-tool path, so removing the marker would prevent
/// the agent from opening or editing the same local file later in the turn.
pub fn content_with_all_paths(content: &str, files: &[String]) -> String {
    append_files_marker(strip_files_marker(content, files), files)
}

pub async fn read_media_bytes(attachment: &MediaAttachment) -> Option<Vec<u8>> {
    match tokio::fs::read(Path::new(&attachment.path)).await {
        Ok(bytes) if bytes.len() as u64 <= MAX_MEDIA_BLOCK_BYTES => Some(bytes),
        Ok(bytes) => {
            warn!(path = %attachment.path, bytes = bytes.len(), "media attachment grew too large; using file path");
            None
        }
        Err(error) => {
            warn!(path = %attachment.path, %error, "media attachment read failed; using file path");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IMAGE: PromptMediaCaps = PromptMediaCaps {
        image: true,
        audio: false,
    };
    const ALL: PromptMediaCaps = PromptMediaCaps {
        image: true,
        audio: true,
    };

    fn inline(content: &str, paths: &[&str]) -> String {
        format!("{content}\n\n{WINKGO_FILES_MARKER}\n{}", paths.join("\n"))
    }

    fn temp_file(name: &str, bytes: &[u8]) -> String {
        let dir = std::env::temp_dir().join("winkgo-media-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn no_caps_is_byte_identical() {
        let image = temp_file("none.png", b"png");
        let content = inline("hello", &[&image]);
        let result = partition_media(&content, std::slice::from_ref(&image), PromptMediaCaps::default());
        assert_eq!(result.content, content);
        assert_eq!(result.path_files, vec![image]);
        assert!(result.media.is_empty());
    }

    #[test]
    fn image_becomes_native_and_marker_is_removed() {
        let image = temp_file("native.png", b"png");
        let content = inline("look", &[&image]);
        let result = partition_media(&content, std::slice::from_ref(&image), IMAGE);
        assert_eq!(result.content, "look");
        assert!(result.path_files.is_empty());
        assert_eq!(result.media[0].kind, MediaKind::Image);
        assert_eq!(result.media[0].mime, "image/png");
    }

    #[test]
    fn mixed_files_keep_document_path() {
        let image = temp_file("mixed.jpg", b"jpg");
        let document = temp_file("mixed.pdf", b"pdf");
        let content = inline("mix", &[&image, &document]);
        let result = partition_media(&content, &[image.clone(), document.clone()], IMAGE);
        assert_eq!(result.content, inline("mix", &[&document]));
        assert_eq!(result.path_files, vec![document]);
        assert_eq!(result.media[0].path, image);
    }

    #[test]
    fn audio_requires_audio_capability() {
        let audio = temp_file("native.mp3", b"mp3");
        let content = inline("listen", &[&audio]);
        assert!(
            partition_media(&content, std::slice::from_ref(&audio), IMAGE)
                .media
                .is_empty()
        );
        let result = partition_media(&content, std::slice::from_ref(&audio), ALL);
        assert_eq!(result.media[0].kind, MediaKind::Audio);
        assert_eq!(result.media[0].mime, "audio/mpeg");
    }

    #[test]
    fn unsupported_or_invalid_media_remains_a_path() {
        let svg = temp_file("source.svg", b"<svg/>");
        let missing = std::env::temp_dir()
            .join("winkgo-media-tests")
            .join("missing.png")
            .to_string_lossy()
            .into_owned();
        let oversized = temp_file("large.png", &vec![0; (MAX_MEDIA_BLOCK_BYTES + 1) as usize]);
        let files = vec![svg, missing, oversized];
        let content = inline("fallback", &[&files[0], &files[1], &files[2]]);
        let result = partition_media(&content, &files, ALL);
        assert!(result.media.is_empty());
        assert_eq!(result.path_files, files);
        assert_eq!(result.content, content);
    }

    #[test]
    fn all_paths_form_keeps_native_media_paths() {
        let image = temp_file("keep-path.png", b"png");
        let document = temp_file("keep-path.pdf", b"pdf");
        let files = vec![image.clone(), document.clone()];
        let content = inline("inspect", &[&image, &document]);
        let partition = partition_media(&content, &files, IMAGE);
        assert_eq!(partition.content, inline("inspect", &[&document]));
        assert_eq!(content_with_all_paths(&content, &files), content);
        assert_eq!(content_with_all_paths("inspect", &files), content);
    }
}
