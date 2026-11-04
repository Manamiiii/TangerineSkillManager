import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Use the project's pinned Chromium SVG renderer, with a hidden window and a disposable profile.
if (!process.versions.electron) {
  const { default: executable } = await import('electron');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'tsm-icon-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(executable, [fileURLToPath(import.meta.url), '--user-data-dir=' + profile], {
    env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 60000,
  });
} else {
  const { app, BrowserWindow } = await import('electron');
  app.disableHardwareAcceleration();
  app.whenReady().then(async () => {
    try {
      const window = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await window.loadURL('data:text/html,<meta charset=utf-8>');
      const source =
        'data:image/svg+xml;base64,' + (await fs.readFile('assets/skill-manager.svg')).toString('base64');
      const frames = [];
      for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
        const encoded = await window.webContents.executeJavaScript(`(async () => {
        const image = new Image(); image.src = ${JSON.stringify(source)}; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = ${size};
        canvas.getContext('2d').drawImage(image, 0, 0, ${size}, ${size});
        return canvas.toDataURL('image/png').split(',')[1];
      })()`);
        const bytes = Buffer.from(encoded, 'base64');
        if (size === 512) await fs.writeFile('build/icon.png', bytes);
        else frames.push({ size, bytes });
      }
      const directory = Buffer.alloc(6 + 16 * frames.length);
      directory.writeUInt16LE(1, 2);
      directory.writeUInt16LE(frames.length, 4);
      let offset = directory.length;
      frames.forEach(({ size, bytes }, index) => {
        const entry = 6 + index * 16;
        directory[entry] = directory[entry + 1] = size % 256;
        directory.writeUInt16LE(1, entry + 4);
        directory.writeUInt16LE(32, entry + 6);
        directory.writeUInt32LE(bytes.length, entry + 8);
        directory.writeUInt32LE(offset, entry + 12);
        offset += bytes.length;
      });
      await fs.writeFile('build/icon.ico', Buffer.concat([directory, ...frames.map((frame) => frame.bytes)]));
      window.destroy();
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
}
