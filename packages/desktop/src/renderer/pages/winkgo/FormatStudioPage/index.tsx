/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  WinkGoFormatConversionProgress,
  WinkGoFormatEngineStatus,
  WinkGoFormatPreset,
} from '@/common/adapter/ipcBridge';
import SettingsPageWrapper from '@renderer/pages/settings/components/SettingsPageWrapper';
import {
  Attention,
  CheckOne,
  CloseOne,
  CloseSmall,
  Compression,
  FilePdf,
  FolderClose,
  FolderOpen,
  Gift,
  ListCheckbox,
  LoadingOne,
  Music,
  MusicOne,
  Picture,
  PlayOne,
  Right,
  Shield,
  UploadOne,
  Video,
} from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './workbench.css';

type EngineKind = 'builtin' | 'ffmpeg' | 'office';
type FormatJob = {
  id: string;
  label: string;
  fileName: string;
  status: WinkGoFormatConversionProgress['status'];
  progress: number;
  message: string;
  outputPath: string | null;
};

type FormatPresetDefinition = {
  id: WinkGoFormatPreset;
  title: string;
  subtitle: string;
  description: string;
  extensions: readonly string[];
  engine: EngineKind;
  accent: string;
  featured?: boolean;
  icon: (size: number) => React.ReactNode;
};

const PRESETS: FormatPresetDefinition[] = [
  {
    id: 'ncm_to_mp3',
    title: 'NCM 转 MP3',
    subtitle: '网易云本地音频',
    description: '识别 NCM 内部音轨并导出为通用 MP3；FLAC 音轨会进行真实转码。',
    extensions: ['ncm'],
    engine: 'builtin',
    accent: '#7b61ff',
    featured: true,
    icon: (size) => <Music theme='outline' size={size} fill='currentColor' />,
  },
  {
    id: 'video_to_mp4',
    title: '视频转 MP4',
    subtitle: '兼容常见播放器',
    description: '将 MKV、MOV、AVI、WebM 等视频转换为通用 MP4。',
    extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'ts'],
    engine: 'ffmpeg',
    accent: '#3478f6',
    icon: (size) => <Video theme='outline' size={size} fill='currentColor' />,
  },
  {
    id: 'video_compress',
    title: '视频压缩',
    subtitle: '减小分享体积',
    description: '采用均衡压缩参数减小体积，并保留常见设备兼容性。',
    extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'ts'],
    engine: 'ffmpeg',
    accent: '#12a77b',
    icon: (size) => <Compression theme='outline' size={size} fill='currentColor' />,
  },
  {
    id: 'gif_compress',
    title: 'GIF 压缩',
    subtitle: '限制尺寸和帧率',
    description: '将 GIF 控制到适合聊天和网页使用的尺寸与帧率。',
    extensions: ['gif'],
    engine: 'ffmpeg',
    accent: '#f28b32',
    icon: (size) => <Gift theme='outline' size={size} fill='currentColor' />,
  },
  {
    id: 'audio_to_mp3',
    title: '音频转 MP3',
    subtitle: 'FLAC / WAV / M4A',
    description: '把常用音频格式统一转为高质量 MP3，适合分享与归档。',
    extensions: ['wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'mp3'],
    engine: 'ffmpeg',
    accent: '#e35d78',
    icon: (size) => <MusicOne theme='outline' size={size} fill='currentColor' />,
  },
  {
    id: 'image_compress',
    title: '图片压缩',
    subtitle: '输出清晰 JPG',
    description: '压缩 PNG、JPG、WebP、BMP 和 TIFF，输出清晰易分享的 JPG。',
    extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'tif', 'tiff'],
    engine: 'ffmpeg',
    accent: '#1b9bd7',
    icon: (size) => <Picture theme='outline' size={size} fill='currentColor' />,
  },
  {
    id: 'document_to_pdf',
    title: '文档转 PDF',
    subtitle: 'Word / Excel / PPT',
    description: '通过本机 WPS Office 或 LibreOffice 转换为 PDF，原文件不会被修改。',
    extensions: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'],
    engine: 'office',
    accent: '#d46b3d',
    icon: (size) => <FilePdf theme='outline' size={size} fill='currentColor' />,
  },
];

const EMPTY_ENGINES: WinkGoFormatEngineStatus = {
  ffmpegAvailable: false,
  ffmpegPath: null,
  officeAvailable: false,
  officePath: null,
  officeEngine: null,
  ncmAvailable: true,
};

const fileName = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath;
const extensionOf = (filePath: string): string => fileName(filePath).split('.').pop()?.toLowerCase() || '';

const accentStyle = (accent: string): React.CSSProperties => ({ '--format-accent': accent }) as React.CSSProperties;

const FormatStudioPage: React.FC = () => {
  const navigate = useNavigate();
  const [selectedPresetId, setSelectedPresetId] = useState<WinkGoFormatPreset>('ncm_to_mp3');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [outputFolder, setOutputFolder] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackIsError, setFeedbackIsError] = useState(false);
  const [jobs, setJobs] = useState<FormatJob[]>([]);
  const [engines, setEngines] = useState<WinkGoFormatEngineStatus>(EMPTY_ENGINES);

  const selectedPreset = useMemo(
    () => PRESETS.find((preset) => preset.id === selectedPresetId) ?? PRESETS[0],
    [selectedPresetId]
  );

  const presetAvailable = useCallback(
    (preset: FormatPresetDefinition): boolean =>
      preset.engine === 'builtin'
        ? engines.ncmAvailable
        : preset.engine === 'ffmpeg'
          ? engines.ffmpegAvailable
          : engines.officeAvailable,
    [engines]
  );

  const currentEngineAvailable = presetAvailable(selectedPreset);
  const availableToolCount = PRESETS.filter(presetAvailable).length;
  const selectedFilesSummary =
    selectedFiles.slice(0, 3).map(fileName).join('、') +
    (selectedFiles.length > 3 ? ` 等 ${selectedFiles.length} 个` : '');
  const canStart = !running && currentEngineAvailable && selectedFiles.length > 0 && Boolean(outputFolder);

  const currentEngineLabel =
    selectedPreset.engine === 'builtin'
      ? engines.ffmpegAvailable
        ? 'NCM + FFmpeg 就绪'
        : 'NCM 解包已就绪'
      : selectedPreset.engine === 'ffmpeg'
        ? engines.ffmpegAvailable
          ? 'FFmpeg 已就绪'
          : 'FFmpeg 未安装'
        : engines.officeAvailable
          ? `${engines.officeEngine ?? 'Office'} 已就绪`
          : '未检测到办公转换引擎';

  const unavailableHint =
    selectedPreset.engine === 'office' ? '安装 WPS Office 或 LibreOffice 后即可使用' : '未检测到 FFmpeg 转换引擎';

  const setPageFeedback = (message: string, isError = false): void => {
    setFeedback(message);
    setFeedbackIsError(isError);
  };

  const addFiles = useCallback(
    (paths: string[]): void => {
      const accepted: string[] = [];
      let rejected = 0;
      for (const candidate of paths) {
        if (selectedPreset.extensions.includes(extensionOf(candidate))) accepted.push(candidate);
        else rejected += 1;
      }
      setSelectedFiles((current) => Array.from(new Set([...current, ...accepted])).slice(0, 64));
      if (accepted.length && rejected) {
        setPageFeedback(`已加入 ${accepted.length} 个文件，忽略 ${rejected} 个格式不匹配的文件`);
      } else if (accepted.length) {
        setPageFeedback(`已加入 ${accepted.length} 个文件`);
      } else if (rejected) {
        setPageFeedback('这些文件与当前转换工具不匹配', true);
      }
    },
    [selectedPreset.extensions]
  );

  const upsertProgress = useCallback((payload: WinkGoFormatConversionProgress): void => {
    const id = `${payload.jobId}:${payload.index}`;
    setJobs((current) => {
      const existingIndex = current.findIndex((job) => job.id === id);
      if (existingIndex < 0) {
        const preset = PRESETS.find((item) => item.id === payload.preset);
        return [
          {
            id,
            label: preset?.title ?? '格式转换',
            fileName: payload.fileName,
            status: payload.status,
            progress: Math.min(100, payload.percent),
            message: payload.message,
            outputPath: payload.outputPath,
          },
          ...current,
        ].slice(0, 12);
      }
      const next = [...current];
      const existing = next[existingIndex];
      next[existingIndex] = {
        ...existing,
        status: payload.status,
        progress: Math.max(existing.progress, Math.min(100, payload.percent)),
        message: payload.message,
        outputPath: payload.outputPath ?? existing.outputPath,
      };
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = ipcBridge.winkGoFormat.progress.on(upsertProgress);
    void Promise.all([
      ipcBridge.winkGoFormat.detectEngines.invoke(),
      ipcBridge.winkGoFormat.getDefaultOutputFolder.invoke(),
    ]).then(([detectedEngines, defaultFolder]) => {
      if (cancelled) return;
      setEngines(detectedEngines);
      setOutputFolder(localStorage.getItem('winkgo_format_output_folder') || defaultFolder);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [upsertProgress]);

  const selectPreset = (preset: FormatPresetDefinition): void => {
    setSelectedPresetId(preset.id);
    setSelectedFiles((current) => {
      const accepted = current.filter((candidate) => preset.extensions.includes(extensionOf(candidate)));
      const removed = current.length - accepted.length;
      if (!presetAvailable(preset)) {
        setPageFeedback(
          preset.engine === 'office' ? '安装 WPS Office 或 LibreOffice 后即可使用' : '未检测到 FFmpeg 转换引擎',
          true
        );
      } else if (removed) {
        setPageFeedback(`已移除 ${removed} 个不匹配的文件`);
      } else {
        setPageFeedback('');
      }
      return accepted;
    });
  };

  const selectFiles = async (): Promise<void> => {
    if (!currentEngineAvailable || running) return;
    const paths = await ipcBridge.winkGoFormat.selectFiles.invoke({ preset: selectedPreset.id });
    addFiles(paths);
  };

  const chooseOutputFolder = async (): Promise<void> => {
    const selected = await ipcBridge.winkGoFormat.chooseOutputFolder.invoke({
      defaultPath: outputFolder || undefined,
    });
    if (!selected) return;
    setOutputFolder(selected);
    localStorage.setItem('winkgo_format_output_folder', selected);
  };

  const openOutput = (targetPath: string): void => {
    void ipcBridge.winkGoFormat.openOutput.invoke({ path: targetPath });
  };

  const startConversion = async (): Promise<void> => {
    if (!canStart) return;
    setRunning(true);
    setPageFeedback('任务已开始，转换只在本机运行');
    const jobId = `format-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const report = await ipcBridge.winkGoFormat.startConversion.invoke({
        jobId,
        preset: selectedPreset.id,
        paths: [...selectedFiles],
        outputFolder,
      });
      if (report.error) {
        setPageFeedback(report.error, true);
        return;
      }
      const successCount = report.items.filter((item) => item.success).length;
      const failedItems = report.items.filter((item) => !item.success);
      if (successCount) {
        setPageFeedback(
          `已完成 ${successCount} 个${failedItems.length ? `，${failedItems.length} 个失败` : ''}`,
          failedItems.length > 0
        );
        setSelectedFiles(failedItems.map((item) => item.sourcePath));
      } else {
        setPageFeedback(report.items[0]?.message || '转换失败，请查看任务进度', true);
      }
    } finally {
      setRunning(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    if (!currentEngineAvailable || running) return;
    const getPathForFile = window.electronAPI?.getPathForFile;
    if (!getPathForFile) return;
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => {
        try {
          return getPathForFile(file);
        } catch {
          return '';
        }
      })
      .filter(Boolean);
    addFiles(paths);
  };

  return (
    <SettingsPageWrapper className='winkgo-format-page' contentClassName='md:max-w-none!'>
      <section className='winkgo-format-workbench' data-testid='format-workbench'>
        <header className='winkgo-format-heading'>
          <div>
            <span>WINK GO 工具箱</span>
            <h1>格式工作台</h1>
            <p>媒体、图片与办公文档统一处理，任务只在本机运行。</p>
          </div>
          <button type='button' className='winkgo-format-back' onClick={() => void navigate('/guid')}>
            返回主页
          </button>
        </header>

        <div className='winkgo-format-shell'>
          <aside className='winkgo-format-tool-rail'>
            <div className='winkgo-format-rail-title'>
              <strong>选择工具</strong>
              <small>
                {availableToolCount}/{PRESETS.length} 项可用
              </small>
            </div>
            {PRESETS.map((preset) => {
              const available = presetAvailable(preset);
              return (
                <button
                  key={preset.id}
                  type='button'
                  className={`winkgo-format-tool ${preset.id === selectedPresetId ? 'is-active' : ''} ${
                    available ? '' : 'is-unavailable'
                  }`}
                  style={accentStyle(preset.accent)}
                  onClick={() => selectPreset(preset)}
                  data-testid={`format-tool-${preset.id}`}
                >
                  <span className='winkgo-format-tool-icon'>{preset.icon(19)}</span>
                  <span className='winkgo-format-tool-copy'>
                    <strong>{preset.title}</strong>
                    <small>{preset.subtitle}</small>
                  </span>
                  {preset.featured ? (
                    <i>新增</i>
                  ) : available ? (
                    <Right theme='outline' size='15' fill='currentColor' />
                  ) : (
                    <Shield theme='outline' size='14' fill='currentColor' />
                  )}
                </button>
              );
            })}
          </aside>

          <main className='winkgo-format-conversion'>
            <header className='winkgo-format-conversion-title' style={accentStyle(selectedPreset.accent)}>
              <span className='winkgo-format-current-icon'>{selectedPreset.icon(24)}</span>
              <div>
                <div>
                  <h2>{selectedPreset.title}</h2>
                  <span className={`winkgo-format-engine-pill ${currentEngineAvailable ? 'is-ready' : ''}`}>
                    {currentEngineLabel}
                  </span>
                </div>
                <p>{selectedPreset.description}</p>
              </div>
            </header>

            <button
              type='button'
              className={`winkgo-format-drop-zone ${dropActive ? 'is-dragging' : ''} ${
                selectedFiles.length ? 'has-files' : ''
              } ${currentEngineAvailable ? '' : 'is-disabled'}`}
              disabled={!currentEngineAvailable || running}
              onClick={() => void selectFiles()}
              onDragEnter={(event) => {
                event.preventDefault();
                setDropActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={handleDrop}
              data-testid='format-drop-zone'
            >
              <span className='winkgo-format-drop-icon'>
                <UploadOne theme='outline' size='25' fill='currentColor' />
              </span>
              {selectedFiles.length === 0 ? (
                <span className='winkgo-format-drop-copy'>
                  <strong>{currentEngineAvailable ? '拖入文件，或点击选择' : unavailableHint}</strong>
                  <small>
                    支持 {selectedPreset.extensions.map((extension) => extension.toUpperCase()).join('、')} · 单次最多
                    64 个
                  </small>
                </span>
              ) : (
                <>
                  <span className='winkgo-format-drop-copy'>
                    <strong>已加入 {selectedFiles.length} 个文件</strong>
                    <small>{selectedFilesSummary}</small>
                  </span>
                  <span className='winkgo-format-add-more'>继续添加</span>
                </>
              )}
            </button>

            {selectedFiles.length > 0 && (
              <div className='winkgo-format-selected-files'>
                <div className='winkgo-format-selected-heading'>
                  <strong>待处理文件</strong>
                  <button
                    type='button'
                    disabled={running}
                    onClick={() => {
                      setSelectedFiles([]);
                      setPageFeedback('');
                    }}
                  >
                    清空
                  </button>
                </div>
                <div className='winkgo-format-selected-track'>
                  {selectedFiles.map((candidate) => (
                    <div className='winkgo-format-file-chip' key={candidate} title={candidate}>
                      <span>{selectedPreset.icon(15)}</span>
                      <strong>{fileName(candidate)}</strong>
                      <button
                        type='button'
                        disabled={running}
                        aria-label={`移除 ${fileName(candidate)}`}
                        onClick={() => setSelectedFiles((current) => current.filter((item) => item !== candidate))}
                      >
                        <CloseSmall theme='outline' size='13' fill='currentColor' />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className='winkgo-format-output-row'>
              <span className='winkgo-format-output-icon'>
                <FolderClose theme='outline' size='18' fill='currentColor' />
              </span>
              <span className='winkgo-format-output-copy'>
                <strong>输出位置</strong>
                <small title={outputFolder}>{outputFolder || '正在准备默认目录…'}</small>
              </span>
              <button type='button' disabled={running} onClick={() => void chooseOutputFolder()}>
                更改
              </button>
              <button
                type='button'
                className='winkgo-format-icon-button'
                disabled={!outputFolder}
                title='打开输出目录'
                onClick={() => openOutput(outputFolder)}
              >
                <FolderOpen theme='outline' size='16' fill='currentColor' />
              </button>
            </div>

            {selectedPreset.id === 'ncm_to_mp3' && (
              <div className='winkgo-format-legal-note'>
                <Shield theme='outline' size='17' fill='currentColor' />
                <span>
                  <strong>仅处理你拥有或已获授权的本地音频</strong>
                  <small>NCM 会先安全解包；内嵌 FLAC 时再真转码为 MP3。</small>
                </span>
              </div>
            )}

            {feedback && (
              <div className={`winkgo-format-feedback ${feedbackIsError ? 'is-error' : ''}`}>
                {feedbackIsError ? (
                  <Attention theme='outline' size='16' fill='currentColor' />
                ) : (
                  <CheckOne theme='outline' size='16' fill='currentColor' />
                )}
                {feedback}
              </div>
            )}

            <div className='winkgo-format-actions'>
              <span className='winkgo-format-actions-summary'>
                {selectedFiles.length ? `准备处理 ${selectedFiles.length} 个文件` : '文件不会上传到云端'}
              </span>
              <button
                type='button'
                className='winkgo-format-primary'
                disabled={!canStart}
                onClick={() => void startConversion()}
                data-testid='format-start'
                aria-label={running ? '正在转换' : '开始转换'}
              >
                {running ? (
                  <LoadingOne className='winkgo-format-spinning' theme='outline' size='17' fill='currentColor' />
                ) : (
                  <PlayOne theme='filled' size='16' fill='currentColor' />
                )}
                {running ? '正在转换' : '开始转换'}
              </button>
            </div>
          </main>

          <aside className='winkgo-format-task-panel'>
            <div className='winkgo-format-task-heading'>
              <div>
                <strong>任务进度</strong>
                <small>最近 {jobs.length} 个任务</small>
              </div>
              <span>
                <FolderClose theme='outline' size='13' fill='currentColor' />
                本地处理
              </span>
            </div>

            {jobs.length ? (
              <div className='winkgo-format-task-list'>
                {jobs.map((job) => (
                  <article key={job.id} className={`winkgo-format-task-card is-${job.status}`}>
                    <div className='winkgo-format-task-card-title'>
                      <span>
                        {job.status === 'running' ? (
                          <LoadingOne
                            className='winkgo-format-spinning'
                            theme='outline'
                            size='17'
                            fill='currentColor'
                          />
                        ) : job.status === 'completed' ? (
                          <CheckOne theme='outline' size='17' fill='currentColor' />
                        ) : (
                          <CloseOne theme='outline' size='17' fill='currentColor' />
                        )}
                      </span>
                      <div>
                        <strong>{job.label}</strong>
                        <small title={job.fileName}>{job.fileName}</small>
                      </div>
                      <em>{job.progress}%</em>
                    </div>
                    <div className='winkgo-format-task-progress'>
                      <i style={{ width: `${job.progress}%` }} />
                    </div>
                    <div className='winkgo-format-task-detail'>
                      <span>{job.message}</span>
                      {job.outputPath && (
                        <button type='button' onClick={() => openOutput(job.outputPath!)}>
                          打开目录
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className='winkgo-format-task-empty'>
                <span>
                  <ListCheckbox theme='outline' size='25' fill='currentColor' />
                </span>
                <strong>还没有转换任务</strong>
                <p>选择左侧工具并添加文件，进度和结果会显示在这里，也会同步到灵动岛。</p>
              </div>
            )}

            <div className='winkgo-format-engine-status'>
              <strong>本机引擎</strong>
              <div>
                <span>
                  <i className='is-ready' />
                  NCM 安全解包
                </span>
                <em>已内置</em>
              </div>
              <div>
                <span>
                  <i className={engines.ffmpegAvailable ? 'is-ready' : ''} />
                  媒体转换
                </span>
                {engines.ffmpegAvailable ? (
                  <em>FFmpeg 就绪</em>
                ) : (
                  <button
                    type='button'
                    onClick={() => void ipcBridge.shell.openExternal.invoke('https://ffmpeg.org/download.html')}
                  >
                    获取 FFmpeg
                  </button>
                )}
              </div>
              <div>
                <span>
                  <i className={engines.officeAvailable ? 'is-ready' : ''} />
                  办公文档
                </span>
                {engines.officeAvailable ? (
                  <em>{engines.officeEngine} 就绪</em>
                ) : (
                  <button
                    type='button'
                    onClick={() =>
                      void ipcBridge.shell.openExternal.invoke(
                        'https://www.libreoffice.org/download/download-libreoffice/'
                      )
                    }
                  >
                    获取 LibreOffice
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>
      </section>
    </SettingsPageWrapper>
  );
};

export default FormatStudioPage;
