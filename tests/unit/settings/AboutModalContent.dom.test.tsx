/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const openExternalUrlMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'guid.openSourceLicense':
          'This software is based on the WinkGo open-source project and is licensed under Apache License 2.0.',
        'guid.openSourceCopyright': 'Copyright 2025 WINK GO (winkgo.top) · Modified by WINK GO, 2026.',
      })[key] ?? key,
  }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: openExternalUrlMock,
}));

import AboutModalContent from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';

describe('AboutModalContent', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the enlarged WINK GO identity with the official site displayed beneath it', () => {
    const { container } = render(<AboutModalContent />);

    expect(screen.getByRole('img', { name: 'WINK GO' })).toBeInTheDocument();
    expect(screen.getByText('https://winkgo.top/')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://winkgo.top/' })).toHaveAttribute('href', 'https://winkgo.top/');
    expect(screen.getByRole('link', { name: 'https://winkgo.top/' })).toHaveAttribute(
      'aria-label',
      'https://winkgo.top/'
    );
    expect(
      screen.getByText(
        'This software is based on the WinkGo open-source project and is licensed under Apache License 2.0.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/Copyright 2025 WINK GO/)).toBeInTheDocument();
    expect(screen.getByTestId('about-attribution')).toHaveClass('bottom-20px', 'text-6px', 'opacity-20');
    expect(screen.getByRole('link', { name: 'Apache-2.0' })).toHaveAttribute(
      'href',
      'https://www.apache.org/licenses/LICENSE-2.0'
    );
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelectorAll('a')).toHaveLength(2);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('opens the WINK GO website externally', () => {
    render(<AboutModalContent />);

    fireEvent.click(screen.getByRole('link', { name: 'https://winkgo.top/' }));

    expect(openExternalUrlMock).toHaveBeenCalledWith('https://winkgo.top/');
  });

  it('opens the Apache-2.0 license externally', () => {
    render(<AboutModalContent />);

    fireEvent.click(screen.getByRole('link', { name: 'Apache-2.0' }));

    expect(openExternalUrlMock).toHaveBeenCalledWith('https://www.apache.org/licenses/LICENSE-2.0');
  });
});
