import { isIP } from 'node:net';
import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os';

const VIRTUAL_ADAPTER_PATTERN =
  /(?:virtual|vmware|virtualbox|vethernet|hyper-v|wsl|docker|tun|tap|singbox|tailscale|zerotier|default switch)/i;

type NetworkInterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

/**
 * Pick the address that another phone/computer on the same physical network
 * can actually reach. `os.networkInterfaces()` follows the Windows adapter
 * order, which commonly puts VPN/TUN, WSL or Hyper-V before Wi-Fi/Ethernet.
 * Returning that first address produced valid-looking but unreachable QR links
 * such as http://172.18.0.1:25809.
 */
export function selectLanIPv4(interfaces: NetworkInterfaceMap): string | null {
  const candidates: Array<{ address: string; order: number; score: number }> = [];
  let order = 0;

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const item of entries ?? []) {
      if (item.family !== 'IPv4' || item.internal || isIP(item.address) !== 4) continue;
      if (item.address === '0.0.0.0' || item.address.startsWith('169.254.')) continue;

      const octets = item.address.split('.').map(Number);
      const isPrivate172 = octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
      let score = item.address.startsWith('192.168.')
        ? 400
        : item.address.startsWith('10.')
          ? 350
          : isPrivate172
            ? 300
            : 100;

      // Prefer a normal Wi-Fi/Ethernet adapter over VPNs, virtual switches and
      // locally-created host-only adapters. Keep them as a last-resort fallback
      // for users whose only usable network is Tailscale/ZeroTier.
      if (VIRTUAL_ADAPTER_PATTERN.test(name)) score -= 1000;
      if (/\s\d+$/.test(name)) score -= 20;
      if (item.mac === '00:00:00:00:00:00') score -= 120;

      candidates.push({ address: item.address, order: order++, score });
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.order - right.order);
  return candidates[0]?.address ?? null;
}

export function getLanIP(): string | null {
  return selectLanIPv4(networkInterfaces());
}
