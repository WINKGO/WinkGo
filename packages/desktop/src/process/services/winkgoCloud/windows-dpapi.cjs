const { execFileSync } = require('child_process');

const POWERSHELL_HOSTS = ['pwsh.exe', 'powershell.exe'];
const DPAPI_PROTECT_SCRIPT = [
  '$plain = [Console]::In.ReadToEnd()',
  '$secure = ConvertTo-SecureString $plain -AsPlainText -Force',
  'ConvertFrom-SecureString $secure',
].join('; ');
const DPAPI_UNPROTECT_SCRIPT = [
  '$cipher = [Console]::In.ReadToEnd()',
  '$secure = ConvertTo-SecureString $cipher',
  "[System.Net.NetworkCredential]::new('', $secure).Password",
].join('; ');

function runPowerShellTransform(script, input) {
  if (process.platform !== 'win32') {
    return '';
  }
  for (const executable of POWERSHELL_HOSTS) {
    try {
      return String(
        execFileSync(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
          input: String(input || ''),
          encoding: 'utf8',
          timeout: 8000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        }) || ''
      ).trim();
    } catch (_error) {
      // Try the next PowerShell host. Callers fail closed if neither works.
    }
  }
  return '';
}

function protectWindowsSecret(value) {
  const plain = String(value || '');
  if (!plain) return '';
  const protectedValue = runPowerShellTransform(DPAPI_PROTECT_SCRIPT, plain);
  return protectedValue ? `win:${protectedValue}` : '';
}

function unprotectWindowsSecret(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const protectedValue = text.startsWith('win:') ? text.slice(4) : text;
  if (!protectedValue) return '';
  return runPowerShellTransform(DPAPI_UNPROTECT_SCRIPT, protectedValue);
}

module.exports = {
  protectWindowsSecret,
  unprotectWindowsSecret,
};
