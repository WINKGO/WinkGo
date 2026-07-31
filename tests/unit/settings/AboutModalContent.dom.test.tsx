// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openExternalUrlMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.version': 'Version',
        'settings.legal.title': 'Legal information',
        'settings.legal.summary': 'WINK GO is released under Apache License 2.0.',
        'settings.legal.apacheLicense': 'Apache 2.0 License',
        'settings.legal.notice': 'Distribution notice',
        'settings.legal.thirdPartyNotices': 'Third-party notices',
        'login.privacyPolicy': 'Privacy Policy',
        'login.termsOfService': 'Terms of Service',
      })[key] ?? key,
  }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: openExternalUrlMock,
}));

import AboutModalContent from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';

describe('AboutModalContent', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '2.2.0');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows WINK GO branding, version, and a link to the legal documents', () => {
    const { container } = render(<AboutModalContent />);

    expect(screen.getByText('WINK GO')).toBeInTheDocument();
    expect(screen.getByText('github.com/xuweihafeichangniu-lab/wink-go')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://github.com/xuweihafeichangniu-lab/wink-go' })).toHaveAttribute(
      'href',
      'https://github.com/xuweihafeichangniu-lab/wink-go'
    );
    expect(screen.getByRole('link', { name: 'https://github.com/xuweihafeichangniu-lab/wink-go' })).toHaveAttribute(
      'aria-label',
      'https://github.com/xuweihafeichangniu-lab/wink-go'
    );
    expect(screen.getByText('WINK GO is released under Apache License 2.0.')).toBeInTheDocument();
    expect(screen.getByText('Version 2.2.0')).toBeInTheDocument();
    expect(screen.getByTestId('about-attribution')).toHaveClass('text-12px');
    expect(screen.getByTestId('about-attribution')).not.toHaveClass('opacity-20');
    expect(screen.getByRole('link', { name: 'Apache-2.0' })).toHaveAttribute(
      'href',
      'https://www.apache.org/licenses/LICENSE-2.0'
    );
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Legal information' })).toBeInTheDocument();
  });

  it('opens all bundled legal documents without a network request', () => {
    render(<AboutModalContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Legal information' }));

    expect(screen.getByTestId('legal-document-notice')).toHaveTextContent('WINK GO');
    expect(screen.getByTestId('legal-document-notice')).toHaveTextContent('AionUi');

    fireEvent.click(screen.getByText('Apache 2.0 License'));
    expect(screen.getByTestId('legal-document-license')).toHaveTextContent('Apache License');

    fireEvent.click(screen.getByText('Third-party notices'));
    expect(screen.getByTestId('legal-document-third-party')).toHaveTextContent('AionUI, AionCore, and aionrs');

    fireEvent.click(screen.getByText('Privacy Policy'));
    expect(screen.getByTestId('legal-document-privacy')).toHaveTextContent('local-first');
    expect(screen.getByTestId('legal-document-privacy')).toHaveTextContent('1394748660@qq.com');

    fireEvent.click(screen.getByText('Terms of Service'));
    expect(screen.getByTestId('legal-document-terms')).toHaveTextContent('open-source license');
    expect(screen.getByTestId('legal-document-terms')).toHaveTextContent('1394748660@qq.com');
  });

  it('opens the WINK GO project page externally', () => {
    render(<AboutModalContent />);

    fireEvent.click(screen.getByRole('link', { name: 'https://github.com/xuweihafeichangniu-lab/wink-go' }));

    expect(openExternalUrlMock).toHaveBeenCalledWith('https://github.com/xuweihafeichangniu-lab/wink-go');
  });

  it('opens the Apache-2.0 license externally', () => {
    render(<AboutModalContent />);

    fireEvent.click(screen.getByRole('link', { name: 'Apache-2.0' }));

    expect(openExternalUrlMock).toHaveBeenCalledWith('https://www.apache.org/licenses/LICENSE-2.0');
  });

  it('reports an external-link failure without hiding the legal documents', async () => {
    const error = new Error('browser unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    openExternalUrlMock.mockRejectedValueOnce(error);
    render(<AboutModalContent />);

    fireEvent.click(screen.getByRole('link', { name: 'Apache-2.0' }));

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to open external link: https://www.apache.org/licenses/LICENSE-2.0',
        error
      );
    });
    expect(screen.getByRole('button', { name: 'Legal information' })).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
