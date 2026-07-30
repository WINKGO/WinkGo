/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { constants as fsConstants, existsSync } from 'node:fs';
import { copyFile, cp, lstat, mkdir, open, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type {
  WinkGoOrganizeFailure,
  WinkGoOrganizeOperation,
  WinkGoOrganizeRequest,
  WinkGoOrganizeResult,
  WinkGoOrganizerRule,
  WinkGoUndoResult,
} from '@/common/adapter/ipcBridge';
import * as yauzl from 'yauzl';

const MAX_BATCH_FILES = 64;
const MAX_PLAIN_TEXT_BYTES = 512 * 1024;
const MAX_ARCHIVE_XML_BYTES = 768 * 1024;
const MAX_ARCHIVE_ENTRIES = 12;
const MAX_CUSTOM_RULES = 32;
const MAX_CUSTOM_KEYWORDS = 20;
const MAX_RULE_NAME_CHARS = 32;
const MAX_RULE_KEYWORD_CHARS = 48;

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'csv',
  'json',
  'xml',
  'yaml',
  'yml',
  'toml',
  'sql',
  'rs',
  'js',
  'ts',
  'tsx',
  'jsx',
  'vue',
  'py',
  'java',
  'cpp',
  'c',
  'h',
  'cs',
  'go',
  'html',
  'css',
]);

const OFFICE_EXTENSIONS = new Set(['xlsx', 'xlsm', 'docx', 'pptx']);

type FileInsight = {
  category: string;
  classification: string;
  fileType: string;
};

type ClassificationRule = {
  id: string;
  keywords: string[];
};

const BUILTIN_CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    id: 'production',
    keywords: ['生产', '工单', '物料', '产线', '工序', 'production', 'work order'],
  },
  {
    id: 'purchase',
    keywords: ['订单', '采购', '供应商', '订货', 'purchase', 'supplier', 'order no', 'po number'],
  },
  {
    id: 'inventory',
    keywords: ['库存', '入库', '出库', '仓库', '盘点', 'inventory', 'warehouse', 'stock'],
  },
  {
    id: 'contracts',
    keywords: ['报价', '合同', '协议', '甲方', '乙方', 'quotation', 'contract', 'agreement'],
  },
  {
    id: 'clients',
    keywords: ['客户', '联系人', '联系电话', '客户地址', 'customer', 'client', 'contact person'],
  },
  {
    id: 'finance',
    keywords: ['发票', '税率', '收款', '付款', '报销', '财务', 'invoice', 'expense', 'payment'],
  },
  {
    id: 'content',
    keywords: ['短视频', '口播', '分镜', '台词', '字幕', '脚本', '公众号', 'video script', 'voiceover'],
  },
  {
    id: 'projects',
    keywords: ['项目', '方案', '里程碑', '交付', '验收', 'project', 'milestone', 'deliverable'],
  },
  {
    id: 'meetings',
    keywords: ['会议', '纪要', '参会', '议题', 'meeting', 'minutes', 'attendee'],
  },
  {
    id: 'schedules',
    keywords: ['计划', '排期', '日程', '任务', 'schedule', 'timeline', 'task list'],
  },
];

export const winkGoCategoryForExtension = (extension: string): string => {
  if (
    ['doc', 'docx', 'pdf', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'xlsm', 'csv', 'ppt', 'pptx', 'md'].includes(extension)
  ) {
    return 'documents';
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'svg', 'ico'].includes(extension)) {
    return 'images';
  }
  if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma'].includes(extension)) return 'audio';
  if (['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'm4v'].includes(extension)) return 'video';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(extension)) return 'archives';
  if (['exe', 'msi', 'msix', 'appx'].includes(extension)) return 'installers';
  if (
    [
      'rs',
      'js',
      'ts',
      'tsx',
      'jsx',
      'vue',
      'py',
      'java',
      'cpp',
      'c',
      'h',
      'cs',
      'go',
      'html',
      'css',
      'json',
      'yaml',
      'yml',
      'toml',
      'xml',
      'sql',
    ].includes(extension)
  ) {
    return 'code';
  }
  return 'other';
};

const fileTypeForExtension = (extension: string): string => {
  if (!extension) return 'file';
  if (extension === 'pdf') return 'PDF';
  if (['doc', 'docx'].includes(extension)) return 'Word';
  if (['xls', 'xlsx', 'xlsm', 'csv'].includes(extension)) return 'Excel';
  if (['ppt', 'pptx'].includes(extension)) return 'PowerPoint';
  return extension.toUpperCase();
};

const sanitizeText = (value: string, maxChars: number): string =>
  value
    .replace(/\p{Cc}/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .slice(0, maxChars);

export const sanitizeWinkGoRuleName = (value: string): string =>
  sanitizeText(value, MAX_RULE_NAME_CHARS)
    .replace(/[<>:"/\\|?*]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');

const sanitizeRules = (rules: WinkGoOrganizerRule[]): WinkGoOrganizerRule[] => {
  const result: WinkGoOrganizerRule[] = [];
  const names = new Set<string>();
  for (const rule of rules.slice(0, MAX_CUSTOM_RULES)) {
    const name = sanitizeWinkGoRuleName(rule.name);
    const normalizedName = name.toLocaleLowerCase();
    if (!name || names.has(normalizedName)) continue;

    const keywords: string[] = [];
    const seenKeywords = new Set<string>();
    for (const rawKeyword of rule.keywords.slice(0, MAX_CUSTOM_KEYWORDS)) {
      const keyword = sanitizeText(rawKeyword, MAX_RULE_KEYWORD_CHARS);
      const normalizedKeyword = keyword.toLocaleLowerCase();
      if (keyword.length < 2 || seenKeywords.has(normalizedKeyword)) continue;
      seenKeywords.add(normalizedKeyword);
      keywords.push(keyword);
    }
    if (keywords.length === 0) continue;
    names.add(normalizedName);
    result.push({ id: rule.id, name, keywords });
  }
  return result;
};

const readPlainTextSample = async (filePath: string): Promise<string> => {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(MAX_PLAIN_TEXT_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
};

const isSelectedOfficeEntry = (extension: string, entryName: string): boolean => {
  const lower = entryName.toLocaleLowerCase();
  if (extension === 'xlsx' || extension === 'xlsm') {
    return (
      lower === 'xl/sharedstrings.xml' ||
      lower === 'xl/workbook.xml' ||
      (lower.startsWith('xl/worksheets/sheet') && lower.endsWith('.xml'))
    );
  }
  if (extension === 'docx') {
    return lower === 'word/document.xml' || (lower.startsWith('word/header') && lower.endsWith('.xml'));
  }
  return extension === 'pptx' && lower.startsWith('ppt/slides/slide') && lower.endsWith('.xml');
};

const stripOfficeXml = (xml: string): string =>
  xml
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

const readOfficeTextSample = async (filePath: string, extension: string): Promise<string> =>
  new Promise((resolve) => {
    yauzl.open(filePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        resolve('');
        return;
      }

      let finished = false;
      let selectedEntries = 0;
      let totalBytes = 0;
      const samples: Buffer[] = [];
      const finish = () => {
        if (finished) return;
        finished = true;
        zipFile.close();
        resolve(stripOfficeXml(Buffer.concat(samples).toString('utf8')));
      };

      zipFile.on('entry', (entry) => {
        if (
          selectedEntries >= MAX_ARCHIVE_ENTRIES ||
          totalBytes >= MAX_PLAIN_TEXT_BYTES ||
          !isSelectedOfficeEntry(extension, entry.fileName) ||
          entry.uncompressedSize > MAX_ARCHIVE_XML_BYTES
        ) {
          if (selectedEntries >= MAX_ARCHIVE_ENTRIES || totalBytes >= MAX_PLAIN_TEXT_BYTES) {
            finish();
          } else {
            zipFile.readEntry();
          }
          return;
        }

        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zipFile.readEntry();
            return;
          }
          const chunks: Buffer[] = [];
          let entryBytes = 0;
          stream.on('data', (chunk: Buffer) => {
            const remaining = Math.min(
              MAX_ARCHIVE_XML_BYTES - entryBytes,
              MAX_PLAIN_TEXT_BYTES - totalBytes - entryBytes
            );
            if (remaining <= 0) return;
            const next = Buffer.from(chunk).subarray(0, remaining);
            chunks.push(next);
            entryBytes += next.length;
          });
          stream.on('error', () => zipFile.readEntry());
          stream.on('end', () => {
            samples.push(Buffer.concat(chunks));
            totalBytes += entryBytes;
            selectedEntries += 1;
            zipFile.readEntry();
          });
        });
      });
      zipFile.on('end', finish);
      zipFile.on('error', finish);
      zipFile.readEntry();
    });
  });

const readContentSample = async (filePath: string, extension: string): Promise<string> => {
  try {
    if (TEXT_EXTENSIONS.has(extension)) return await readPlainTextSample(filePath);
    if (OFFICE_EXTENSIONS.has(extension)) return await readOfficeTextSample(filePath, extension);
  } catch {
    return '';
  }
  return '';
};

const findBestRule = (
  stem: string,
  content: string,
  rules: Array<{ id: string; keywords: string[]; custom: boolean }>
): string | undefined => {
  const normalizedStem = stem.toLocaleLowerCase();
  const normalizedContent = content.toLocaleLowerCase();
  let best: { id: string; score: number } | undefined;
  for (const rule of rules) {
    let score = 0;
    for (const keyword of rule.keywords) {
      const normalizedKeyword = keyword.toLocaleLowerCase();
      if (normalizedStem.includes(normalizedKeyword)) {
        score += 3;
      } else if (normalizedContent.includes(normalizedKeyword)) {
        score += rule.custom ? 2 : 1;
      }
    }
    if (score >= 2 && (!best || score > best.score)) {
      best = { id: rule.id, score };
    }
  }
  return best?.id;
};

const fallbackClassification = (category: string, extension: string, stem: string): string => {
  if (['xls', 'xlsx', 'xlsm', 'csv'].includes(extension)) return 'spreadsheets';
  if (['doc', 'docx', 'txt', 'rtf', 'odt', 'md'].includes(extension)) return 'generalDocuments';
  if (extension === 'pdf') return 'pdf';
  if (['ppt', 'pptx'].includes(extension)) return 'presentations';
  if (
    category === 'images' &&
    (stem.toLocaleLowerCase().includes('screenshot') || stem.includes('截图') || stem.startsWith('snip'))
  ) {
    return 'screenshots';
  }
  return category;
};

export const inspectWinkGoFile = async (filePath: string, customRules: WinkGoOrganizerRule[]): Promise<FileInsight> => {
  const extension = path.extname(filePath).slice(1).toLocaleLowerCase();
  const category = winkGoCategoryForExtension(extension);
  const stem = path.basename(filePath, path.extname(filePath));
  const content = await readContentSample(filePath, extension);
  const sanitizedRules = sanitizeRules(customRules);
  const rules = [
    ...sanitizedRules.map((rule) => ({ id: rule.name, keywords: rule.keywords, custom: true })),
    ...BUILTIN_CLASSIFICATION_RULES.map((rule) => ({ ...rule, custom: false })),
  ];
  return {
    category,
    classification: findBestRule(stem, content, rules) ?? fallbackClassification(category, extension, stem),
    fileType: fileTypeForExtension(extension),
  };
};

const inspectWinkGoDirectory = (directoryPath: string, customRules: WinkGoOrganizerRule[]): FileInsight => {
  const stem = path.basename(directoryPath);
  const sanitizedRules = sanitizeRules(customRules);
  const rules = [
    ...sanitizedRules.map((rule) => ({ id: rule.name, keywords: rule.keywords, custom: true })),
    ...BUILTIN_CLASSIFICATION_RULES.map((rule) => ({ ...rule, custom: false })),
  ];
  return {
    category: 'folders',
    classification: findBestRule(stem, '', rules) ?? 'folders',
    fileType: '文件夹',
  };
};

const looksGenericFileName = (stem: string): boolean => {
  const normalized = stem.trim().toLocaleLowerCase();
  if (!normalized) return true;
  if (
    ['img_', 'document_', 'screenshot_', 'mmexport', 'wx_camera_', 'received_file_', '新建'].some((prefix) =>
      normalized.startsWith(prefix)
    )
  ) {
    return true;
  }
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  return compact.length >= 14 && (/^\d+$/.test(compact) || /^[a-f0-9]+$/.test(compact));
};

const candidateFileName = (source: string, insight: FileInsight, autoRename: boolean): string => {
  const originalName = path.basename(source) || 'file';
  if (!autoRename) return originalName;
  const extension = path.extname(source).slice(1).toLocaleLowerCase();
  const stem = path.basename(source, path.extname(source));
  if (!looksGenericFileName(stem)) return originalName;
  const suffix = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  return extension ? `${insight.classification}_${suffix}.${extension}` : `${insight.classification}_${suffix}`;
};

export const uniqueWinkGoDestination = (directory: string, fileName: string): string => {
  const initial = path.join(directory, fileName);
  if (!existsSync(initial)) return initial;
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension) || 'file';
  for (let index = 2; index <= 9_999; index += 1) {
    const candidate = path.join(directory, `${stem} (${index})${extension}`);
    if (!existsSync(candidate)) return candidate;
  }
  return path.join(directory, `${stem} (${Date.now()})${extension}`);
};

const copyWithoutOverwrite = async (source: string, destination: string): Promise<void> => {
  await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
};

const moveWithoutOverwrite = async (source: string, destination: string): Promise<void> => {
  await copyWithoutOverwrite(source, destination);
  try {
    await unlink(source);
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
};

const copyDirectoryWithoutOverwrite = async (source: string, destination: string): Promise<void> => {
  await cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
  });
};

const moveDirectoryWithoutOverwrite = async (source: string, destination: string): Promise<void> => {
  await copyDirectoryWithoutOverwrite(source, destination);
  try {
    await rm(source, { recursive: true });
  } catch (error) {
    await rm(destination, { force: true, recursive: true });
    throw error;
  }
};

const normalizeDestinationRoot = (destinationRoot: string): string => {
  const normalized = path.resolve(destinationRoot.trim());
  if (!path.isAbsolute(destinationRoot.trim()) || normalized === path.parse(normalized).root) {
    throw new Error('INVALID_DESTINATION_ROOT');
  }
  return normalized;
};

export const organizeWinkGoFiles = async (request: WinkGoOrganizeRequest): Promise<WinkGoOrganizeResult> => {
  if (request.paths.length === 0) throw new Error('NO_FILES');
  if (request.paths.length > MAX_BATCH_FILES) throw new Error('TOO_MANY_FILES');
  if (request.mode !== 'move' && request.mode !== 'copy') throw new Error('INVALID_MODE');

  const destinationRoot = normalizeDestinationRoot(request.destinationRoot);
  await mkdir(destinationRoot, { recursive: true });
  const customRules = sanitizeRules(request.customRules);
  const manualClassification = request.manualClassification
    ? sanitizeWinkGoRuleName(request.manualClassification)
    : undefined;
  const operations: WinkGoOrganizeOperation[] = [];
  const failures: WinkGoOrganizeFailure[] = [];
  const skipped: string[] = [];

  for (const rawPath of request.paths.slice(0, MAX_BATCH_FILES)) {
    const source = path.resolve(rawPath);
    try {
      if (!path.isAbsolute(rawPath)) throw new Error('INVALID_SOURCE');
      const sourceStats = await lstat(source);
      if (sourceStats.isSymbolicLink()) throw new Error('SOURCE_IS_SYMBOLIC_LINK');
      const isDirectory = sourceStats.isDirectory();
      if (!sourceStats.isFile() && !isDirectory) throw new Error('SOURCE_NOT_SUPPORTED');

      const insight = isDirectory
        ? inspectWinkGoDirectory(source, customRules)
        : await inspectWinkGoFile(source, customRules);
      const classification = manualClassification || insight.classification;
      const destinationDirectory =
        classification === insight.category
          ? path.join(destinationRoot, insight.category)
          : path.join(destinationRoot, insight.category, classification);
      if (path.resolve(path.dirname(source)) === path.resolve(destinationDirectory)) {
        skipped.push(source);
        continue;
      }
      await mkdir(destinationDirectory, { recursive: true });
      const originalName = path.basename(source);
      // Directories are containers, not generic files. Their names are always preserved.
      const finalCandidate = isDirectory
        ? originalName
        : candidateFileName(source, { ...insight, classification }, request.autoRename);
      const destination = uniqueWinkGoDestination(destinationDirectory, finalCandidate);
      if (isDirectory && destination.startsWith(`${source}${path.sep}`)) {
        throw new Error('DESTINATION_INSIDE_SOURCE');
      }
      if (isDirectory && request.mode === 'move') {
        await moveDirectoryWithoutOverwrite(source, destination);
      } else if (isDirectory) {
        await copyDirectoryWithoutOverwrite(source, destination);
      } else if (request.mode === 'move') {
        await moveWithoutOverwrite(source, destination);
      } else {
        await copyWithoutOverwrite(source, destination);
      }
      operations.push({
        source,
        destination,
        originalName,
        finalName: path.basename(destination),
        category: insight.category,
        classification,
        fileType: insight.fileType,
        mode: request.mode,
        sizeBytes: sourceStats.size,
        organizedAt: Date.now(),
      });
    } catch (error) {
      failures.push({
        path: rawPath,
        reason: error instanceof Error ? error.message : 'ORGANIZE_FAILED',
      });
    }
  }

  return { destinationRoot, operations, failures, skipped };
};

export const undoWinkGoFiles = async (operations: WinkGoOrganizeOperation[]): Promise<WinkGoUndoResult> => {
  if (operations.length > MAX_BATCH_FILES) throw new Error('TOO_MANY_FILES');
  const restored: string[] = [];
  const failures: WinkGoOrganizeFailure[] = [];

  for (const operation of operations.toReversed()) {
    try {
      if (operation.mode !== 'move') throw new Error('COPY_CANNOT_UNDO');
      if (!path.isAbsolute(operation.source) || !path.isAbsolute(operation.destination)) {
        throw new Error('INVALID_SOURCE');
      }
      if (existsSync(operation.source)) throw new Error('SOURCE_ALREADY_EXISTS');
      const destinationStats = await stat(operation.destination);
      if (!destinationStats.isFile() && !destinationStats.isDirectory()) {
        throw new Error('DESTINATION_NOT_SUPPORTED');
      }
      await mkdir(path.dirname(operation.source), { recursive: true });
      if (destinationStats.isDirectory()) {
        await moveDirectoryWithoutOverwrite(operation.destination, operation.source);
      } else {
        await moveWithoutOverwrite(operation.destination, operation.source);
      }
      restored.push(operation.source);
    } catch (error) {
      failures.push({
        path: operation.destination,
        reason: error instanceof Error ? error.message : 'UNDO_FAILED',
      });
    }
  }
  return { restored, failures };
};

export const canRevealWinkGoFile = async (filePath: string): Promise<boolean> => {
  if (!path.isAbsolute(filePath)) return false;
  try {
    const targetStats = await stat(filePath);
    return targetStats.isFile() || targetStats.isDirectory();
  } catch {
    return false;
  }
};
