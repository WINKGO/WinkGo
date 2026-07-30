/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import LegalScreen from '../app/legal';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        legalDocuments: {
          notice: 'WINK GO NOTICE with AionUi attribution',
          license: 'Apache License Version 2.0',
          thirdPartyNotices: 'Third-party AionUi release notice',
        },
      },
    },
  },
}));

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'settings.legal.title': 'Legal information',
        'settings.legal.notice': 'Distribution notice',
        'settings.legal.apacheLicense': 'Apache 2.0 License',
        'settings.legal.thirdPartyNotices': 'Third-party notices',
        'settings.legal.unavailable': 'Unavailable',
      })[key] ?? key,
  }),
}));

describe('LegalScreen', () => {
  it('switches between every legal document stored in the mobile bundle', () => {
    render(<LegalScreen />);

    expect(screen.getByText('WINK GO NOTICE with AionUi attribution')).toBeTruthy();

    fireEvent.press(screen.getByText('Apache 2.0 License'));
    expect(screen.getByText('Apache License Version 2.0')).toBeTruthy();

    fireEvent.press(screen.getByText('Third-party notices'));
    expect(screen.getByText('Third-party AionUi release notice')).toBeTruthy();
  });
});
