#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const projectRoot = path.resolve(__dirname, '..');
const executablePath = path.join(projectRoot, 'out', 'win-unpacked', 'WINK-GO.exe');
const artifactDirectory = path.join(projectRoot, 'out');
const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'winkgo-first-launch-'));
const roamingDirectory = path.join(sandboxRoot, 'Roaming');
const localDirectory = path.join(sandboxRoot, 'Local');
const userDataDirectory = path.join(sandboxRoot, 'UserData');
const policyFile = path.join(userDataDirectory, 'winkgo.auth-session-policy.json');
const screenshotPath = path.join(artifactDirectory, 'privacy-first-launch.png');
const fakeIdentity = 'old-test-user-13900000000';

const sessionPaths = [
  path.join(userDataDirectory, 'winkgo.license.session.json'),
  path.join(roamingDirectory, 'WinkGo', 'license', 'winkgo.license.session.json'),
  path.join(roamingDirectory, 'Wink Go', 'license', 'winkgo.license.session.json'),
  path.join(localDirectory, 'WinkGo', 'license', 'winkgo.license.session.json'),
];

const fakeSession = {
  accessToken: 'fake-release-privacy-token',
  account: {
    id: fakeIdentity,
    username: fakeIdentity,
    phone: '13900000000',
  },
};

for (const sessionPath of sessionPaths) {
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, `${JSON.stringify(fakeSession, null, 2)}\n`, 'utf8');
}

let electronApp;

async function main() {
  assert.ok(fs.existsSync(executablePath), `Packaged executable not found: ${executablePath}`);

  electronApp = await electron.launch({
    executablePath,
    cwd: path.dirname(executablePath),
    env: {
      ...process.env,
      APPDATA: roamingDirectory,
      LOCALAPPDATA: localDirectory,
      WINKGO_DISABLE_AUTO_UPDATE: '1',
      WINKGO_DISABLE_DEVTOOLS: '1',
      WINKGO_E2E_TEST: '1',
      // Keep the isolated E2E user-data directory while exercising the real
      // authentication session policy instead of the navigation-test user.
      WINKGO_E2E_AUTH_BYPASS: '0',
      WINKGO_E2E_USER_DATA_DIR: userDataDirectory,
      WINKGO_CDP_PORT: '0',
      NODE_ENV: 'production',
    },
    timeout: 60_000,
  });

  const deadline = Date.now() + 60_000;
  let loginPage;
  let bodyText = '';
  let observedUrls = [];

  while (Date.now() < deadline) {
    const windows = electronApp.windows().filter((window) => !window.url().startsWith('devtools://'));
    observedUrls = windows.map((window) => window.url());
    for (const window of windows) {
      try {
        await window.waitForLoadState('domcontentloaded', { timeout: 2_000 });
        const text = await window.locator('body').innerText({ timeout: 2_000 });
        const url = window.url();
        if (
          url.includes('/login') ||
          text.includes('登录 WINK GO') ||
          text.includes('注册 WINK GO') ||
          text.includes('Login WINK GO')
        ) {
          loginPage = window;
          bodyText = text;
          break;
        }
      } catch {
        // A transient utility window may close while the main window is loading.
      }
    }

    if (loginPage) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  assert.ok(
    loginPage,
    `The packaged app did not reach the WINK GO login page within 60 seconds. Windows: ${observedUrls.join(', ')}`
  );
  await loginPage.waitForFunction(
    () => {
      const text = document.body?.innerText || '';
      return /登录 WINK GO|注册 WINK GO|Login WINK GO/.test(text);
    },
    undefined,
    { timeout: 30_000 }
  );
  bodyText = await loginPage.locator('body').innerText();
  assert.match(bodyText, /登录 WINK GO|注册 WINK GO|Login WINK GO/);
  assert.ok(!bodyText.includes(fakeIdentity), 'The fake legacy account leaked into the first-launch UI.');
  assert.ok(!bodyText.includes('13900000000'), 'The fake legacy phone number leaked into the first-launch UI.');

  await loginPage.screenshot({ path: screenshotPath, fullPage: true });

  assert.ok(fs.existsSync(policyFile), 'The authentication privacy policy marker was not written.');
  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  assert.equal(policy.version, 2, 'The authentication privacy policy marker has the wrong version.');

  for (const sessionPath of sessionPaths) {
    assert.equal(fs.existsSync(sessionPath), false, `Legacy account session was not removed: ${sessionPath}`);
  }

  console.log(
    JSON.stringify(
      {
        passed: true,
        url: loginPage.url(),
        policyVersion: policy.version,
        clearedSessionFiles: sessionPaths.length,
        screenshotPath,
        sandboxRoot,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (electronApp) {
      try {
        await electronApp.close();
      } catch {
        // The application may already have closed after a startup failure.
      }
    }
    try {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    } catch {
      // Keep the primary verification result even if Windows briefly holds a log file.
    }
  });
