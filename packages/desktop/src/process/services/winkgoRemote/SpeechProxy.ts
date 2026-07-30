/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_SPEECH_TEXT_LENGTH = 6_000;
// Base64 adds roughly 33%; keep the final relay frame below its 4 MB limit.
const MAX_SPEECH_OUTPUT_BYTES = 2_900_000;

const cleanSpeechText = (value: string): string =>
  value
    .trim()
    .replace(/\p{Cc}/gu, '')
    .slice(0, MAX_SPEECH_TEXT_LENGTH);

const runPowerShellEncoded = async (script: string, timeoutMs = 120_000): Promise<void> => {
  if (process.platform !== 'win32') {
    throw new Error('当前系统不支持 WINK GO 本地语音代理。');
  }
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  await new Promise<void>((resolve, reject) => {
    execFile(
      executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        reject(new Error(String(stderr || stdout || error.message || 'WINK GO 本地语音代理执行失败。').trim()));
      }
    );
  });
};

export const synthesizeWinkGoSpeechProxyWav = async (sourceText: string): Promise<string> => {
  const value = cleanSpeechText(sourceText);
  if (!value) throw new Error('没有收到需要应用的人格提示。');

  const speechDirectory = path.join(os.tmpdir(), 'winkgo-remote-speech');
  await fs.mkdir(speechDirectory, { recursive: true });
  const outputPath = path.join(speechDirectory, `persona-${Date.now()}-${randomBytes(6).toString('hex')}.wav`);
  const textBase64 = Buffer.from(value, 'utf8').toString('base64');
  const pathBase64 = Buffer.from(outputPath, 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${textBase64}'))
$outputPath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${pathBase64}'))
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 1
$synth.Volume = 100
$voice = $synth.GetInstalledVoices() |
  Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh*' } |
  Select-Object -First 1
if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }
$synth.SetOutputToWaveFile($outputPath)
$synth.Speak($text)
$synth.Dispose()
`;

  try {
    await runPowerShellEncoded(script);
    const bytes = await fs.readFile(outputPath);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_SPEECH_OUTPUT_BYTES) {
      throw new Error('WINK GO 本地语音代理生成的音频无效。');
    }
    return bytes.toString('base64');
  } finally {
    await fs.rm(outputPath, { force: true }).catch((): undefined => undefined);
  }
};
