/**
 * Real Windows E2E coverage for WINK GO desktop automation recording.
 *
 * The test records real injected mouse input against Windows Calculator,
 * persists the workflow as a local desktop Skill, then replays the saved
 * workflow through the bundled Runtime and verifies the Calculator result.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '../../fixtures';
import { goToGuid } from '../../helpers';

process.env.WINKGO_BUNDLED_RUNTIME_DIR = 'D:\\winkgo\\winkgo-app\\bundled-runtime';
process.env.WINKGO_DESKTOP_RECORDER_ACCEPT_INJECTED_FOR_TESTS = '1';
process.env.WINKGO_E2E_DESKTOP_ISLAND = '1';

const SKILL_NAME = 'E2E 计算器 7 加 8';
const ARTIFACT_ROOT = 'D:\\WINK GO AGENT\\设计与文档\\测试报告\\2026-08-13-电脑自动化真实流程';

const runPowerShell = (script: string): string =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    timeout: 45_000,
  }).trim();

const automationPreamble = String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ('WinkGoE2EMouse' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WinkGoE2EMouse {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
  }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {
    public uint type;
    public INPUTUNION U;
  }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
  public static void Click() {
    var inputs = new INPUT[2];
    inputs[0].type = 0;
    inputs[0].U.mi.dwFlags = 0x0002;
    inputs[1].type = 0;
    inputs[1].U.mi.dwFlags = 0x0004;
    var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Length) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$resultCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
  'CalculatorResults'
)
$calculator = $null
foreach ($window in $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
  if ($window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $resultCondition)) {
    $calculator = $window
    break
  }
}
if (-not $calculator) { throw 'Windows Calculator window not found' }
`;

const startCalculator = (): void => {
  runPowerShell(String.raw`
$existingHosts = Get-Process ApplicationFrameHost -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match '计算器|Calculator' }
if ($existingHosts) { $existingHosts | Stop-Process -Force }
Get-Process CalculatorApp -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 700
Start-Process 'calculator:'
$deadline = (Get-Date).AddSeconds(25)
do {
  Start-Sleep -Milliseconds 250
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
    'CalculatorResults'
  )
  $calculator = $null
  foreach ($window in $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
    if ($window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
      $calculator = $window
      break
    }
  }
} until ($calculator -or (Get-Date) -ge $deadline)
if (-not $calculator) { throw 'Windows Calculator did not become ready' }
`);
};

const invokeCalculatorButton = (automationId: string): void => {
  runPowerShell(`${automationPreamble}
$condition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
  '${automationId}'
)
$button = $calculator.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
if (-not $button) { throw 'Calculator button not found: ${automationId}' }
$invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
Start-Sleep -Milliseconds 200
`);
};

const clickCalculatorButtons = (automationIds: string[], expectedInitialResult = '0'): void => {
  const ids = automationIds.map((id) => `'${id}'`).join(',');
  runPowerShell(`${automationPreamble}
[WinkGoE2EMouse]::SetForegroundWindow([IntPtr]$calculator.Current.NativeWindowHandle) | Out-Null
$calculatorHwnd = [IntPtr]$calculator.Current.NativeWindowHandle
[WinkGoE2EMouse]::ShowWindowAsync($calculatorHwnd, 9) | Out-Null
[WinkGoE2EMouse]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[WinkGoE2EMouse]::BringWindowToTop($calculatorHwnd) | Out-Null
[WinkGoE2EMouse]::SetForegroundWindow($calculatorHwnd) | Out-Null
[WinkGoE2EMouse]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 750
if ([WinkGoE2EMouse]::GetForegroundWindow() -ne $calculatorHwnd) {
  throw "Calculator could not become the foreground window for real input recording."
}
$initialResult = $calculator.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $resultCondition).Current.Name
if ($initialResult -notmatch '${expectedInitialResult}') {
  throw "Unexpected Calculator target before click injection: $initialResult"
}
foreach ($automationId in @(${ids})) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
    $automationId
  )
  $button = $calculator.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
  if (-not $button) { throw "Calculator button not found: $automationId" }
  $rect = $button.Current.BoundingRectangle
  $x = [int]($rect.X + ($rect.Width / 2))
  $y = [int]($rect.Y + ($rect.Height / 2))
  [WinkGoE2EMouse]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 100
  [WinkGoE2EMouse]::Click()
  Start-Sleep -Milliseconds 400
}
`);
};

const calculatorResult = (): string =>
  runPowerShell(`${automationPreamble}
$result = $calculator.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $resultCondition)
$result.Current.Name
`);

const resolveDesktopIsland = async (electronApp: ElectronApplication): Promise<Page> => {
  let islandPage: Page | undefined;
  await expect
    .poll(
      async () => {
        islandPage = electronApp.windows().find((window) => window.url().includes('#/desktop-island'));
        return Boolean(islandPage && !islandPage.isClosed());
      },
      { timeout: 20_000, message: 'Waiting for the standalone WINK GO desktop island window' }
    )
    .toBe(true);
  if (!islandPage) throw new Error('Standalone WINK GO desktop island window was not created.');
  await expect(islandPage.getByTestId('titlebar-dynamic-island')).toBeVisible({ timeout: 15_000 });
  return islandPage;
};

const openDesktopRecorder = async (electronApp: ElectronApplication): Promise<Page> => {
  const islandPage = await resolveDesktopIsland(electronApp);
  const island = islandPage.getByTestId('titlebar-dynamic-island');
  const recorderPanel = islandPage.getByTestId('titlebar-dynamic-island-desktopSkill-panel');
  if (!(await recorderPanel.isVisible())) {
    await island.locator('.titlebar-dynamic-island__alarm').click();
    await expect(islandPage.getByTestId('titlebar-dynamic-island-tools-panel')).toBeVisible({ timeout: 10_000 });
    await island.locator('button[data-tool="desktopSkill"]').click();
  }
  await expect(recorderPanel).toBeVisible({ timeout: 15_000 });
  return islandPage;
};

test.describe('Desktop automation recorder', () => {
  test('records, saves and replays a real Calculator workflow without crashing WINK GO', async ({
    electronApp,
    page,
  }) => {
    test.setTimeout(180_000);
    fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
    startCalculator();
    invokeCalculatorButton('clearButton');
    expect(calculatorResult()).toContain('0');

    // Prove the physical-input seam before WINK GO installs recorder hooks.
    // This separates a Windows/DPI/Calculator targeting failure from a
    // recorder regression and keeps the subsequent assertion meaningful.
    clickCalculatorButtons(['num7Button', 'plusButton', 'num8Button', 'equalButton']);
    expect(calculatorResult()).toContain('15');
    invokeCalculatorButton('clearButton');
    expect(calculatorResult()).toContain('0');

    await goToGuid(page);
    const islandPage = await openDesktopRecorder(electronApp);
    const recorderPanel = islandPage.getByTestId('titlebar-dynamic-island-desktopSkill-panel');
    await recorderPanel.getByRole('button', { name: /Start recording|开始录制/i }).click();
    await expect
      .poll(
        async () =>
          (await recorderPanel.isVisible())
            ? `visible: ${String(await recorderPanel.textContent())
                .replace(/\s+/g, ' ')
                .trim()}`
            : 'hidden',
        { timeout: 45_000, message: 'Waiting for one-click recording to lock a safe external window' }
      )
      .toBe('hidden');

    await expect
      .poll(() => electronApp.windows().some((window) => window.url().includes('automation-overlay')), {
        timeout: 15_000,
        message: 'Waiting for the WINK GO computer-control border',
      })
      .toBe(true);
    const overlay = electronApp.windows().find((window) => window.url().includes('automation-overlay'));
    if (!overlay) throw new Error('WINK GO computer-control border window was not created.');

    clickCalculatorButtons(['num7Button', 'plusButton', 'num8Button', 'equalButton']);
    await expect.poll(calculatorResult, { timeout: 10_000 }).toContain('15');
    await overlay.screenshot({ path: path.join(ARTIFACT_ROOT, '01-recording-control-border.png') });

    await openDesktopRecorder(electronApp);
    await expect(recorderPanel.locator('.winkgo-desktop-recorder__status')).toHaveAttribute('data-phase', 'recording');
    await expect
      .poll(async () =>
        Number(await recorderPanel.locator('.winkgo-desktop-recorder__status').getAttribute('data-step-count'))
      )
      .toBeGreaterThanOrEqual(4);
    const captureInputs = recorderPanel.locator('.winkgo-desktop-recorder__capture input');
    await captureInputs.nth(0).fill(SKILL_NAME);
    await captureInputs.nth(1).fill('真实 Windows 计算器录制、持久化和确定性回放验收');
    await recorderPanel.screenshot({ path: path.join(ARTIFACT_ROOT, '02-recorded-steps.png') });
    await recorderPanel.getByRole('button', { name: /Stop and save|停止并保存|Save Skill|保存.*技能/i }).click();

    const savedSkill = recorderPanel
      .locator('.winkgo-desktop-recorder__skills article')
      .filter({ hasText: SKILL_NAME });
    await expect(savedSkill).toBeVisible({ timeout: 20_000 });
    await recorderPanel.screenshot({ path: path.join(ARTIFACT_ROOT, '03-saved-desktop-skill.png') });

    const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const profileRoot = path.join(userDataPath, 'winkgo-desktop-skills', 'profiles', 'local');
    const registry = JSON.parse(fs.readFileSync(path.join(profileRoot, 'registry.json'), 'utf8')) as {
      skills: Array<{ id: string; name: string }>;
    };
    const registrySkill = registry.skills.find((skill) => skill.name === SKILL_NAME);
    expect(registrySkill).toBeTruthy();
    const skillRoot = path.join(profileRoot, 'skills', registrySkill?.id || 'missing');
    for (const filename of ['SKILL.md', 'manifest.json', 'workflow.json', 'trace.json', 'meta.json']) {
      expect(fs.existsSync(path.join(skillRoot, filename)), `Missing persisted desktop Skill file: ${filename}`).toBe(
        true
      );
    }
    const workflowText = fs.readFileSync(path.join(skillRoot, 'workflow.json'), 'utf8');
    expect(workflowText).not.toMatch(/password|token|secret/i);

    invokeCalculatorButton('clearButton');
    expect(calculatorResult()).toContain('0');
    await savedSkill.getByRole('button', { name: /Run Skill|运行技能|运行/i }).click();
    await expect.poll(calculatorResult, { timeout: 45_000 }).toContain('15');
    await expect(recorderPanel.locator('.winkgo-desktop-recorder__feedback')).toContainText(/完成|completed/i, {
      timeout: 15_000,
    });
    await islandPage.screenshot({ path: path.join(ARTIFACT_ROOT, '04-replay-completed.png') });

    await expect.poll(() => electronApp.evaluate(() => true), { timeout: 5_000 }).toBe(true);
    const processSnapshot = await electronApp.evaluate(({ app }) => ({
      pid: process.pid,
      userData: app.getPath('userData'),
      version: app.getVersion(),
    }));
    fs.writeFileSync(
      path.join(ARTIFACT_ROOT, 'e2e-result.json'),
      `${JSON.stringify(
        {
          ok: true,
          workflow: 'Windows Calculator: 7 + 8 = 15',
          savedSkillId: registrySkill?.id,
          stepFiles: ['SKILL.md', 'manifest.json', 'workflow.json', 'trace.json', 'meta.json'],
          process: processSnapshot,
        },
        null,
        2
      )}\n`,
      'utf8'
    );
  });
});
