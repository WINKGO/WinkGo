// Modified from AionUI by WINK GO contributors in 2026.
import { type ChatFileRef, chatFileRefKey, uploadFileRef } from '@/common/types/chatFile';
import type { FileOrFolderItem } from '@/renderer/utils/file/fileTypes';

/** Collect source-tagged file references without duplicating the same file. */
export const collectChatFileRefs = (uploadFile: string[], atPath: Array<string | FileOrFolderItem>): ChatFileRef[] => {
  const refs: ChatFileRef[] = [];
  const seen = new Set<string>();
  const push = (ref: ChatFileRef): void => {
    const key = chatFileRefKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  for (const path of uploadFile) {
    if (path) push(uploadFileRef(path));
  }
  for (const item of atPath) {
    if (typeof item === 'string') {
      if (item) push(uploadFileRef(item));
    } else if (item.chatRef) {
      push(item.chatRef);
    } else if (item.path) {
      push(uploadFileRef(item.path));
    }
  }
  return refs;
};

/** Rebuild the send-box upload and project-selection lanes from queued references. */
export const splitChatFileRefs = (refs: ChatFileRef[]): { uploadFiles: string[]; atPath: FileOrFolderItem[] } => {
  const uploadFiles: string[] = [];
  const atPath: FileOrFolderItem[] = [];
  for (const ref of refs) {
    if (ref.kind === 'upload') {
      uploadFiles.push(ref.path);
    } else {
      const path = ref.kind === 'project' ? ref.relative_path : ref.path;
      atPath.push({
        path,
        name: path.split(/[\\/]/).pop() || path,
        isFile: true,
        chatRef: ref,
      });
    }
  }
  return { uploadFiles, atPath };
};
