import { chromium } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// The portable launcher does not forward debugger stderr, which electron.launch requires.
// Connect to Chromium only after the launcher creates its endpoint in our isolated profile.
export async function launchPortable(executable, env) {
  const child = spawn(executable, ['--remote-debugging-port=0'], { env, windowsHide: true });
  let launchError;
  child.on('error', (error) => {
    launchError = error;
  });
  const endpoint = path.join(
    env.LOCALAPPDATA,
    'Tangerine',
    'Data',
    'TangerineSkillManager',
    'Cache',
    'Chromium',
    'DevToolsActivePort',
  );
  let browser;
  try {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error('Portable launcher exited before exposing its window.');
      const content = await fs.readFile(endpoint, 'utf8').catch(() => '');
      const [port, socket] = content.trim().split(/\r?\n/);
      if (/^\d{1,5}$/.test(port ?? '') && /^\/devtools\/browser\/[a-f0-9-]+$/i.test(socket ?? '')) {
        browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${socket}`, { timeout: 10000 });
        break;
      }
      await delay(250);
    }
    if (!browser) throw new Error('Portable launch timed out; no debugger endpoint in the isolated profile.');
    return {
      process: () => child,
      firstWindow: async () => {
        const context = browser.contexts()[0];
        return context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 15000 }));
      },
      close: async () => {
        const session = await browser.newBrowserCDPSession();
        await session.send('Browser.close').catch(() => {});
        await browser.close();
      },
    };
  } catch (error) {
    if (browser) await browser.close();
    if (child.pid && child.exitCode === null)
      await promisify(execFile)(
        path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: 5000 },
      ).catch(() => {});
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
    throw error;
  }
}
