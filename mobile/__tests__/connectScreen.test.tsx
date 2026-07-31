/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import axios from 'axios';
import ConnectScreen from '../app/connect';

const mockConnect = jest.fn();
const mockReplace = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
  };
});

jest.mock('../src/context/ConnectionContext', () => ({
  useConnection: () => ({ connect: mockConnect }),
}));

jest.mock('../src/hooks/useThemeColor', () => ({
  useThemeColor: () => '#000000',
}));

jest.mock('../src/services/websocket', () => ({
  wsService: {
    onStateChange: (listener: (state: string) => void) => {
      Promise.resolve().then(() => listener('connected'));
      return jest.fn();
    },
  },
}));

describe('ConnectScreen QR pairing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axios.post as jest.Mock).mockResolvedValue({ data: { token: 'jwt-token' } });
    mockConnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects non-pairing links without contacting the backend', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<ConnectScreen />);

    fireEvent.press(screen.getByText('connect.pasteLink'));
    fireEvent.changeText(
      screen.getByPlaceholderText('connect.urlPlaceholder'),
      'http://192.168.1.8:25808/not-a-pairing-link',
    );
    fireEvent.press(screen.getByText('connect.connect'));

    expect(axios.post).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('common.error', 'connect.invalidURL', expect.any(Array));
  });

  it('rejects public or credential-bearing URLs before enabling cleartext transport', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<ConnectScreen />);

    fireEvent.press(screen.getByText('connect.pasteLink'));
    const input = screen.getByPlaceholderText('connect.urlPlaceholder');

    for (const url of [
      'http://example.com:25808/qr-login?token=qr-token',
      'http://user:password@192.168.1.8:25808/qr-login?token=qr-token',
      'https://192.168.1.8:25808/qr-login?token=qr-token',
    ]) {
      fireEvent.changeText(input, url);
      fireEvent.press(screen.getByText('connect.connect'));
    }

    expect(axios.post).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(3);
  });

  it('submits the backend QR token contract before connecting', async () => {
    render(<ConnectScreen />);

    fireEvent.press(screen.getByText('connect.pasteLink'));
    fireEvent.changeText(
      screen.getByPlaceholderText('connect.urlPlaceholder'),
      'http://192.168.1.8:25808/qr-login?token=qr-token',
    );
    fireEvent.press(screen.getByText('connect.connect'));

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith('http://192.168.1.8:25808/api/auth/qr-login', {
        qr_token: 'qr-token',
      }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/chat'));
  });
});
