import { describe, expect, it } from 'vitest';
import { selectLanIPv4 } from './lan-ip.js';

const iface = (address: string, mac = 'd4:5d:64:ed:af:92') => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4' as const,
  mac,
  internal: false,
  cidr: `${address}/24`,
});

describe('selectLanIPv4', () => {
  it('prefers physical Ethernet/Wi-Fi over VPN and virtual adapters', () => {
    expect(
      selectLanIPv4({
        singbox_tun: [iface('172.18.0.1', '00:00:00:00:00:00')],
        'vEthernet (Default Switch)': [iface('172.22.224.1')],
        以太网: [iface('192.168.5.16')],
        '以太网 2': [iface('192.168.56.1')],
      })
    ).toBe('192.168.5.16');
  });

  it('keeps a virtual network as a last-resort fallback', () => {
    expect(selectLanIPv4({ tailscale0: [iface('100.64.0.2')] })).toBe('100.64.0.2');
  });

  it('ignores loopback and link-local addresses', () => {
    expect(
      selectLanIPv4({
        Loopback: [{ ...iface('127.0.0.1'), internal: true }],
        Ethernet: [iface('169.254.1.2')],
      })
    ).toBeNull();
  });
});
