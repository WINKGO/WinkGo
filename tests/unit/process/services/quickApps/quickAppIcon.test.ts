import { describe, expect, it, vi } from 'vitest';
import { loadQuickAppIconDataUrl, type QuickAppIconImage } from '@process/services/quickApps/quickAppIcon';

const image = (dataUrl: string): QuickAppIconImage => ({
  isEmpty: () => dataUrl.length === 0,
  resize: () => image(dataUrl),
  toDataURL: () => dataUrl,
});

describe('loadQuickAppIconDataUrl', () => {
  it('uses the icon declared by a Windows shortcut and expands environment variables', async () => {
    const getFileIcon = vi.fn(async () => image(''));
    const createImageFromPath = vi.fn((candidate: string) =>
      candidate === 'C:\\Users\\Tester\\AppData\\Local\\Acme\\acme.ico'
        ? image('data:image/png;base64,shortcut-icon')
        : image('')
    );

    const result = await loadQuickAppIconDataUrl('C:\\Users\\Tester\\Desktop\\Acme.lnk', {
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local' },
      readShortcutLink: () => ({
        icon: '%LOCALAPPDATA%\\Acme\\acme.ico',
        target: 'C:\\Program Files\\Acme\\Acme.exe',
      }),
      createImageFromPath,
      getFileIcon,
    });

    expect(result).toBe('data:image/png;base64,shortcut-icon');
    expect(createImageFromPath).toHaveBeenCalledWith('C:\\Users\\Tester\\AppData\\Local\\Acme\\acme.ico');
  });

  it('falls back from an empty shortcut icon to the target executable icon', async () => {
    const getFileIcon = vi.fn(async (candidate: string) =>
      candidate === 'C:\\Program Files\\Acme\\Acme.exe' ? image('data:image/png;base64,target-icon') : image('')
    );

    const result = await loadQuickAppIconDataUrl('C:\\Users\\Tester\\Desktop\\Acme.lnk', {
      platform: 'win32',
      env: {},
      readShortcutLink: () => ({
        icon: 'C:\\Missing\\Acme.ico',
        target: 'C:\\Program Files\\Acme\\Acme.exe',
      }),
      createImageFromPath: () => image(''),
      getFileIcon,
    });

    expect(result).toBe('data:image/png;base64,target-icon');
    expect(getFileIcon).toHaveBeenCalledWith('C:\\Program Files\\Acme\\Acme.exe');
  });

  it('strips a Windows icon resource index and asks the shell for executable artwork first', async () => {
    const getFileIcon = vi.fn(async (candidate: string) =>
      candidate === 'C:\\Program Files\\Acme\\Acme.exe' ? image('data:image/png;base64,embedded-app-icon') : image('')
    );
    const createImageFromPath = vi.fn(() => image('data:image/png;base64,generic-file-icon'));

    const result = await loadQuickAppIconDataUrl('C:\\Users\\Tester\\Desktop\\Acme.lnk', {
      platform: 'win32',
      env: {},
      readShortcutLink: () => ({
        icon: '"C:\\Program Files\\Acme\\Acme.exe",0',
        target: 'C:\\Program Files\\Acme\\Acme.exe',
      }),
      createImageFromPath,
      getFileIcon,
    });

    expect(result).toBe('data:image/png;base64,embedded-app-icon');
    expect(getFileIcon).toHaveBeenCalledWith('C:\\Program Files\\Acme\\Acme.exe');
    expect(createImageFromPath).not.toHaveBeenCalled();
  });

  it('prefers the Windows shell for an executable selected directly', async () => {
    const getFileIcon = vi.fn(async () => image('data:image/png;base64,embedded-app-icon'));
    const createImageFromPath = vi.fn(() => image('data:image/png;base64,generic-file-icon'));

    const result = await loadQuickAppIconDataUrl('C:\\Program Files\\Acme\\Acme.exe', {
      platform: 'win32',
      env: {},
      readShortcutLink: () => ({}),
      createImageFromPath,
      getFileIcon,
    });

    expect(result).toBe('data:image/png;base64,embedded-app-icon');
    expect(getFileIcon).toHaveBeenCalledWith('C:\\Program Files\\Acme\\Acme.exe');
    expect(createImageFromPath).not.toHaveBeenCalled();
  });

  it('uses a directly extracted PE resource instead of a generic cached Shell icon', async () => {
    const extractExecutableIconDataUrl = vi.fn(async () => 'data:image/png;base64,real-pe-icon');
    const getFileIcon = vi.fn(async () => image('data:image/png;base64,generic-shell-icon'));
    const createImageFromPath = vi.fn(() => image('data:image/png;base64,generic-file-icon'));

    const result = await loadQuickAppIconDataUrl('C:\\Program Files\\Acme\\Acme.exe', {
      platform: 'win32',
      env: {},
      extractExecutableIconDataUrl,
      readShortcutLink: () => ({}),
      createImageFromPath,
      getFileIcon,
    });

    expect(result).toBe('data:image/png;base64,real-pe-icon');
    expect(extractExecutableIconDataUrl).toHaveBeenCalledWith('C:\\Program Files\\Acme\\Acme.exe');
    expect(getFileIcon).not.toHaveBeenCalled();
    expect(createImageFromPath).not.toHaveBeenCalled();
  });

  it('reads executable icons directly and rejects oversized image payloads', async () => {
    const oversized = `data:image/png;base64,${'a'.repeat(1024 * 1024)}`;
    const getFileIcon = vi
      .fn()
      .mockResolvedValueOnce(image(oversized))
      .mockResolvedValueOnce(image('data:image/png;base64,fallback-icon'));

    const result = await loadQuickAppIconDataUrl('C:\\Program Files\\Acme\\Acme.exe', {
      platform: 'win32',
      env: {},
      readShortcutLink: () => ({}),
      createImageFromPath: () => image(''),
      getFileIcon,
    });

    expect(result).toBe('');
    expect(getFileIcon).toHaveBeenCalledTimes(1);
  });
});
