import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  inspectWinkGoFile,
  organizeWinkGoFiles,
  sanitizeWinkGoRuleName,
  undoWinkGoFiles,
  uniqueWinkGoDestination,
  winkGoCategoryForExtension,
} from '@process/services/WinkGoFileOrganizerService';

const temporaryRoots: string[] = [];

const createTemporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'winkgo-organizer-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WINK GO file organizer', () => {
  it('classifies common extensions and sanitizes unsafe category names', () => {
    expect(winkGoCategoryForExtension('pdf')).toBe('documents');
    expect(winkGoCategoryForExtension('png')).toBe('images');
    expect(sanitizeWinkGoRuleName('../客户:合同*')).toBe('客户 合同');
  });

  it('uses local file content when a custom classification rule matches', async () => {
    const root = await createTemporaryRoot();
    const source = path.join(root, 'received.txt');
    await writeFile(source, '这是客户资料，包含客户联系人和联系电话。');

    const insight = await inspectWinkGoFile(source, [
      { id: 'client', name: '客户资料', keywords: ['客户联系人', '联系电话'] },
    ]);

    expect(insight.classification).toBe('客户资料');
  });

  it('copies files without overwriting an existing destination', async () => {
    const root = await createTemporaryRoot();
    const source = path.join(root, '报告.pdf');
    const destinationRoot = path.join(root, 'inbox');
    const destinationFolder = path.join(destinationRoot, 'documents', 'pdf');
    await mkdir(destinationFolder, { recursive: true });
    await writeFile(source, 'new');
    await writeFile(path.join(destinationFolder, '报告.pdf'), 'existing');

    const result = await organizeWinkGoFiles({
      paths: [source],
      destinationRoot,
      mode: 'copy',
      autoRename: false,
      customRules: [],
    });

    expect(result.operations[0]?.finalName).toBe('报告 (2).pdf');
    expect(await readFile(path.join(destinationFolder, '报告.pdf'), 'utf8')).toBe('existing');
    expect(await readFile(result.operations[0].destination, 'utf8')).toBe('new');
  });

  it('restores a moved file to its original location', async () => {
    const root = await createTemporaryRoot();
    const source = path.join(root, '客户清单.txt');
    await writeFile(source, '客户联系人');

    const organized = await organizeWinkGoFiles({
      paths: [source],
      destinationRoot: path.join(root, 'inbox'),
      mode: 'move',
      autoRename: false,
      customRules: [],
    });
    const undone = await undoWinkGoFiles(organized.operations);

    expect(undone.restored).toEqual([source]);
    expect(await readFile(source, 'utf8')).toBe('客户联系人');
  });

  it('preserves a folder name and its nested files even when automatic rename is enabled', async () => {
    const root = await createTemporaryRoot();
    const source = path.join(root, '新建文件夹');
    const nested = path.join(source, '子目录');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, '微信图片.png'), 'image-data');

    const organized = await organizeWinkGoFiles({
      paths: [source],
      destinationRoot: path.join(root, 'inbox'),
      mode: 'move',
      autoRename: true,
      customRules: [],
    });

    expect(organized.failures).toEqual([]);
    expect(organized.operations[0]).toMatchObject({
      originalName: '新建文件夹',
      finalName: '新建文件夹',
      category: 'folders',
      fileType: '文件夹',
    });
    expect(await readFile(path.join(organized.operations[0].destination, '子目录', '微信图片.png'), 'utf8')).toBe(
      'image-data'
    );

    const undone = await undoWinkGoFiles(organized.operations);
    expect(undone.failures).toEqual([]);
    expect(await readFile(path.join(source, '子目录', '微信图片.png'), 'utf8')).toBe('image-data');
  });

  it('rejects a broad filesystem root as the destination', async () => {
    const root = await createTemporaryRoot();
    const source = path.join(root, 'note.txt');
    await writeFile(source, 'note');

    await expect(
      organizeWinkGoFiles({
        paths: [source],
        destinationRoot: path.parse(root).root,
        mode: 'move',
        autoRename: false,
        customRules: [],
      })
    ).rejects.toThrow('INVALID_DESTINATION_ROOT');
  });

  it('selects a numbered destination when the original name exists', async () => {
    const root = await createTemporaryRoot();
    await writeFile(path.join(root, 'image.png'), 'one');

    expect(path.basename(uniqueWinkGoDestination(root, 'image.png'))).toBe('image (2).png');
  });
});
