import { app, BrowserWindow, ipcMain, dialog, Menu, session, shell } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { ApplicationService } from '../core/service';
import { publicError } from '../core/errors';
import type { Commands } from '../shared/types';
import { AppUpdateChecker } from '../core/app-updates';
import { externalUrl } from '../core/markets';

let mainWindow: BrowserWindow | null = null;
const smoke =
  !app.isPackaged && process.env.SKILL_MANAGER_TEST_MODE === '1'
    ? process.env.SKILL_MANAGER_TEST_ROOT
    : undefined;
if (smoke) app.setPath('userData', path.join(smoke, 'electron'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      const data = smoke
        ? path.join(smoke, 'data')
        : process.platform === 'linux'
          ? process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME)
            ? process.env.XDG_DATA_HOME
            : path.join(os.homedir(), '.local', 'share')
          : app.getPath('appData');
      const exampleDirectory = app.isPackaged
        ? path.join(process.resourcesPath, 'examples', 'clear-plan')
        : path.join(__dirname, '../examples/clear-plan');
      const service = new ApplicationService(
        data,
        smoke ? path.join(smoke, 'home') : os.homedir(),
        undefined,
        exampleDirectory,
      );
      let updates = new AppUpdateChecker(app.getVersion(), service.jsonClient);
      let updateDns = 'system';
      const entry = path.join(__dirname, '../dist/index.html'),
        allowedUrl = pathToFileURL(entry).href;
      Menu.setApplicationMenu(null);
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      // The renderer is local. Explicit Git, release and market requests run in the main process.
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (_details, callback) => callback({ cancel: true }),
      );
      ipcMain.handle('skill-manager:request', async (event, command: unknown, input: unknown) => {
        try {
          if (
            !mainWindow ||
            event.sender !== mainWindow.webContents ||
            event.senderFrame !== mainWindow.webContents.mainFrame ||
            event.senderFrame.url !== allowedUrl
          )
            throw new Error('Invalid sender');
          if (typeof command !== 'string' || command.length > 40) throw new Error('Invalid command');
          if (JSON.stringify(input ?? null).length > 1024 * 1024) throw new Error('Input too large');
          if (command === 'checkAppUpdate') {
            if (input !== undefined) throw new Error('Invalid update request');
            const mode = (await service.store.loadConfig()).network?.dns ?? 'system';
            if (mode !== updateDns) {
              updates = new AppUpdateChecker(app.getVersion(), service.jsonClient);
              updateDns = mode;
            }
            return { ok: true, value: await updates.check() };
          }
          if (command === 'openExternal') {
            const url = externalUrl(input as Commands['openExternal']['input']);
            await shell.openExternal(url);
            return { ok: true, value: undefined };
          }
          if (command === 'chooseFolder') {
            if (input !== undefined) throw new Error('Invalid folder request');
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory', 'createDirectory'],
            });
            return { ok: true, value: result.canceled ? null : result.filePaths[0] };
          }
          const value = await service.request(
            command as Exclude<keyof Commands, 'chooseFolder' | 'openExternal' | 'checkAppUpdate'>,
            input,
          );
          return { ok: true, value };
        } catch (error) {
          return { ok: false, error: publicError(error) };
        }
      });
      const createWindow = async () => {
        mainWindow = new BrowserWindow({
          width: 1440,
          height: 960,
          minWidth: 1000,
          minHeight: 700,
          title: 'Tangerine Skill Manager',
          backgroundColor: '#f6f7fa',
          show: false,
          webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            spellcheck: false,
          },
        });
        mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
        mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault());
        mainWindow.on('closed', () => {
          mainWindow = null;
        });
        await mainWindow.loadFile(entry);
        mainWindow.show();
      };
      await createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) void createWindow();
      });
    })
    .catch(() => {
      dialog.showErrorBox(
        '启动失败',
        '无法启动 Tangerine Skill Manager。请确认应用文件完整，并具有本地数据目录的读写权限。',
      );
      app.quit();
    });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
