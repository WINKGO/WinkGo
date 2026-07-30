/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  WinkGoFormatConversionProgress,
  WinkGoFormatConversionReport,
  WinkGoFormatConversionRequest,
  WinkGoFormatEngineStatus,
  WinkGoFormatPreset,
} from '@/common/adapter/ipcBridge';
import { spawn, spawnSync } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MAX_INPUT_FILES = 64;
const MAX_NCM_FILE_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_NCM_KEY_BYTES = 1024 * 1024;
const MAX_NCM_INFO_BYTES = 8 * 1024 * 1024;
const MAX_NCM_COVER_BYTES = 64 * 1024 * 1024;
const MAX_PROCESS_ERROR_BYTES = 64 * 1024;
const OFFICE_AUTOMATION_TIMEOUT_MS = 120_000;
const NCM_HEADER_KEY = Buffer.from([
  0x68, 0x7a, 0x48, 0x52, 0x41, 0x6d, 0x73, 0x6f, 0x35, 0x6b, 0x49, 0x6e, 0x62, 0x61, 0x78, 0x57,
]);

type OfficeEngine =
  | { kind: 'LibreOffice'; executable: string }
  | { kind: 'WPS Office'; executable: string; powershell: string };

type NcmContainer = {
  audioStart: number;
  fileSize: number;
  keyBox: Uint8Array;
};

let activeJobId: string | null = null;
let temporarySequence = 0;

const PRESET_EXTENSIONS: Record<WinkGoFormatPreset, readonly string[]> = {
  ncm_to_mp3: ['ncm'],
  video_to_mp4: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'ts'],
  video_compress: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'ts'],
  gif_compress: ['gif'],
  audio_to_mp3: ['wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'mp3'],
  image_compress: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'tif', 'tiff'],
  document_to_pdf: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'],
};

const WPS_TO_PDF_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$inputPath = $env:WINKGO_OFFICE_INPUT
$outputPath = $env:WINKGO_OFFICE_OUTPUT
$app = $null
$document = $null
$kind = ''
$exitCode = 0
try {
  if ([string]::IsNullOrWhiteSpace($inputPath) -or -not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
    throw '找不到需要转换的文档'
  }
  if ([string]::IsNullOrWhiteSpace($outputPath)) { throw '输出路径无效' }
  $extension = [System.IO.Path]::GetExtension($inputPath).ToLowerInvariant()
  switch ($extension) {
    { $_ -in '.doc', '.docx', '.odt' } {
      $kind = 'writer'
      $app = New-Object -ComObject 'kwps.Application'
      try { $app.Visible = $false } catch {}
      try { $app.DisplayAlerts = 0 } catch {}
      $document = $app.Documents.Open($inputPath, $false, $true)
      $document.ExportAsFixedFormat($outputPath, 17)
      break
    }
    { $_ -in '.xls', '.xlsx', '.ods' } {
      $kind = 'sheet'
      $app = New-Object -ComObject 'Ket.Application'
      $app.Visible = $false
      try { $app.DisplayAlerts = $false } catch {}
      $document = $app.Workbooks.Open($inputPath, 0, $true)
      $document.ExportAsFixedFormat(0, $outputPath)
      break
    }
    { $_ -in '.ppt', '.pptx', '.odp' } {
      $kind = 'slides'
      $app = New-Object -ComObject 'Kwpp.Application'
      try { $app.DisplayAlerts = 1 } catch {}
      $document = $app.Presentations.Open($inputPath, $true, $true, $false)
      $document.SaveAs($outputPath, 32)
      break
    }
    default { throw "WPS Office 不支持此文档类型：$extension" }
  }
} catch {
  [Console]::Error.WriteLine("WPS Office 转换失败：$($_.Exception.Message)")
  $exitCode = 1
} finally {
  if ($null -ne $document) {
    try {
      if ($kind -eq 'writer') { $document.Close(0) }
      elseif ($kind -eq 'sheet') { $document.Close($false) }
      else { $document.Close() }
    } catch {}
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) } catch {}
  }
  if ($null -ne $app) {
    try { $app.Quit() } catch {}
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) } catch {}
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
exit $exitCode
`;

const isFile = async (candidate: string): Promise<boolean> => {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
};

const executableName = (name: string): string =>
  process.platform === 'win32' && !name.toLowerCase().endsWith('.exe') ? `${name}.exe` : name;

const executableCandidates = (name: string): string[] => {
  const filename = executableName(name);
  const roots = new Set<string>();
  const runtimeFolder = path.dirname(process.execPath);
  roots.add(runtimeFolder);
  roots.add(path.join(runtimeFolder, 'engines'));
  roots.add(path.join(runtimeFolder, 'resources', 'engines'));
  for (const folder of (process.env.PATH ?? '').split(path.delimiter)) {
    if (folder.trim()) roots.add(folder.replace(/^"|"$/g, ''));
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    const userProfile = process.env.USERPROFILE;
    const programData = process.env.ProgramData;
    const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean) as string[];
    if (localAppData) roots.add(path.join(localAppData, 'Microsoft', 'WinGet', 'Links'));
    if (userProfile) roots.add(path.join(userProfile, 'scoop', 'shims'));
    if (programData) roots.add(path.join(programData, 'chocolatey', 'bin'));
    for (const folder of programFiles) {
      roots.add(path.join(folder, 'ffmpeg', 'bin'));
      roots.add(path.join(folder, 'VideoLAN', 'VLC'));
      roots.add(path.join(folder, 'LibreOffice', 'program'));
    }
  }
  return [...roots].map((folder) => path.join(folder, filename));
};

export const findWinkGoFormatExecutable = async (name: string): Promise<string | null> => {
  for (const candidate of executableCandidates(name)) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
};

const queryWindowsAppPath = (filename: string): string | null => {
  if (process.platform !== 'win32') return null;
  const keys = [
    `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${filename}`,
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${filename}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${filename}`,
  ];
  for (const key of keys) {
    const result = spawnSync('reg.exe', ['query', key, '/ve'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2_000,
    });
    if (result.status !== 0) continue;
    const line = result.stdout.split(/\r?\n/).find((value) => /\bREG_SZ\b/i.test(value));
    const candidate = line
      ?.split(/\bREG_SZ\b/i)[1]
      ?.trim()
      .replace(/^"|"$/g, '');
    if (candidate) return candidate;
  }
  return null;
};

const findOfficeEngine = async (): Promise<OfficeEngine | null> => {
  const libreOffice = await findWinkGoFormatExecutable('soffice');
  if (libreOffice) return { kind: 'LibreOffice', executable: libreOffice };
  if (process.platform !== 'win32') return null;
  const systemPowerShell = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : null;
  const powershell =
    systemPowerShell && (await isFile(systemPowerShell))
      ? systemPowerShell
      : await findWinkGoFormatExecutable('powershell');
  const wpsCandidate = queryWindowsAppPath('wps.exe');
  if (wpsCandidate && powershell && (await isFile(wpsCandidate)) && (await isFile(powershell))) {
    return { kind: 'WPS Office', executable: wpsCandidate, powershell };
  }
  return null;
};

export const detectWinkGoFormatEngines = async (): Promise<WinkGoFormatEngineStatus> => {
  const [ffmpeg, office] = await Promise.all([findWinkGoFormatExecutable('ffmpeg'), findOfficeEngine()]);
  return {
    ffmpegAvailable: Boolean(ffmpeg),
    ffmpegPath: ffmpeg,
    officeAvailable: Boolean(office),
    officePath: office?.executable ?? null,
    officeEngine: office?.kind ?? null,
    ncmAvailable: true,
  };
};

export const winkGoFormatPresetAcceptsPath = (preset: WinkGoFormatPreset, filePath: string): boolean => {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return PRESET_EXTENSIONS[preset].includes(extension);
};

export const safeWinkGoFormatOutputStem = (filePath: string): string => {
  const raw = path.parse(filePath).name || 'WINK GO 转换文件';
  const cleaned = [...raw]
    .map((character) => (`<>:"/\\|?*`.includes(character) ? '_' : character))
    .slice(0, 120)
    .join('')
    .trim()
    .replace(/\.+$/g, '');
  return cleaned || 'WINK GO 转换文件';
};

const uniqueOutputPath = async (folder: string, stem: string, extension: string): Promise<string> => {
  const direct = path.join(folder, `${stem}.${extension}`);
  if (!(await isFile(direct))) return direct;
  for (let suffix = 2; suffix <= 9_999; suffix += 1) {
    const candidate = path.join(folder, `${stem} (${suffix}).${extension}`);
    if (!(await isFile(candidate))) return candidate;
  }
  temporarySequence += 1;
  return path.join(folder, `${stem}-${Date.now()}-${temporarySequence}.${extension}`);
};

const temporaryFilePath = (folder: string, stem: string, extension: string): string => {
  temporarySequence += 1;
  return path.join(folder, `.winkgo-${process.pid}-${temporarySequence}-${stem}.${extension}`);
};

const ensureOutputWritten = async (filePath: string): Promise<void> => {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0) throw new Error('EMPTY_OUTPUT');
  } catch {
    await rm(filePath, { force: true }).catch((): undefined => undefined);
    throw new Error('转换引擎没有生成有效的输出文件');
  }
};

const lastNonEmptyLine = (value: string): string =>
  value
    .split(/\r?\n/)
    .toReversed()
    .find((line) => line.trim())
    ?.trim()
    .slice(0, 220) || '转换引擎返回失败';

const runHiddenCommand = async (
  executable: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number; label?: string } = {}
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-MAX_PROCESS_ERROR_BYTES);
    });
    child.once('error', (error) => finish(new Error(`无法启动${options.label ?? '转换引擎'}：${error.message}`)));
    child.once('exit', (code) => {
      if (code === 0) finish();
      else finish(new Error(lastNonEmptyLine(stderr)));
    });
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill();
          finish(
            new Error(`${options.label ?? '转换任务'}超过 ${Math.round(options.timeoutMs! / 1000)} 秒，已安全终止`)
          );
        }, options.timeoutMs)
      : undefined;
  });

export const buildWinkGoFfmpegArguments = (
  preset: Exclude<WinkGoFormatPreset, 'ncm_to_mp3' | 'document_to_pdf'>,
  input: string,
  output: string
): string[] => {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', input];
  switch (preset) {
    case 'audio_to_mp3':
      args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2');
      break;
    case 'video_to_mp4':
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '21',
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-movflags',
        '+faststart'
      );
      break;
    case 'video_compress':
      args.push(
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '28',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-movflags',
        '+faststart'
      );
      break;
    case 'gif_compress':
      args.push('-vf', 'fps=12,scale=960:-2:force_original_aspect_ratio=decrease:flags=lanczos', '-loop', '0');
      break;
    case 'image_compress':
      args.push('-frames:v', '1', '-q:v', '4');
      break;
  }
  args.push(output);
  return args;
};

const convertWithFfmpeg = async (
  input: string,
  outputFolder: string,
  ffmpeg: string | null,
  preset: Exclude<WinkGoFormatPreset, 'ncm_to_mp3' | 'document_to_pdf'>
): Promise<string> => {
  if (!ffmpeg) throw new Error('未检测到 FFmpeg，媒体转换引擎不可用');
  const extension =
    preset === 'audio_to_mp3' ? 'mp3' : preset === 'image_compress' ? 'jpg' : preset === 'gif_compress' ? 'gif' : 'mp4';
  const output = await uniqueOutputPath(outputFolder, safeWinkGoFormatOutputStem(input), extension);
  try {
    await runHiddenCommand(ffmpeg, buildWinkGoFfmpegArguments(preset, input, output), { label: 'FFmpeg' });
    await ensureOutputWritten(output);
    return output;
  } catch (error) {
    await rm(output, { force: true }).catch((): undefined => undefined);
    throw error;
  }
};

const readExactly = async (
  handle: Awaited<ReturnType<typeof open>>,
  length: number,
  position: number,
  label: string
): Promise<Buffer> => {
  const buffer = Buffer.alloc(length);
  const result = await handle.read(buffer, 0, length, position);
  if (result.bytesRead !== length) throw new Error(`${label}不完整`);
  return buffer;
};

const buildNcmKeyBox = (key: Buffer): Uint8Array => {
  if (!key.length) throw new Error('NCM 密钥为空');
  const keyBox = Uint8Array.from({ length: 256 }, (_, index) => index);
  let cursor = 0;
  for (let index = 0; index < 256; index += 1) {
    cursor = (keyBox[index] + cursor + key[index % key.length]) & 0xff;
    const next = keyBox[index];
    keyBox[index] = keyBox[cursor];
    keyBox[cursor] = next;
  }
  return keyBox;
};

export const decryptWinkGoNcmChunk = (encrypted: Uint8Array, keyBox: Uint8Array, offset: number): Buffer => {
  const output = Buffer.from(encrypted);
  for (let index = 0; index < output.length; index += 1) {
    const first = (offset + index + 1) & 0xff;
    const second = (keyBox[first] + first) & 0xff;
    const keyIndex = (keyBox[second] + keyBox[first]) & 0xff;
    output[index] ^= keyBox[keyIndex];
  }
  return output;
};

const inspectNcmContainer = async (filePath: string): Promise<NcmContainer> => {
  const info = await stat(filePath).catch((): null => null);
  if (!info?.isFile()) throw new Error('文件不存在，可能已被移动或删除');
  if (info.size < 32) throw new Error('NCM 文件过小或已损坏');
  if (info.size > MAX_NCM_FILE_BYTES) throw new Error('NCM 文件超过 8 GB 安全上限');
  const handle = await open(filePath, 'r');
  try {
    const header = await readExactly(handle, 10, 0, 'NCM 文件头');
    if (!header.subarray(0, 8).equals(Buffer.from('CTENFDAM'))) throw new Error('这不是有效的 NCM 文件');
    const keyLength = (await readExactly(handle, 4, 10, 'NCM 密钥长度')).readUInt32LE();
    if (keyLength < 16 || keyLength > MAX_NCM_KEY_BYTES || keyLength % 16 !== 0) {
      throw new Error('NCM 密钥字段异常，已阻止高风险文件');
    }
    const infoLengthOffset = 14 + keyLength;
    if (infoLengthOffset + 4 > info.size) throw new Error('NCM 密钥字段超出文件范围');
    const encryptedKey = await readExactly(handle, keyLength, 14, 'NCM 密钥字段');
    const decipher = createDecipheriv('aes-128-ecb', NCM_HEADER_KEY, null);
    decipher.setAutoPadding(true);
    const decryptedKey = Buffer.concat([
      decipher.update(Buffer.from(encryptedKey.map((value) => value ^ 0x64))),
      decipher.final(),
    ]);
    if (decryptedKey.length <= 17) throw new Error('NCM 密钥无法解析');
    const infoLength = (await readExactly(handle, 4, infoLengthOffset, 'NCM 元数据长度')).readUInt32LE();
    if (infoLength > MAX_NCM_INFO_BYTES) throw new Error('NCM 元数据字段超过安全上限');
    const coverLengthOffset = infoLengthOffset + 4 + infoLength + 5;
    if (coverLengthOffset + 8 > info.size) throw new Error('NCM 元数据字段超出文件范围');
    const coverFrameLength = (await readExactly(handle, 4, coverLengthOffset, 'NCM 封面帧长度')).readUInt32LE();
    const imageLength = (await readExactly(handle, 4, coverLengthOffset + 4, 'NCM 封面长度')).readUInt32LE();
    if (coverFrameLength > MAX_NCM_COVER_BYTES || imageLength > MAX_NCM_COVER_BYTES) {
      throw new Error('NCM 封面字段超过安全上限');
    }
    if (imageLength > coverFrameLength) throw new Error('NCM 封面长度大于封面帧，已阻止异常文件');
    const audioStart = coverLengthOffset + 8 + coverFrameLength;
    if (audioStart >= info.size) throw new Error('NCM 封面或音频字段超出文件范围');
    return {
      audioStart,
      fileSize: info.size,
      keyBox: buildNcmKeyBox(decryptedKey.subarray(17)),
    };
  } finally {
    await handle.close();
  }
};

const exportDecryptedNcmAudio = async (input: string, output: string, container: NcmContainer): Promise<void> => {
  const source = await open(input, 'r');
  const destination = await open(output, 'wx');
  let readPosition = container.audioStart;
  let decryptOffset = 0;
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    while (readPosition < container.fileSize) {
      const length = Math.min(buffer.length, container.fileSize - readPosition);
      const result = await source.read(buffer, 0, length, readPosition);
      if (result.bytesRead === 0) break;
      const decrypted = decryptWinkGoNcmChunk(buffer.subarray(0, result.bytesRead), container.keyBox, decryptOffset);
      await destination.write(decrypted);
      readPosition += result.bytesRead;
      decryptOffset += result.bytesRead;
    }
    await destination.sync();
  } finally {
    await Promise.all([source.close(), destination.close()]);
  }
};

const convertNcmToMp3 = async (
  input: string,
  outputFolder: string,
  ffmpeg: string | null,
  onStage: (percent: number, message: string) => void
): Promise<string> => {
  const container = await inspectNcmContainer(input);
  const inputHandle = await open(input, 'r');
  const encryptedSignature = await readExactly(
    inputHandle,
    Math.min(12, container.fileSize - container.audioStart),
    container.audioStart,
    'NCM 音频'
  );
  await inputHandle.close();
  const signature = decryptWinkGoNcmChunk(encryptedSignature, container.keyBox, 0);
  const isMp3 =
    signature.subarray(0, 3).equals(Buffer.from('ID3')) || (signature[0] === 0xff && (signature[1] & 0xe0) === 0xe0);
  const isFlac = signature.subarray(0, 4).equals(Buffer.from('fLaC'));
  if (!isMp3 && !isFlac) throw new Error('NCM 内部音轨不是受支持的 MP3 或 FLAC');
  const stem = safeWinkGoFormatOutputStem(input);
  const output = await uniqueOutputPath(outputFolder, stem, 'mp3');
  if (isMp3) {
    onStage(62, '已识别 MP3 音轨，正在安全导出');
    try {
      await exportDecryptedNcmAudio(input, output, container);
      await ensureOutputWritten(output);
      return output;
    } catch (error) {
      await rm(output, { force: true }).catch((): undefined => undefined);
      throw error;
    }
  }
  if (!ffmpeg) throw new Error('这个 NCM 内嵌 FLAC，需要 FFmpeg 才能真正转成 MP3');
  onStage(52, '已识别 FLAC 音轨，正在转码为 MP3');
  const temporaryFlac = temporaryFilePath(outputFolder, stem, 'flac');
  try {
    await exportDecryptedNcmAudio(input, temporaryFlac, container);
    await runHiddenCommand(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-n',
        '-i',
        temporaryFlac,
        '-vn',
        '-c:a',
        'libmp3lame',
        '-q:a',
        '2',
        output,
      ],
      { label: 'FFmpeg' }
    );
    await ensureOutputWritten(output);
    return output;
  } catch (error) {
    await rm(output, { force: true }).catch((): undefined => undefined);
    throw error;
  } finally {
    await rm(temporaryFlac, { force: true }).catch((): undefined => undefined);
  }
};

const convertWithLibreOffice = async (input: string, output: string, executable: string): Promise<string> => {
  const temporaryFolder = path.join(os.tmpdir(), `winkgo-format-${process.pid}-${Date.now()}-${++temporarySequence}`);
  await mkdir(temporaryFolder, { recursive: true });
  try {
    await runHiddenCommand(executable, ['--headless', '--convert-to', 'pdf', '--outdir', temporaryFolder, input], {
      label: 'LibreOffice',
      timeoutMs: OFFICE_AUTOMATION_TIMEOUT_MS,
    });
    const generatedName = (await readdir(temporaryFolder)).find((name) => path.extname(name).toLowerCase() === '.pdf');
    if (!generatedName) throw new Error('LibreOffice 没有生成 PDF 文件');
    const generated = path.join(temporaryFolder, generatedName);
    await ensureOutputWritten(generated);
    try {
      await rename(generated, output);
    } catch {
      await copyFile(generated, output, fsConstants.COPYFILE_EXCL);
    }
    await ensureOutputWritten(output);
    return output;
  } finally {
    await rm(temporaryFolder, { recursive: true, force: true }).catch((): undefined => undefined);
  }
};

const convertWithWpsOffice = async (input: string, output: string, powershell: string): Promise<string> => {
  try {
    await runHiddenCommand(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WPS_TO_PDF_SCRIPT],
      {
        env: {
          ...process.env,
          WINKGO_OFFICE_INPUT: input,
          WINKGO_OFFICE_OUTPUT: output,
        },
        timeoutMs: OFFICE_AUTOMATION_TIMEOUT_MS,
        label: 'WPS Office 转换',
      }
    );
    await ensureOutputWritten(output);
    return output;
  } catch (error) {
    await rm(output, { force: true }).catch((): undefined => undefined);
    throw error;
  }
};

const convertDocumentToPdf = async (
  input: string,
  outputFolder: string,
  office: OfficeEngine | null
): Promise<string> => {
  if (!office) throw new Error('未检测到 LibreOffice 或 WPS Office，文档转 PDF 暂不可用');
  const output = await uniqueOutputPath(outputFolder, safeWinkGoFormatOutputStem(input), 'pdf');
  return office.kind === 'LibreOffice'
    ? convertWithLibreOffice(input, output, office.executable)
    : convertWithWpsOffice(input, output, office.powershell);
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message.slice(0, 260);
  return String(error).slice(0, 260);
};

const emitProgress = (
  request: WinkGoFormatConversionRequest,
  fileName: string,
  index: number,
  total: number,
  status: WinkGoFormatConversionProgress['status'],
  percent: number,
  message: string,
  outputPath: string | null,
  onProgress: (progress: WinkGoFormatConversionProgress) => void
): void => {
  onProgress({
    jobId: request.jobId,
    preset: request.preset,
    fileName,
    index,
    total,
    status,
    percent,
    message,
    outputPath,
  });
};

const validateRequest = async (request: WinkGoFormatConversionRequest): Promise<void> => {
  if (!request.jobId.trim()) throw new Error('转换任务编号无效');
  if (!PRESET_EXTENSIONS[request.preset]) throw new Error('不支持的转换类型');
  if (!request.paths.length) throw new Error('请先添加需要转换的文件');
  if (request.paths.length > MAX_INPUT_FILES) throw new Error('单次最多处理 64 个文件');
  if (!request.outputFolder.trim()) throw new Error('请选择输出目录');
  await mkdir(request.outputFolder, { recursive: true });
  if (!(await stat(request.outputFolder)).isDirectory()) throw new Error('输出位置不是文件夹');
};

export const runWinkGoFormatConversion = async (
  request: WinkGoFormatConversionRequest,
  onProgress: (progress: WinkGoFormatConversionProgress) => void
): Promise<WinkGoFormatConversionReport> => {
  await validateRequest(request);
  if (activeJobId) throw new Error('已有格式转换任务正在运行，请等待当前任务完成');
  activeJobId = request.jobId;
  try {
    const [ffmpeg, office] = await Promise.all([findWinkGoFormatExecutable('ffmpeg'), findOfficeEngine()]);
    const items: WinkGoFormatConversionReport['items'] = [];
    for (let offset = 0; offset < request.paths.length; offset += 1) {
      const input = request.paths[offset].trim();
      const fileName = path.basename(input) || '未命名文件';
      const index = offset + 1;
      emitProgress(request, fileName, index, request.paths.length, 'running', 6, '正在检查文件', null, onProgress);
      try {
        if (!(await isFile(input))) throw new Error('文件不存在，可能已被移动或删除');
        if (!winkGoFormatPresetAcceptsPath(request.preset, input)) {
          throw new Error('文件格式与当前工具不匹配');
        }
        emitProgress(
          request,
          fileName,
          index,
          request.paths.length,
          'running',
          24,
          '正在读取并准备转换',
          null,
          onProgress
        );
        const output =
          request.preset === 'ncm_to_mp3'
            ? await convertNcmToMp3(input, request.outputFolder, ffmpeg, (percent, message) =>
                emitProgress(
                  request,
                  fileName,
                  index,
                  request.paths.length,
                  'running',
                  percent,
                  message,
                  null,
                  onProgress
                )
              )
            : request.preset === 'document_to_pdf'
              ? await convertDocumentToPdf(input, request.outputFolder, office)
              : await convertWithFfmpeg(input, request.outputFolder, ffmpeg, request.preset);
        emitProgress(
          request,
          fileName,
          index,
          request.paths.length,
          'completed',
          100,
          '转换完成，点击可打开文件夹',
          output,
          onProgress
        );
        items.push({
          sourcePath: input,
          sourceName: fileName,
          outputPath: output,
          success: true,
          message: '转换完成',
        });
      } catch (error) {
        const message = errorMessage(error);
        emitProgress(request, fileName, index, request.paths.length, 'failed', 100, message, null, onProgress);
        items.push({
          sourcePath: input,
          sourceName: fileName,
          outputPath: null,
          success: false,
          message,
        });
      }
    }
    return {
      jobId: request.jobId,
      preset: request.preset,
      outputFolder: request.outputFolder,
      items,
    };
  } finally {
    activeJobId = null;
  }
};

export const ensureWinkGoFormatOutputFolder = async (folder: string): Promise<string> => {
  await mkdir(folder, { recursive: true });
  await access(folder, fsConstants.R_OK | fsConstants.W_OK);
  return folder;
};
